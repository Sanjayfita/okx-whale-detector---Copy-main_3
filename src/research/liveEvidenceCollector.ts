import {
  createAlertOutcomeObservation,
  type AlertOutcomeObservation,
  type ExcursionMeasurement,
  type OutcomeMarketDataSource,
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
  sourceMarketTimestamp?: number;
  sourceMarketAgeMs?: number;
  sourceMarketDataSource?: OutcomeMarketDataSource;
  /** Optional only for injected/replay readers. Live OKX paths are derived. */
  maximumFavorableExcursionPercent?: number;
  maximumAdverseExcursionPercent?: number;
  excursionMeasurement?: ExcursionMeasurement;
}

interface CapturedOutcomeObservation {
  readonly job: PendingOutcomeJob;
  readonly observation: AlertOutcomeObservation;
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
  onObservationMissed?: (
    job: PendingOutcomeJob,
    missedAt: number,
  ) => Promise<void> | void;
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

  public async recordQualifiedAlertIdempotent(
    evidence: QualifiedAlertEvidenceRecord,
  ): Promise<void> {
    this.requireInitialized();
    await this.dependencies.recorder.recordIdempotent(evidence);
    await this.dependencies.scheduler.scheduleAlert(evidence);
  }

  public assertCompleteOutcomeBundle(alertId: string): void {
    this.requireInitialized();
    this.dependencies.scheduler.assertCompleteOutcomeBundle(alertId);
  }

  public async processDueObservations(now: number): Promise<number> {
    this.requireInitialized();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('now must be a non-negative safe integer');
    }

    const jobsByInstrument = new Map<string, PendingOutcomeJob[]>();
    for (const job of this.dependencies.scheduler.getDueJobs(now)) {
      if (now - job.dueAt > this.maximumObservationDelayMs) {
        await this.dependencies.scheduler.markObservationMissed(
          job,
          now,
          'OBSERVATION_WINDOW_EXPIRED',
        );
        await this.dependencies.onObservationMissed?.(job, now);
        this.reportObservationErrorOnce(
          new Error(
            'Outcome observation window expired; the job was durably marked MISSED',
          ),
          job,
        );
        continue;
      }
      const jobs = jobsByInstrument.get(job.instrumentId) ?? [];
      jobs.push(job);
      jobsByInstrument.set(job.instrumentId, jobs);
    }

    const capturedByInstrument = await Promise.all(
      [...jobsByInstrument.entries()].map(([instrumentId, jobs]) =>
        this.captureInstrumentJobs(instrumentId, jobs),
      ),
    );
    const captured = capturedByInstrument.flat();
    if (captured.length === 0) return 0;

    try {
      await this.dependencies.scheduler.completeObservations(
        captured.map(({ observation }) => observation),
      );
    } catch (error: unknown) {
      for (const { job } of captured) {
        this.reportObservationErrorOnce(error, job);
      }
      return 0;
    }

    for (const { job } of captured) {
      this.reportedJobErrors.delete(this.getJobKey(job));
    }
    return captured.length;
  }

  public getMissedObservationCount(): number {
    this.requireInitialized();
    return this.dependencies.scheduler
      .getPendingJobs()
      .filter((job) => job.status === 'MISSED').length;
  }

  /** Earliest still-pending horizon, used to choose a restart-safe handoff. */
  public getNextPendingObservationDueAt(): number | undefined {
    this.requireInitialized();
    let nextDueAt: number | undefined;
    for (const job of this.dependencies.scheduler.getPendingJobs()) {
      if (job.status !== 'PENDING') continue;
      if (nextDueAt === undefined || job.dueAt < nextDueAt) {
        nextDueAt = job.dueAt;
      }
    }
    return nextDueAt;
  }

  private async captureInstrumentJobs(
    instrumentId: string,
    jobs: readonly PendingOutcomeJob[],
  ): Promise<readonly CapturedOutcomeObservation[]> {
    const orderedJobs = [...jobs].sort(
      (left, right) =>
        left.dueAt - right.dueAt ||
        left.alertId.localeCompare(right.alertId) ||
        left.horizonMinutes - right.horizonMinutes,
    );
    const latestDueAt = orderedJobs.reduce(
      (latest, job) => Math.max(latest, job.dueAt),
      0,
    );

    let snapshot: LivePriceSnapshot;
    try {
      snapshot = await this.dependencies.readPrice(instrumentId, latestDueAt);
    } catch (error: unknown) {
      for (const job of orderedJobs) {
        this.reportObservationErrorOnce(error, job);
      }
      return Object.freeze([]);
    }

    const captured: CapturedOutcomeObservation[] = [];
    for (const job of orderedJobs) {
      try {
        const priorCapturedForAlert = captured
          .filter(({ job: capturedJob }) => capturedJob.alertId === job.alertId)
          .map(({ observation }) => observation);
        captured.push(
          Object.freeze({
            job,
            observation: this.createObservation(
              job,
              snapshot,
              priorCapturedForAlert,
            ),
          }),
        );
      } catch (error: unknown) {
        // A failed capture remains pending and may be retried while its
        // timestamp window is still valid. One bad job cannot block others.
        this.reportObservationErrorOnce(error, job);
      }
    }

    return Object.freeze(captured);
  }

  private createObservation(
    job: PendingOutcomeJob,
    snapshot: LivePriceSnapshot,
    additionalPathObservations: readonly AlertOutcomeObservation[] = [],
  ): AlertOutcomeObservation {
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
    const sourceTimingProvided =
      snapshot.sourceMarketTimestamp !== undefined ||
      snapshot.sourceMarketAgeMs !== undefined;
    if (
      sourceTimingProvided &&
      (snapshot.sourceMarketTimestamp === undefined ||
        snapshot.sourceMarketAgeMs === undefined ||
        !Number.isSafeInteger(snapshot.sourceMarketTimestamp) ||
        snapshot.sourceMarketTimestamp < 0 ||
        !Number.isSafeInteger(snapshot.sourceMarketAgeMs) ||
        snapshot.sourceMarketAgeMs < 0 ||
        snapshot.sourceMarketTimestamp > snapshot.observedAt ||
        snapshot.sourceMarketAgeMs !==
          snapshot.observedAt - snapshot.sourceMarketTimestamp)
    ) {
      throw new Error('Price snapshot source timing is inconsistent');
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

    const pathPoints = [
      ...this.dependencies.scheduler
        .getCompletedObservations(job.alertId)
        .map((observation) => ({
          observedAt: observation.observedAt,
          rawReturnPercent: observation.rawReturnPercent,
        })),
      ...additionalPathObservations.map((observation) => ({
        observedAt: observation.observedAt,
        rawReturnPercent: observation.rawReturnPercent,
      })),
      { observedAt: snapshot.observedAt, rawReturnPercent },
    ];
    const maximumUpwardExcursionPercent = Math.max(
      0,
      ...pathPoints.map((point) => point.rawReturnPercent),
    );
    const maximumDownwardExcursionPercent = Math.max(
      0,
      ...pathPoints.map((point) => -point.rawReturnPercent),
    );
    const upwardPoint = pathPoints.find(
      (point) => point.rawReturnPercent === maximumUpwardExcursionPercent,
    );
    const downwardPoint = pathPoints.find(
      (point) => -point.rawReturnPercent === maximumDownwardExcursionPercent,
    );
    const timeToMaximumUpwardExcursionMs =
      maximumUpwardExcursionPercent === 0
        ? 0
        : (upwardPoint?.observedAt ?? snapshot.observedAt) - job.detectedAt;
    const timeToMaximumDownwardExcursionMs =
      maximumDownwardExcursionPercent === 0
        ? 0
        : (downwardPoint?.observedAt ?? snapshot.observedAt) - job.detectedAt;
    const maximumFavorableExcursionPercent =
      snapshot.excursionMeasurement === 'OBSERVED_PATH' &&
      snapshot.maximumFavorableExcursionPercent !== undefined
        ? snapshot.maximumFavorableExcursionPercent
        : job.direction === 'BULLISH'
          ? maximumUpwardExcursionPercent
          : maximumDownwardExcursionPercent;
    const maximumAdverseExcursionPercent =
      snapshot.excursionMeasurement === 'OBSERVED_PATH' &&
      snapshot.maximumAdverseExcursionPercent !== undefined
        ? snapshot.maximumAdverseExcursionPercent
        : job.direction === 'BULLISH'
          ? maximumDownwardExcursionPercent
          : maximumUpwardExcursionPercent;
    const timeToMaximumFavorableExcursionMs =
      job.direction === 'BULLISH'
        ? timeToMaximumUpwardExcursionMs
        : timeToMaximumDownwardExcursionMs;
    const timeToMaximumAdverseExcursionMs =
      job.direction === 'BULLISH'
        ? timeToMaximumDownwardExcursionMs
        : timeToMaximumUpwardExcursionMs;

    return createAlertOutcomeObservation({
      evaluationId: job.evaluationId,
      alertId: job.alertId,
      instrumentId: job.instrumentId,
      detectedAt: job.detectedAt,
      horizonMinutes: job.horizonMinutes,
      observedAt: snapshot.observedAt,
      observationDueAt: job.dueAt,
      observationLatencyMs: snapshot.observedAt - job.dueAt,
      allowedObservationDelayMs: this.maximumObservationDelayMs,
      sourceMarketTimestamp: snapshot.sourceMarketTimestamp,
      sourceMarketAgeMs: snapshot.sourceMarketAgeMs,
      sourceMarketDataSource: snapshot.sourceMarketDataSource,
      referencePrice: job.referencePrice,
      observedPrice: snapshot.price,
      rawReturnPercent,
      directionAdjustedReturnPercent,
      maximumFavorableExcursionPercent,
      maximumAdverseExcursionPercent,
      maximumUpwardExcursionPercent,
      maximumDownwardExcursionPercent,
      timeToMaximumFavorableExcursionMs,
      timeToMaximumAdverseExcursionMs,
      timeToMaximumUpwardExcursionMs,
      timeToMaximumDownwardExcursionMs,
      pathSampleCount: pathPoints.length,
      pathSampling: 'STANDARDIZED_HORIZON_SAMPLES',
      excursionMeasurement: 'OBSERVED_PATH',
    });
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
