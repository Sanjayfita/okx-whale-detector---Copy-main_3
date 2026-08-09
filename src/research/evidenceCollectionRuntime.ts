import type { CorrelatedAlert } from '../types/correlatedAlert';
import type { CorrelatedAlertRecordContext } from '../types/correlatedAlertEvaluation';
import type { CorrelatedAlertEvidenceBridge } from './correlatedAlertEvidenceBridge';
import type { LiveEvidenceCollector } from './liveEvidenceCollector';
import type { AlphaResearchSnapshotRecorder } from './alphaResearchSnapshotRecorder';
import { createAlphaResearchEventSnapshot } from './alphaResearchSnapshot';
import type { AlphaMarketContextObserverInput } from '../market/MarketEngine';
import type { QualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

export interface EvidenceCollectionRuntimeOptions {
  bridge: CorrelatedAlertEvidenceBridge;
  collector: LiveEvidenceCollector;
  alphaSnapshotRecorder?: AlphaResearchSnapshotRecorder;
  intervalMs?: number;
  clock?: () => number;
  setIntervalFn?: (callback: () => void, intervalMs: number) => NodeJS.Timeout;
  clearIntervalFn?: (timer: NodeJS.Timeout) => void;
  onError?: (error: unknown) => void;
  maximumPendingAlphaEvidence?: number;
  maximumPendingAlphaEvidenceAgeMs?: number;
}

interface PendingAlphaEvidence {
  readonly evidence: QualifiedAlertEvidenceRecord;
  readonly qualifiedRecordResult: Promise<QueuedWorkResult>;
  readonly queuedAt: number;
}

type QueuedWorkResult =
  | Readonly<{ readonly succeeded: true }>
  | Readonly<{ readonly succeeded: false; readonly error: unknown }>;

const SUCCEEDED_WORK: QueuedWorkResult = Object.freeze({ succeeded: true });
const DEFAULT_MAXIMUM_PENDING_ALPHA_EVIDENCE_AGE_MS = 60_000;

export class EvidenceCollectionRuntime {
  private readonly intervalMs: number;
  private readonly clock: () => number;
  private readonly setIntervalFn: (
    callback: () => void,
    intervalMs: number,
  ) => NodeJS.Timeout;
  private readonly clearIntervalFn: (timer: NodeJS.Timeout) => void;
  private readonly onError: (error: unknown) => void;
  private readonly maximumPendingAlphaEvidence: number;
  private readonly maximumPendingAlphaEvidenceAgeMs: number;

  private initialized = false;
  private timer?: NodeJS.Timeout;
  private workChain: Promise<void> = Promise.resolve();
  private readonly pendingAlphaEvidence = new Map<
    string,
    PendingAlphaEvidence
  >();

  public constructor(
    private readonly options: EvidenceCollectionRuntimeOptions,
  ) {
    this.intervalMs = options.intervalMs ?? 5_000;
    this.clock = options.clock ?? Date.now;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.onError = options.onError ?? console.error;
    this.maximumPendingAlphaEvidence =
      options.maximumPendingAlphaEvidence ?? 1_024;
    this.maximumPendingAlphaEvidenceAgeMs =
      options.maximumPendingAlphaEvidenceAgeMs ??
      DEFAULT_MAXIMUM_PENDING_ALPHA_EVIDENCE_AGE_MS;

    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs <= 0) {
      throw new Error('intervalMs must be a positive safe integer');
    }
    if (
      !Number.isSafeInteger(this.maximumPendingAlphaEvidence) ||
      this.maximumPendingAlphaEvidence <= 0
    ) {
      throw new Error(
        'maximumPendingAlphaEvidence must be a positive safe integer',
      );
    }
    if (
      !Number.isSafeInteger(this.maximumPendingAlphaEvidenceAgeMs) ||
      this.maximumPendingAlphaEvidenceAgeMs <= 0
    ) {
      throw new Error(
        'maximumPendingAlphaEvidenceAgeMs must be a positive safe integer',
      );
    }
  }

  public async start(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.options.collector.initialize();
    await this.options.alphaSnapshotRecorder?.initialize();
    this.initialized = true;
    this.timer = this.setIntervalFn(() => {
      const now = this.clock();
      this.prunePendingAlphaEvidence(now);
      this.enqueue(async () => {
        await this.options.collector.processDueObservations(now);
      });
    }, this.intervalMs);
  }

  public onPersistedLiveAlert = (
    alert: CorrelatedAlert,
    context: CorrelatedAlertRecordContext,
  ): void => {
    if (!this.initialized) {
      this.onError(
        new Error(
          'EvidenceCollectionRuntime must be started before collecting alerts',
        ),
      );
      return;
    }

    let evidence: QualifiedAlertEvidenceRecord;
    const recordedAt = this.clock();
    this.prunePendingAlphaEvidence(recordedAt);
    try {
      evidence = this.options.bridge.createEvidence({
        alert,
        evaluationContext: context.evaluationContext,
        recordedAt,
      });
    } catch (error: unknown) {
      this.onError(error);
      return;
    }
    const qualifiedRecordResult = this.enqueue(async () => {
      await this.options.collector.recordQualifiedAlert(evidence);
    });
    if (this.options.alphaSnapshotRecorder) {
      if (this.pendingAlphaEvidence.has(evidence.alertId)) {
        this.onError(
          new Error(`Duplicate pending alpha evidence: ${evidence.alertId}`),
        );
      } else if (
        this.pendingAlphaEvidence.size >= this.maximumPendingAlphaEvidence
      ) {
        this.onError(
          new Error(
            `Pending alpha evidence limit reached: maximum=${this.maximumPendingAlphaEvidence}`,
          ),
        );
      } else {
        this.pendingAlphaEvidence.set(
          evidence.alertId,
          Object.freeze({
            evidence,
            qualifiedRecordResult,
            queuedAt: recordedAt,
          }),
        );
      }
    }
  };

  public onPersistedAlphaMarketContext = (
    input: AlphaMarketContextObserverInput,
  ): void => {
    if (!this.initialized) {
      this.onError(
        new Error(
          'EvidenceCollectionRuntime must be started before collecting alpha snapshots',
        ),
      );
      return;
    }
    const recorder = this.options.alphaSnapshotRecorder;
    if (!recorder) return;
    this.prunePendingAlphaEvidence(this.clock());
    const pending = this.pendingAlphaEvidence.get(input.alert.id);
    this.pendingAlphaEvidence.delete(input.alert.id);
    if (pending === undefined) {
      this.onError(
        new Error(
          `Alpha market context has no matching persisted evidence: ${input.alert.id}`,
        ),
      );
      return;
    }
    this.enqueue(async () => {
      const qualifiedRecordResult = await pending.qualifiedRecordResult;
      if (!qualifiedRecordResult.succeeded) {
        throw new Error(
          `Alpha snapshot blocked because qualified evidence failed: ${input.alert.id}`,
          { cause: qualifiedRecordResult.error },
        );
      }
      await recorder.record(
        createAlphaResearchEventSnapshot({
          evidence: pending.evidence,
          marketContext: input.marketContext,
        }),
      );
    });
  };

  public async processNow(): Promise<number> {
    this.requireStarted();
    const now = this.clock();
    this.prunePendingAlphaEvidence(now);
    let completed = 0;
    const result = await this.enqueue(async () => {
      completed = await this.options.collector.processDueObservations(now);
    });
    if (!result.succeeded) {
      throw result.error;
    }
    return completed;
  }

  public async stop(): Promise<void> {
    if (this.timer !== undefined) {
      this.clearIntervalFn(this.timer);
      this.timer = undefined;
    }

    await this.workChain;
    if (this.pendingAlphaEvidence.size > 0) {
      this.onError(
        new Error(
          `Evidence collection stopped with ${this.pendingAlphaEvidence.size} alpha context(s) missing`,
        ),
      );
    }
    this.pendingAlphaEvidence.clear();
    this.initialized = false;
  }

  private enqueue(work: () => Promise<void>): Promise<QueuedWorkResult> {
    const next = this.workChain.then(work);
    const result: Promise<QueuedWorkResult> = next.then(
      () => SUCCEEDED_WORK,
      (error: unknown) => {
        this.onError(error);
        return Object.freeze({ succeeded: false as const, error });
      },
    );
    this.workChain = result.then(() => undefined);
    return result;
  }

  private prunePendingAlphaEvidence(now: number): void {
    const expiredIds: string[] = [];

    for (const [alertId, pending] of this.pendingAlphaEvidence) {
      if (now - pending.queuedAt > this.maximumPendingAlphaEvidenceAgeMs) {
        this.pendingAlphaEvidence.delete(alertId);
        expiredIds.push(alertId);
      }
    }

    if (expiredIds.length > 0) {
      this.onError(
        new Error(
          `Expired ${expiredIds.length} pending alpha context(s) after ${this.maximumPendingAlphaEvidenceAgeMs}ms; first=${expiredIds[0]}`,
        ),
      );
    }
  }

  private requireStarted(): void {
    if (!this.initialized) {
      throw new Error('EvidenceCollectionRuntime must be started first');
    }
  }
}
