import {
  createAlertOutcomeObservation,
  type ExcursionMeasurement,
} from './alertOutcomeObservation';
import {
  PersistentOutcomeScheduler,
  type PendingOutcomeJob,
} from './persistentOutcomeScheduler';
import { QualifiedAlertRecorder } from './qualifiedAlertRecorder';
import type { QualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

export interface LivePriceSnapshot {
  instrumentId: string;
  observedAt: number;
  price: number;
  maximumFavorableExcursionPercent: number;
  maximumAdverseExcursionPercent: number;
  excursionMeasurement: ExcursionMeasurement;
}

export interface LiveEvidenceCollectorDependencies {
  recorder: QualifiedAlertRecorder;
  scheduler: PersistentOutcomeScheduler;
  readPrice: (
    instrumentId: string,
    dueAt: number,
  ) => Promise<LivePriceSnapshot>;
  clock?: () => number;
  maximumObservationDelayMs?: number;
  maximumFutureSkewMs?: number;
  onObservationError?: (error: unknown, job: PendingOutcomeJob) => void;
}

export class LiveEvidenceCollector {
  private initialized = false;
  private readonly clock: () => number;
  private readonly maximumObservationDelayMs: number;
  private readonly maximumFutureSkewMs: number;
  private readonly reportedJobErrors = new Set<string>();
  private readonly onObservationError: (
    error: unknown,
    job: PendingOutcomeJob,
  ) => void;

  public constructor(
    private readonly dependencies: LiveEvidenceCollectorDependencies,
  ) {
    this.clock = dependencies.clock ?? Date.now;
    this.maximumObservationDelayMs =
      dependencies.maximumObservationDelayMs ?? 10_000;
    this.maximumFutureSkewMs = dependencies.maximumFutureSkewMs ?? 5_000;
    this.onObservationError =
      dependencies.onObservationError ??
      ((error, job) => {
        console.error(
          `Outcome observation failed for ${job.alertId}/${job.horizonMinutes}m:`,
          error,
        );
      });

    if (
      !Number.isSafeInteger(this.maximumObservationDelayMs) ||
      this.maximumObservationDelayMs < 0 ||
      !Number.isSafeInteger(this.maximumFutureSkewMs) ||
      this.maximumFutureSkewMs < 0
    ) {
      throw new Error(
        'Evidence timestamp tolerances must be non-negative safe integers',
      );
    }
  }

  public async initialize(): Promise<void> {
    await this.dependencies.recorder.initialize();
    await this.dependencies.scheduler.initialize();
    this.initialized = true;
  }

  public async recordQualifiedAlert(
    evidence: QualifiedAlertEvidenceRecord,
  ): Promise<void> {
    this.requireInitialized();
    await this.dependencies.recorder.record(evidence);
    await this.dependencies.scheduler.scheduleAlert(evidence);
  }

  public async processDueObservations(now: number): Promise<number> {
    this.requireInitialized();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('now must be a non-negative safe integer');
    }

    const jobsByInstrument = new Map<string, PendingOutcomeJob[]>();
    for (const job of this.dependencies.scheduler.getDueJobs(now)) {
      if (now - job.dueAt > this.maximumObservationDelayMs) {
        this.reportObservationErrorOnce(
          new Error(
            'Outcome observation window expired; the job remains pending for integrity reporting',
          ),
          job,
        );
        continue;
      }
      const jobs = jobsByInstrument.get(job.instrumentId) ?? [];
      jobs.push(job);
      jobsByInstrument.set(job.instrumentId, jobs);
    }

    const completedByInstrument = await Promise.all(
      [...jobsByInstrument.entries()].map(([instrumentId, jobs]) =>
        this.processInstrumentJobs(instrumentId, jobs),
      ),
    );
    return completedByInstrument.reduce((sum, count) => sum + count, 0);
  }

  private async processInstrumentJobs(
    instrumentId: string,
    jobs: readonly PendingOutcomeJob[],
  ): Promise<number> {
    const latestDueAt = jobs.reduce(
      (latest, job) => Math.max(latest, job.dueAt),
      0,
    );
    let snapshot: LivePriceSnapshot;
    try {
      snapshot = await this.dependencies.readPrice(instrumentId, latestDueAt);
    } catch (error: unknown) {
      for (const job of jobs) {
        this.reportObservationErrorOnce(error, job);
      }
      return 0;
    }

    let completed = 0;
    for (const job of jobs) {
      const jobKey = this.getJobKey(job);
      try {
        await this.processObservation(job, snapshot);
        this.reportedJobErrors.delete(jobKey);
        completed += 1;
      } catch (error: unknown) {
        // A failed observation remains pending and may be retried while its
        // timestamp window is still valid. One bad job cannot block others.
        this.reportObservationErrorOnce(error, job);
      }
    }
    return completed;
  }

  private async processObservation(
    job: PendingOutcomeJob,
    snapshot: LivePriceSnapshot,
  ): Promise<void> {
    if (snapshot.instrumentId !== job.instrumentId) {
      throw new Error(
        'Price snapshot instrument does not match the pending job',
      );
    }
    if (!Number.isFinite(snapshot.price) || snapshot.price <= 0) {
      throw new Error('Price snapshot must contain a positive finite price');
    }
    if (
      !Number.isSafeInteger(snapshot.observedAt) ||
      snapshot.observedAt < job.dueAt
    ) {
      throw new Error(
        'Price snapshot was captured before the pending job was due',
      );
    }
    if (snapshot.observedAt - job.dueAt > this.maximumObservationDelayMs) {
      throw new Error(
        'Price snapshot was captured too late for the pending job',
      );
    }

    const validationNow = this.clock();
    if (!Number.isSafeInteger(validationNow) || validationNow < 0) {
      throw new Error('Evidence clock must return a non-negative safe integer');
    }
    if (snapshot.observedAt - validationNow > this.maximumFutureSkewMs) {
      throw new Error(
        'Price snapshot timestamp is implausibly far in the future',
      );
    }

    const rawReturnPercent =
      ((snapshot.price - job.referencePrice) / job.referencePrice) * 100;
    const directionAdjustedReturnPercent =
      job.direction === 'BEARISH' ? -rawReturnPercent : rawReturnPercent;

    const observation = createAlertOutcomeObservation({
      evaluationId: job.evaluationId,
      alertId: job.alertId,
      instrumentId: job.instrumentId,
      detectedAt: job.detectedAt,
      horizonMinutes: job.horizonMinutes,
      observedAt: snapshot.observedAt,
      referencePrice: job.referencePrice,
      observedPrice: snapshot.price,
      rawReturnPercent,
      directionAdjustedReturnPercent,
      maximumFavorableExcursionPercent:
        snapshot.maximumFavorableExcursionPercent,
      maximumAdverseExcursionPercent:
        snapshot.maximumAdverseExcursionPercent,
      excursionMeasurement: snapshot.excursionMeasurement,
    });

    await this.dependencies.scheduler.completeObservation(observation);
  }

  private reportObservationErrorOnce(
    error: unknown,
    job: PendingOutcomeJob,
  ): void {
    const jobKey = this.getJobKey(job);
    if (this.reportedJobErrors.has(jobKey)) {
      return;
    }
    this.reportedJobErrors.add(jobKey);
    try {
      this.onObservationError(error, job);
    } catch (handlerError: unknown) {
      console.error('Outcome observation error handler failed:', handlerError);
    }
  }

  private getJobKey(job: PendingOutcomeJob): string {
    return `${job.alertId}:${job.horizonMinutes}`;
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new Error('LiveEvidenceCollector must be initialized first');
    }
  }
}
