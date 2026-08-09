import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import {
  ALERT_OUTCOME_HORIZONS_MINUTES,
  isAlertOutcomeHorizonMinutes,
  parseAlertOutcomeObservation,
  type AlertOutcomeHorizonMinutes,
  type AlertOutcomeObservation,
} from './alertOutcomeObservation';
import {
  parseQualifiedAlertEvidenceRecord,
  type QualifiedAlertEvidenceRecord,
} from './qualifiedAlertEvidence';
import { prepareEvidenceRecords } from './evidenceIntegrity';
import { readEvidenceNdjsonFile } from './evidenceNdjson';

export const PENDING_OUTCOME_JOB_SCHEMA_VERSION = 1 as const;

export interface PendingOutcomeJob {
  schemaVersion: typeof PENDING_OUTCOME_JOB_SCHEMA_VERSION;
  evaluationId: string;
  alertId: string;
  instrumentId: string;
  detectedAt: number;
  direction: QualifiedAlertEvidenceRecord['direction'];
  referencePrice: number;
  horizonMinutes: AlertOutcomeHorizonMinutes;
  dueAt: number;
  liveOrderExecutionAllowed: false;
}

interface PersistentOutcomeSchedulerState {
  schemaVersion: 1;
  pending: readonly PendingOutcomeJob[];
  liveOrderExecutionAllowed: false;
}

export interface OutcomeSchedulerReconciliation {
  readonly addedMissingJobs: number;
  readonly removedCompletedJobs: number;
  readonly unchangedJobs: number;
}

const emptyState = (): PersistentOutcomeSchedulerState => ({
  schemaVersion: 1,
  pending: [],
  liveOrderExecutionAllowed: false,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const jobKey = (
  job: Pick<PendingOutcomeJob, 'alertId' | 'horizonMinutes'>,
): string => `${job.alertId}:${job.horizonMinutes}`;

export const parsePendingOutcomeJob = (
  job: unknown,
): PendingOutcomeJob | undefined => {
  if (!isRecord(job)) {
    return undefined;
  }

  const detectedAt = job.detectedAt;
  const referencePrice = job.referencePrice;
  const dueAt = job.dueAt;

  if (
    job.schemaVersion !== PENDING_OUTCOME_JOB_SCHEMA_VERSION ||
    job.liveOrderExecutionAllowed !== false ||
    typeof job.evaluationId !== 'string' ||
    job.evaluationId.trim().length === 0 ||
    job.evaluationId !== job.evaluationId.trim() ||
    typeof job.alertId !== 'string' ||
    job.alertId.trim().length === 0 ||
    job.alertId !== job.alertId.trim() ||
    typeof job.instrumentId !== 'string' ||
    job.instrumentId.trim().length === 0 ||
    job.instrumentId !== job.instrumentId.trim() ||
    typeof detectedAt !== 'number' ||
    !Number.isSafeInteger(detectedAt) ||
    detectedAt < 0 ||
    (job.direction !== 'BULLISH' && job.direction !== 'BEARISH') ||
    typeof referencePrice !== 'number' ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0 ||
    !isAlertOutcomeHorizonMinutes(job.horizonMinutes) ||
    typeof dueAt !== 'number' ||
    !Number.isSafeInteger(dueAt) ||
    dueAt !== detectedAt + job.horizonMinutes * 60_000
  ) {
    return undefined;
  }

  return Object.freeze({
    schemaVersion: PENDING_OUTCOME_JOB_SCHEMA_VERSION,
    evaluationId: job.evaluationId,
    alertId: job.alertId,
    instrumentId: job.instrumentId,
    detectedAt,
    direction: job.direction,
    referencePrice,
    horizonMinutes: job.horizonMinutes,
    dueAt,
    liveOrderExecutionAllowed: false,
  });
};

export class PersistentOutcomeScheduler {
  private state: PersistentOutcomeSchedulerState = emptyState();
  private writeChain: Promise<void> = Promise.resolve();
  private lastReconciliation: OutcomeSchedulerReconciliation = Object.freeze({
    addedMissingJobs: 0,
    removedCompletedJobs: 0,
    unchangedJobs: 0,
  });

  private readonly horizonsMinutes: readonly AlertOutcomeHorizonMinutes[];

  public constructor(
    private readonly evaluationDirectory: string,
    horizonsMinutes: readonly number[] = ALERT_OUTCOME_HORIZONS_MINUTES,
  ) {
    if (
      horizonsMinutes.length === 0 ||
      horizonsMinutes.some((value) => !isAlertOutcomeHorizonMinutes(value)) ||
      new Set(horizonsMinutes).size !== horizonsMinutes.length
    ) {
      throw new Error('Outcome scheduler horizons are invalid');
    }
    this.horizonsMinutes = Object.freeze(
      horizonsMinutes.filter(isAlertOutcomeHorizonMinutes),
    );
  }

  private get pendingPath(): string {
    return join(this.evaluationDirectory, 'pending-observations.json');
  }

  private get outcomesPath(): string {
    return join(this.evaluationDirectory, 'outcomes.ndjson');
  }

  public async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(
        await readFile(this.pendingPath, 'utf8'),
      ) as unknown;
      const pending = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) &&
            parsed.schemaVersion === 1 &&
            parsed.liveOrderExecutionAllowed === false
          ? parsed.pending
          : undefined;
      if (!Array.isArray(pending)) {
        throw new Error(
          'pending-observations.json must contain a pending array',
        );
      }

      const validated = pending.map((job) => this.validateJob(job));
      const keys = new Set(validated.map(jobKey));
      if (keys.size !== validated.length) {
        throw new Error('pending-observations.json contains duplicate jobs');
      }

      const storedState: PersistentOutcomeSchedulerState = {
        schemaVersion: 1,
        pending: Object.freeze(validated),
        liveOrderExecutionAllowed: false,
      };
      await this.reconcileWithAuthoritativeEvidence(storedState);
    } catch (error) {
      if (!isErrorWithCode(error, 'ENOENT')) throw error;
      await this.reconcileWithAuthoritativeEvidence(emptyState());
    }
  }

  public async scheduleAlert(
    evidence: QualifiedAlertEvidenceRecord,
  ): Promise<readonly PendingOutcomeJob[]> {
    const validatedEvidence = parseQualifiedAlertEvidenceRecord(evidence);

    if (!validatedEvidence) {
      throw new Error(
        'Only qualified, execution-disabled alerts may be scheduled',
      );
    }

    const candidates = this.horizonsMinutes.map((horizonMinutes) => {
      const job = parsePendingOutcomeJob({
        schemaVersion: PENDING_OUTCOME_JOB_SCHEMA_VERSION,
        evaluationId: validatedEvidence.evaluationId,
        alertId: validatedEvidence.alertId,
        instrumentId: validatedEvidence.instrumentId,
        detectedAt: validatedEvidence.detectedAt,
        direction: validatedEvidence.direction,
        referencePrice: validatedEvidence.referencePrice,
        horizonMinutes,
        dueAt: validatedEvidence.detectedAt + horizonMinutes * 60_000,
        liveOrderExecutionAllowed: false,
      });

      if (!job) {
        throw new Error('Pending outcome job exceeds the timestamp range');
      }

      return job;
    });
    let created: readonly PendingOutcomeJob[] = [];

    await this.enqueue(async () => {
      const existingKeys = new Set(this.state.pending.map(jobKey));
      created = candidates.filter((job) => !existingKeys.has(jobKey(job)));

      if (created.length === 0) {
        return;
      }

      const next = [...this.state.pending, ...created].sort(
        (left, right) => left.dueAt - right.dueAt,
      );
      await this.persist({
        schemaVersion: 1,
        pending: next,
        liveOrderExecutionAllowed: false,
      });
    });

    return Object.freeze([...created]);
  }

  public getDueJobs(now: number): readonly PendingOutcomeJob[] {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('now must be a non-negative safe integer');
    }
    return Object.freeze(this.state.pending.filter((job) => job.dueAt <= now));
  }

  public getPendingJobs(): readonly PendingOutcomeJob[] {
    return Object.freeze([...this.state.pending]);
  }

  public getLastReconciliation(): OutcomeSchedulerReconciliation {
    return this.lastReconciliation;
  }

  public async completeObservation(
    observation: AlertOutcomeObservation,
  ): Promise<void> {
    const validatedObservation = parseAlertOutcomeObservation(observation);

    if (!validatedObservation) {
      throw new Error(
        'Only complete, execution-disabled observations may be saved',
      );
    }

    await this.enqueue(async () => {
      const key = jobKey(validatedObservation);
      const scheduled = this.state.pending.find((job) => jobKey(job) === key);
      if (scheduled === undefined) {
        throw new Error('No matching pending observation job exists');
      }
      if (
        scheduled.evaluationId !== validatedObservation.evaluationId ||
        scheduled.instrumentId !== validatedObservation.instrumentId ||
        scheduled.detectedAt !== validatedObservation.detectedAt ||
        scheduled.referencePrice !== validatedObservation.referencePrice
      ) {
        throw new Error(
          'Observation does not match its scheduled alert evidence',
        );
      }

      const expectedDirectionalReturn =
        scheduled.direction === 'BEARISH'
          ? -validatedObservation.rawReturnPercent
          : validatedObservation.rawReturnPercent;
      if (
        Math.abs(
          validatedObservation.directionAdjustedReturnPercent -
            expectedDirectionalReturn,
        ) > Math.max(1e-9, Math.abs(expectedDirectionalReturn) * 1e-9)
      ) {
        throw new Error(
          'Observation direction does not match its scheduled alert',
        );
      }

      await appendFile(
        this.outcomesPath,
        `${JSON.stringify(validatedObservation)}\n`,
        { encoding: 'utf8', flush: true },
      );
      await this.persist({
        schemaVersion: 1,
        pending: this.state.pending.filter((job) => jobKey(job) !== key),
        liveOrderExecutionAllowed: false,
      });
    });
  }

  private validateJob(job: unknown): PendingOutcomeJob {
    const validated = parsePendingOutcomeJob(job);
    if (!validated) {
      throw new Error('Invalid pending outcome job');
    }
    return validated;
  }

  private createJobsForEvidence(
    evidence: QualifiedAlertEvidenceRecord,
  ): readonly PendingOutcomeJob[] {
    return Object.freeze(
      this.horizonsMinutes.map((horizonMinutes) => {
        const job = parsePendingOutcomeJob({
          schemaVersion: PENDING_OUTCOME_JOB_SCHEMA_VERSION,
          evaluationId: evidence.evaluationId,
          alertId: evidence.alertId,
          instrumentId: evidence.instrumentId,
          detectedAt: evidence.detectedAt,
          direction: evidence.direction,
          referencePrice: evidence.referencePrice,
          horizonMinutes,
          dueAt: evidence.detectedAt + horizonMinutes * 60_000,
          liveOrderExecutionAllowed: false,
        });
        if (job === undefined) {
          throw new Error('Pending outcome job exceeds the timestamp range');
        }
        return job;
      }),
    );
  }

  private async reconcileWithAuthoritativeEvidence(
    storedState: PersistentOutcomeSchedulerState,
  ): Promise<void> {
    const alerts = await this.readOptionalEvidence(
      join(this.evaluationDirectory, 'qualified-alerts.ndjson'),
      parseQualifiedAlertEvidenceRecord,
    );
    const outcomes = await this.readOptionalEvidence(
      this.outcomesPath,
      parseAlertOutcomeObservation,
    );
    if (alerts.malformed > 0 || outcomes.malformed > 0) {
      throw new Error(
        `Cannot reconcile malformed evidence: alerts=${alerts.malformed}, outcomes=${outcomes.malformed}`,
      );
    }
    if (alerts.records.length === 0) {
      if (outcomes.records.length > 0) {
        throw new Error('Cannot reconcile outcomes without qualified alerts');
      }
      this.state = storedState;
      this.lastReconciliation = Object.freeze({
        addedMissingJobs: 0,
        removedCompletedJobs: 0,
        unchangedJobs: storedState.pending.length,
      });
      if (storedState.pending.length === 0) {
        await this.persist(storedState);
      }
      return;
    }

    const evaluationIds = new Set(
      alerts.records.map((record) => record.evaluationId),
    );
    if (evaluationIds.size !== 1) {
      throw new Error('Qualified alerts contain mixed evaluation IDs');
    }
    const evaluationId = alerts.records[0]?.evaluationId;
    if (evaluationId === undefined) {
      throw new Error('Qualified alert evaluation identity is missing');
    }
    const integrity = prepareEvidenceRecords({
      evaluationId,
      alerts: alerts.records,
      outcomes: outcomes.records,
    });
    if (integrity.malformedRecords > 0 || integrity.unmatchedObservations > 0) {
      throw new Error(
        `Cannot reconcile invalid evidence: malformed=${integrity.malformedRecords}, unmatched=${integrity.unmatchedObservations}`,
      );
    }

    const completedKeys = new Set(
      integrity.outcomes.map(
        (outcome) => `${outcome.alertId}:${outcome.horizonMinutes}`,
      ),
    );
    const expectedByKey = new Map<string, PendingOutcomeJob>();
    for (const alert of integrity.alerts) {
      for (const job of this.createJobsForEvidence(alert)) {
        if (!completedKeys.has(jobKey(job))) {
          expectedByKey.set(jobKey(job), job);
        }
      }
    }

    const storedByKey = new Map(
      storedState.pending.map((job) => [jobKey(job), job]),
    );
    let removedCompletedJobs = 0;
    let unchangedJobs = 0;
    for (const [key, stored] of storedByKey) {
      const expected = expectedByKey.get(key);
      if (expected === undefined) {
        if (completedKeys.has(key)) {
          removedCompletedJobs += 1;
          continue;
        }
        throw new Error(`Pending outcome job has no qualified alert: ${key}`);
      }
      if (JSON.stringify(stored) !== JSON.stringify(expected)) {
        throw new Error(`Pending outcome job conflicts with evidence: ${key}`);
      }
      unchangedJobs += 1;
    }

    const addedMissingJobs = [...expectedByKey.keys()].filter(
      (key) => !storedByKey.has(key),
    ).length;
    const reconciled = [...expectedByKey.values()].sort(
      (left, right) =>
        left.dueAt - right.dueAt || jobKey(left).localeCompare(jobKey(right)),
    );
    this.lastReconciliation = Object.freeze({
      addedMissingJobs,
      removedCompletedJobs,
      unchangedJobs,
    });
    if (addedMissingJobs > 0 || removedCompletedJobs > 0) {
      await this.persist({
        schemaVersion: 1,
        pending: reconciled,
        liveOrderExecutionAllowed: false,
      });
    } else {
      this.state = Object.freeze({
        schemaVersion: 1,
        pending: Object.freeze(reconciled),
        liveOrderExecutionAllowed: false,
      });
    }
  }

  private async readOptionalEvidence<T>(
    filePath: string,
    parser: (value: unknown) => T | undefined,
  ): Promise<
    Readonly<{
      records: readonly T[];
      malformed: number;
    }>
  > {
    try {
      return await readEvidenceNdjsonFile(filePath, parser);
    } catch (error: unknown) {
      if (!isErrorWithCode(error, 'ENOENT')) throw error;
      return Object.freeze({ records: Object.freeze([]), malformed: 0 });
    }
  }

  private async persist(state: PersistentOutcomeSchedulerState): Promise<void> {
    const normalized: PersistentOutcomeSchedulerState = {
      schemaVersion: 1,
      pending: Object.freeze([...state.pending]),
      liveOrderExecutionAllowed: false,
    };
    const temporaryPath = `${this.pendingPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: 'utf8',
      flush: true,
    });
    await rename(temporaryPath, this.pendingPath);
    this.state = normalized;
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(operation, operation);
    this.writeChain = next.catch(() => undefined);
    await next;
  }
}
