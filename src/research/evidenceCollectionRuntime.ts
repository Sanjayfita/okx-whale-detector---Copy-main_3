import type { CorrelatedAlert } from '../types/correlatedAlert';
import type { CorrelatedAlertRecordContext } from '../types/correlatedAlertEvaluation';
import type { CorrelatedAlertEvidenceBridge } from './correlatedAlertEvidenceBridge';
import type { LiveEvidenceCollector } from './liveEvidenceCollector';
import type { AlphaResearchSnapshotRecorder } from './alphaResearchSnapshotRecorder';
import { createAlphaResearchEventSnapshot } from './alphaResearchSnapshot';
import type { AlphaMarketContextObserverInput } from '../market/MarketEngine';
import type { QualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';
import type { EvidenceEventInitializationStore } from './evidenceEventInitializationStore';
import type { EvidenceCollectionHealthStore } from './evidenceCollectionHealthStore';

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
  allowedInstrumentIds?: readonly string[];
  eventInitializationStore?: EvidenceEventInitializationStore;
  healthStore?: EvidenceCollectionHealthStore;
  onCriticalFailure?: (error: Error) => void;
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
  private readonly allowedInstrumentIds?: ReadonlySet<string>;
  private readonly onCriticalFailure: (error: Error) => void;

  private initialized = false;
  private failedClosed = false;
  private acceptingAdmissions = false;
  private timer?: NodeJS.Timeout;
  private workChain: Promise<void> = Promise.resolve();
  private outcomeWorkChain: Promise<void> = Promise.resolve();
  private outcomePollPending = false;
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
    this.allowedInstrumentIds =
      options.allowedInstrumentIds === undefined
        ? undefined
        : new Set(options.allowedInstrumentIds);
    this.onCriticalFailure = options.onCriticalFailure ?? (() => undefined);

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
      this.allowedInstrumentIds !== undefined &&
      (this.allowedInstrumentIds.size === 0 ||
        this.allowedInstrumentIds.size !== options.allowedInstrumentIds?.length)
    ) {
      throw new Error('allowedInstrumentIds must be non-empty and unique');
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

    await this.options.healthStore?.initialize();
    if (this.options.healthStore?.isUnhealthy()) {
      throw new Error('Evidence collection health is already UNHEALTHY');
    }
    try {
      await this.options.collector.initialize();
      const missedObservationCount =
        'getMissedObservationCount' in this.options.collector &&
        typeof this.options.collector.getMissedObservationCount === 'function'
          ? this.options.collector.getMissedObservationCount()
          : 0;
      if (missedObservationCount > 0) {
        throw new Error(
          `Cannot resume evaluation with ${missedObservationCount} irrecoverably missed observation(s)`,
        );
      }
      await this.options.alphaSnapshotRecorder?.initialize();
      await this.options.eventInitializationStore?.initialize();
      for (const pending of this.options.eventInitializationStore?.getPending() ??
        []) {
        await this.options.collector.recordQualifiedAlertIdempotent(
          pending.evidence,
        );
        this.options.collector.assertCompleteOutcomeBundle(pending.alertId);
        await this.options.alphaSnapshotRecorder?.recordIdempotent(
          pending.snapshot,
        );
        await this.options.eventInitializationStore?.commit(pending.alertId);
      }
    } catch (error: unknown) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      await this.failClosed(normalizedError, 'STARTUP_RECONCILIATION_FAILED');
      throw normalizedError;
    }
    this.initialized = true;
    this.acceptingAdmissions = true;
    // Immediately process any due observations recovered from persistent state
    // before starting the recurring polling timer. This ensures near-due jobs
    // are evaluated promptly after restart instead of waiting for the first
    // timer tick which can push short-horizon jobs past their allowed window.
    try {
      const initialResult = await this.enqueueOutcome(async () => {
        const now = this.clock();
        await this.options.collector.processDueObservations(now);
      });
      if (!initialResult.succeeded) {
        throw initialResult.error ?? new Error('initial outcome processing failed');
      }
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      await this.failClosed(normalized, 'OUTCOME_PROCESSING_FAILED');
      throw normalized;
    }

    this.timer = this.setIntervalFn(() => {
      this.prunePendingAlphaEvidence(this.clock());

      // Coalesce recurring timer ticks while one outcome poll is already
      // running or queued. A slow durability flush must not create an
      // ever-growing chain of stale polls behind the deadline-sensitive work.
      if (this.outcomePollPending) return;
      this.outcomePollPending = true;

      const result = this.enqueueOutcome(async () => {
        const now = this.clock();
        await this.options.collector.processDueObservations(now);
      });
      void result
        .then((workResult) => {
          if (!workResult.succeeded) {
            void this.failClosed(
              workResult.error instanceof Error
                ? workResult.error
                : new Error(String(workResult.error)),
              'OUTCOME_PROCESSING_FAILED',
            );
          }
        })
        .finally(() => {
          this.outcomePollPending = false;
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
    if (!this.acceptingAdmissions) return;

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

  /** Authoritative production admission path: event, context, jobs and snapshot. */
  public onQualifiedMarketContext = (
    input: AlphaMarketContextObserverInput,
  ): void => {
    if (!this.initialized || this.failedClosed) {
      if (!this.failedClosed) {
        this.onError(
          new Error(
            'EvidenceCollectionRuntime must be started before admission',
          ),
        );
      }
      return;
    }
    if (!this.acceptingAdmissions) return;
    if (!this.allowedInstrumentIds?.has(input.alert.symbol)) {
      void this.failClosed(
        new Error(`Unexpected manifest instrument: ${input.alert.symbol}`),
        'UNEXPECTED_INSTRUMENT',
        input.alert.id,
        input.alert.symbol,
      );
      return;
    }
    if (input.marketContext === null) {
      void this.failClosed(
        new Error(
          `Point-in-time snapshot unavailable: ${input.failureReason ?? 'UNKNOWN'}`,
        ),
        'SNAPSHOT_UNAVAILABLE',
        input.alert.id,
        input.alert.symbol,
      );
      return;
    }
    const marketContext = input.marketContext;

    let evidence: QualifiedAlertEvidenceRecord;
    let snapshot: ReturnType<typeof createAlphaResearchEventSnapshot>;
    const startedAt = this.clock();
    try {
      evidence = this.options.bridge.createEvidence({
        alert: input.alert,
        evaluationContext: input.evaluationContext,
        recordedAt: startedAt,
      });
      snapshot = createAlphaResearchEventSnapshot({
        evidence,
        marketContext,
      });
    } catch (error: unknown) {
      void this.failClosed(
        error instanceof Error ? error : new Error(String(error)),
        'CANDIDATE_VALIDATION_FAILED',
        input.alert.id,
        input.alert.symbol,
      );
      return;
    }

    void this.enqueue(async () => {
      try {
        if (this.failedClosed) {
          throw new Error('Evidence collection has already failed closed');
        }
        const store = this.options.eventInitializationStore;
        const recorder = this.options.alphaSnapshotRecorder;
        if (store === undefined || recorder === undefined) {
          throw new Error(
            'Transactional evidence dependencies are unavailable',
          );
        }
        await store.begin(evidence, snapshot, startedAt);
        await this.options.collector.recordQualifiedAlertIdempotent(evidence);
        this.options.collector.assertCompleteOutcomeBundle(evidence.alertId);
        await recorder.recordIdempotent(snapshot);
        await store.commit(evidence.alertId);
      } catch (error: unknown) {
        await this.failClosed(
          error instanceof Error ? error : new Error(String(error)),
          'EVENT_INITIALIZATION_FAILED',
          evidence.alertId,
          evidence.instrumentId,
        );
        throw error;
      }
    });
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
    if (input.marketContext === null) {
      this.onError(
        new Error(
          `Point-in-time snapshot unavailable: ${input.failureReason ?? 'UNKNOWN'}`,
        ),
      );
      return;
    }
    const legacyMarketContext = input.marketContext;
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
          marketContext: legacyMarketContext,
        }),
      );
    });
  };

  public async processNow(): Promise<number> {
    this.requireStarted();
    this.prunePendingAlphaEvidence(this.clock());
    let completed = 0;
    const result = await this.enqueueOutcome(async () => {
      const now = this.clock();
      completed = await this.options.collector.processDueObservations(now);
    });
    if (!result.succeeded) {
      throw result.error;
    }
    return completed;
  }

  public async stop(): Promise<void> {
    this.acceptingAdmissions = false;
    if (this.timer !== undefined) {
      this.clearIntervalFn(this.timer);
      this.timer = undefined;
    }

    await Promise.all([this.workChain, this.outcomeWorkChain]);
    this.outcomePollPending = false;
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

  /**
   * Stops admitting new evidence while live market data remains connected, then
   * waits for a deadline gap large enough for a cold process restart. This does
   * not widen the scientific observation window: near-due jobs are completed by
   * the old process before the WebSocket source is closed.
   */
  public async quiesceForRestart(options: {
    safeLeadMs?: number;
    maximumWaitMs?: number;
    pollIntervalMs?: number;
  } = {}): Promise<Readonly<{ waitedMs: number; nextPendingDueAt?: number }>> {
    this.requireStarted();
    if (this.failedClosed) {
      throw new Error('Cannot quiesce an evidence runtime that has failed closed');
    }

    const safeLeadMs = options.safeLeadMs ?? 30_000;
    const maximumWaitMs = options.maximumWaitMs ?? 360_000;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    for (const [name, value] of [
      ['safeLeadMs', safeLeadMs],
      ['maximumWaitMs', maximumWaitMs],
      ['pollIntervalMs', pollIntervalMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive safe integer`);
      }
    }

    this.acceptingAdmissions = false;
    await this.workChain;

    const startedAt = this.clock();
    const waitDeadline = startedAt + maximumWaitMs;
    while (true) {
      await this.processNow();
      const now = this.clock();
      const nextPendingDueAt =
        this.options.collector.getNextPendingObservationDueAt();
      if (
        nextPendingDueAt === undefined ||
        nextPendingDueAt - now >= safeLeadMs
      ) {
        return Object.freeze({
          waitedMs: Math.max(0, now - startedAt),
          ...(nextPendingDueAt === undefined ? {} : { nextPendingDueAt }),
        });
      }
      if (now >= waitDeadline) {
        throw new Error(
          `Unable to reach a restart-safe observation gap within ${maximumWaitMs}ms`,
        );
      }
      const remaining = waitDeadline - now;
      await new Promise((resolveWait) =>
        setTimeout(resolveWait, Math.min(pollIntervalMs, remaining)),
      );
    }
  }

  /** Backward-compatible bounded drain for callers that do not require restart. */
  public async drainObservationGracePeriod(
    durationMs: number = 10_000,
  ): Promise<void> {
    this.requireStarted();
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      throw new Error('durationMs must be a positive safe integer');
    }
    const deadline = this.clock() + durationMs;
    while (this.clock() < deadline) {
      await this.processNow();
      const remaining = deadline - this.clock();
      if (remaining > 0) {
        await new Promise((resolveDrain) =>
          setTimeout(resolveDrain, Math.min(250, remaining)),
        );
      }
    }
    await this.processNow();
  }

  public isFailedClosed(): boolean {
    return this.failedClosed;
  }

  public failCollectionIntegrity(
    error: Error,
    category: string,
    alertId?: string,
    instrumentId?: string,
  ): Promise<void> {
    return this.failClosed(error, category, alertId, instrumentId);
  }

  private async failClosed(
    error: Error,
    category: string,
    alertId?: string,
    instrumentId?: string,
  ): Promise<void> {
    if (this.failedClosed) return;
    this.failedClosed = true;
    try {
      await this.options.healthStore?.fail({
        failedAt: this.clock(),
        category,
        message: error.message,
        alertId,
        instrumentId,
      });
    } catch (healthError: unknown) {
      this.onError(healthError);
    }
    this.onError(error);
    this.onCriticalFailure(error);
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

  /**
   * Serializes deadline-sensitive outcome work independently from alert and
   * alpha-snapshot persistence. This prevents ordinary evidence writes from
   * starving horizon observations while still preventing overlapping outcome
   * polls from racing and producing duplicate observations.
   */
  private enqueueOutcome(
    work: () => Promise<void>,
  ): Promise<QueuedWorkResult> {
    const next = this.outcomeWorkChain.then(work);
    const result: Promise<QueuedWorkResult> = next.then(
      () => SUCCEEDED_WORK,
      (error: unknown) => {
        this.onError(error);
        return Object.freeze({ succeeded: false as const, error });
      },
    );
    this.outcomeWorkChain = result.then(() => undefined);
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
