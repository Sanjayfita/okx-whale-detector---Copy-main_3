import { resolveAlphaFeatureVector } from './alphaCapturedFeatures';
import type {
  AlphaResearchConfig,
  AlphaResearchEventSnapshot,
} from './alphaFeatureTypes';
import {
  hasObservedExcursionPath,
  type AlertOutcomeObservation,
} from './alertOutcomeObservation';
import type { EvaluationSessionManifest } from './evaluationSessionManifest';
import { prepareEvidenceRecords } from './evidenceIntegrity';
import type { PendingOutcomeJob } from './persistentOutcomeScheduler';
import type { QualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

export type EvidenceCollectionHealth = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface EvidenceInstrumentQuality {
  readonly instrumentId: string;
  readonly qualifiedAlertCount: number;
  readonly snapshotCount: number;
  readonly capturedFeatureSnapshotCount: number;
  readonly missingCapturedFeatureSnapshotCount: number;
  readonly completedObservationCount: number;
  readonly observedPathExcursionCount: number;
  readonly unavailablePathExcursionCount: number;
  readonly pathExcursionAvailabilityRate: number | null;
}

export interface EvidenceDatasetQualityMetrics {
  readonly qualifiedAlertCount: number;
  readonly snapshotCount: number;
  readonly capturedFeatureSnapshotCount: number;
  readonly missingCapturedFeatureSnapshotCount: number;
  readonly missingSnapshotCount: number;
  readonly unmatchedSnapshotCount: number;
  readonly completedObservationCount: number;
  readonly observedPathExcursionCount: number;
  readonly unavailablePathExcursionCount: number;
  readonly pathExcursionAvailabilityRate: number | null;
  readonly expectedObservationCount: number;
  readonly missingObservationCount: number;
  readonly completeBundleCount: number;
  readonly incompleteBundleCount: number;
  readonly pendingObservationCount: number;
  readonly overduePendingObservationCount: number;
  readonly schedulerCoverageGapCount: number;
  readonly unmatchedObservationCount: number;
  readonly malformedRecordCount: number;
  readonly configuredInstrumentCount: number;
  readonly observedInstrumentCount: number;
  readonly minimumInstruments: number;
  readonly minimumInstrumentsMet: boolean;
  readonly availableFeatureValueCount: number;
  readonly missingFeatureValueCount: number;
  readonly featureValueAvailabilityRate: number | null;
  readonly snapshotCompletenessRate: number | null;
  readonly outcomeCompletenessRate: number | null;
  readonly instruments: readonly EvidenceInstrumentQuality[];
  readonly integrityValid: boolean;
  readonly snapshotRequirementMet: boolean;
  readonly outcomeRequirementMet: boolean;
  readonly health: EvidenceCollectionHealth;
  readonly healthReasons: readonly string[];
}

const jobKey = (
  value: Pick<PendingOutcomeJob, 'alertId' | 'horizonMinutes'>,
): string => `${value.alertId}:${value.horizonMinutes}`;

const alertMatchesSnapshot = (
  alert: QualifiedAlertEvidenceRecord,
  snapshot: AlphaResearchEventSnapshot,
): boolean => JSON.stringify(alert) === JSON.stringify(snapshot.evidence);

export const evaluateEvidenceDatasetQuality = (input: {
  readonly manifest: EvaluationSessionManifest;
  readonly alerts: readonly QualifiedAlertEvidenceRecord[];
  readonly outcomes: readonly AlertOutcomeObservation[];
  readonly snapshots: readonly AlphaResearchEventSnapshot[];
  readonly pendingJobs: readonly PendingOutcomeJob[];
  readonly parserMalformedRecords: number;
  readonly pendingMalformedRecords: number;
  readonly now: number;
  readonly maximumObservationDelayMs: number;
  readonly alphaConfig: AlphaResearchConfig;
}): EvidenceDatasetQualityMetrics => {
  if (!Number.isSafeInteger(input.now) || input.now < 0) {
    throw new Error('now must be a non-negative safe integer');
  }
  if (
    !Number.isSafeInteger(input.maximumObservationDelayMs) ||
    input.maximumObservationDelayMs < 0
  ) {
    throw new Error(
      'maximumObservationDelayMs must be a non-negative safe integer',
    );
  }

  const integrity = prepareEvidenceRecords({
    evaluationId: input.manifest.evaluationId,
    alerts: input.alerts,
    outcomes: input.outcomes,
    malformedRecords:
      input.parserMalformedRecords + input.pendingMalformedRecords,
  });
  let malformedRecordCount = integrity.malformedRecords;
  const configuredInstruments = new Set(input.manifest.instruments);
  const alertById = new Map(
    integrity.alerts.map((alert) => [alert.alertId, alert]),
  );
  for (const alert of integrity.alerts) {
    if (
      !configuredInstruments.has(alert.instrumentId) ||
      alert.sourceCommit !== input.manifest.sourceCommit ||
      alert.configurationFingerprint !== input.manifest.configurationFingerprint
    ) {
      malformedRecordCount += 1;
    }
  }

  const snapshotByAlertId = new Map<string, AlphaResearchEventSnapshot>();
  let unmatchedSnapshotCount = 0;
  let availableFeatureValueCount = 0;
  let missingFeatureValueCount = 0;
  let capturedFeatureSnapshotCount = 0;
  for (const snapshot of input.snapshots) {
    const alert = alertById.get(snapshot.evidence.alertId);
    if (
      alert === undefined ||
      !alertMatchesSnapshot(alert, snapshot) ||
      snapshot.synthetic ||
      snapshotByAlertId.has(snapshot.evidence.alertId)
    ) {
      unmatchedSnapshotCount += 1;
      malformedRecordCount += 1;
      continue;
    }
    try {
      const features = resolveAlphaFeatureVector(snapshot, input.alphaConfig);
      availableFeatureValueCount += features.availableFeatureCount;
      missingFeatureValueCount += features.missingFeatureCount;
      if (snapshot.capturedFeatures !== undefined) {
        capturedFeatureSnapshotCount += 1;
      }
      snapshotByAlertId.set(snapshot.evidence.alertId, snapshot);
    } catch {
      malformedRecordCount += 1;
    }
  }

  const completedKeys = new Set(
    integrity.joined.map(({ outcome }) => jobKey(outcome)),
  );
  const observedPathExcursionCount = integrity.outcomes.filter(
    hasObservedExcursionPath,
  ).length;
  const unavailablePathExcursionCount =
    integrity.outcomes.length - observedPathExcursionCount;
  const outcomesByAlert = new Map<string, Set<number>>();
  for (const { outcome } of integrity.joined) {
    const horizons = outcomesByAlert.get(outcome.alertId) ?? new Set<number>();
    horizons.add(outcome.horizonMinutes);
    outcomesByAlert.set(outcome.alertId, horizons);
  }
  const expectedHorizons = new Set<number>(input.manifest.horizonsMinutes);
  const completeBundleCount = integrity.alerts.filter((alert) => {
    const horizons = outcomesByAlert.get(alert.alertId);
    return (
      horizons !== undefined &&
      horizons.size === expectedHorizons.size &&
      [...expectedHorizons].every((horizon) => horizons.has(horizon))
    );
  }).length;
  const expectedObservationCount =
    integrity.alerts.length * input.manifest.horizonsMinutes.length;
  const missingObservationCount = Math.max(
    0,
    expectedObservationCount - integrity.joined.length,
  );

  const pendingKeys = new Set<string>();
  let pendingObservationCount = 0;
  let overduePendingObservationCount = 0;
  for (const job of input.pendingJobs) {
    const key = jobKey(job);
    const alert = alertById.get(job.alertId);
    if (
      job.evaluationId !== input.manifest.evaluationId ||
      alert === undefined ||
      job.instrumentId !== alert.instrumentId ||
      job.detectedAt !== alert.detectedAt ||
      job.direction !== alert.direction ||
      job.referencePrice !== alert.referencePrice ||
      !expectedHorizons.has(job.horizonMinutes) ||
      completedKeys.has(key) ||
      pendingKeys.has(key)
    ) {
      malformedRecordCount += 1;
      continue;
    }
    pendingKeys.add(key);
    pendingObservationCount += 1;
    if (input.now > job.dueAt + input.maximumObservationDelayMs) {
      overduePendingObservationCount += 1;
    }
  }
  const schedulerCoverageGapCount = Math.abs(
    missingObservationCount - pendingObservationCount,
  );

  const instrumentMetrics = input.manifest.instruments.map((instrumentId) => {
    const alerts = integrity.alerts.filter(
      (alert) => alert.instrumentId === instrumentId,
    );
    const instrumentOutcomes = integrity.joined
      .filter(({ alert }) => alert.instrumentId === instrumentId)
      .map(({ outcome }) => outcome);
    const instrumentObservedPathExcursions = instrumentOutcomes.filter(
      hasObservedExcursionPath,
    ).length;
    const instrumentSnapshots = alerts.flatMap((alert) => {
      const snapshot = snapshotByAlertId.get(alert.alertId);
      return snapshot === undefined ? [] : [snapshot];
    });
    const instrumentCapturedFeatureSnapshots = instrumentSnapshots.filter(
      (snapshot) => snapshot.capturedFeatures !== undefined,
    ).length;
    return Object.freeze({
      instrumentId,
      qualifiedAlertCount: alerts.length,
      snapshotCount: instrumentSnapshots.length,
      capturedFeatureSnapshotCount: instrumentCapturedFeatureSnapshots,
      missingCapturedFeatureSnapshotCount:
        instrumentSnapshots.length - instrumentCapturedFeatureSnapshots,
      completedObservationCount: instrumentOutcomes.length,
      observedPathExcursionCount: instrumentObservedPathExcursions,
      unavailablePathExcursionCount:
        instrumentOutcomes.length - instrumentObservedPathExcursions,
      pathExcursionAvailabilityRate:
        instrumentOutcomes.length === 0
          ? null
          : instrumentObservedPathExcursions / instrumentOutcomes.length,
    });
  });
  const observedInstrumentCount = instrumentMetrics.filter(
    (metric) => metric.qualifiedAlertCount > 0,
  ).length;
  const minimumInstrumentsMet =
    observedInstrumentCount >= input.manifest.minimumInstruments;
  const missingSnapshotCount = Math.max(
    0,
    integrity.alerts.length - snapshotByAlertId.size,
  );
  const missingCapturedFeatureSnapshotCount = Math.max(
    0,
    snapshotByAlertId.size - capturedFeatureSnapshotCount,
  );
  const featureValueCount =
    availableFeatureValueCount + missingFeatureValueCount;
  const snapshotRequirementMet =
    integrity.alerts.length > 0 &&
    missingSnapshotCount === 0 &&
    unmatchedSnapshotCount === 0 &&
    missingCapturedFeatureSnapshotCount === 0;
  const outcomeRequirementMet =
    integrity.alerts.length > 0 &&
    completeBundleCount === integrity.alerts.length &&
    missingObservationCount === 0 &&
    pendingObservationCount === 0;
  const integrityValid =
    malformedRecordCount === 0 &&
    integrity.unmatchedObservations === 0 &&
    unmatchedSnapshotCount === 0 &&
    overduePendingObservationCount === 0 &&
    schedulerCoverageGapCount === 0;

  const healthReasons: string[] = [];
  if (malformedRecordCount > 0)
    healthReasons.push(
      `${malformedRecordCount} malformed or inconsistent record(s)`,
    );
  if (integrity.unmatchedObservations > 0)
    healthReasons.push(
      `${integrity.unmatchedObservations} unmatched outcome(s)`,
    );
  if (unmatchedSnapshotCount > 0)
    healthReasons.push(`${unmatchedSnapshotCount} unmatched snapshot(s)`);
  if (overduePendingObservationCount > 0)
    healthReasons.push(
      `${overduePendingObservationCount} overdue outcome job(s)`,
    );
  if (schedulerCoverageGapCount > 0)
    healthReasons.push(`${schedulerCoverageGapCount} missing scheduler job(s)`);
  if (missingSnapshotCount > 0)
    healthReasons.push(
      `${missingSnapshotCount} qualified alert(s) missing snapshots`,
    );
  if (missingCapturedFeatureSnapshotCount > 0)
    healthReasons.push(
      `${missingCapturedFeatureSnapshotCount} snapshot(s) missing persisted feature values`,
    );
  if (!minimumInstrumentsMet)
    healthReasons.push(
      `only ${observedInstrumentCount}/${input.manifest.minimumInstruments} required instruments observed`,
    );

  const health: EvidenceCollectionHealth = !integrityValid
    ? 'UNHEALTHY'
    : missingSnapshotCount > 0 || missingCapturedFeatureSnapshotCount > 0
      ? 'DEGRADED'
      : 'HEALTHY';

  return Object.freeze({
    qualifiedAlertCount: integrity.alerts.length,
    snapshotCount: snapshotByAlertId.size,
    capturedFeatureSnapshotCount,
    missingCapturedFeatureSnapshotCount,
    missingSnapshotCount,
    unmatchedSnapshotCount,
    completedObservationCount: integrity.joined.length,
    observedPathExcursionCount,
    unavailablePathExcursionCount,
    pathExcursionAvailabilityRate:
      integrity.outcomes.length === 0
        ? null
        : observedPathExcursionCount / integrity.outcomes.length,
    expectedObservationCount,
    missingObservationCount,
    completeBundleCount,
    incompleteBundleCount: integrity.alerts.length - completeBundleCount,
    pendingObservationCount,
    overduePendingObservationCount,
    schedulerCoverageGapCount,
    unmatchedObservationCount: integrity.unmatchedObservations,
    malformedRecordCount,
    configuredInstrumentCount: input.manifest.instruments.length,
    observedInstrumentCount,
    minimumInstruments: input.manifest.minimumInstruments,
    minimumInstrumentsMet,
    availableFeatureValueCount,
    missingFeatureValueCount,
    featureValueAvailabilityRate:
      featureValueCount === 0
        ? null
        : availableFeatureValueCount / featureValueCount,
    snapshotCompletenessRate:
      integrity.alerts.length === 0
        ? null
        : snapshotByAlertId.size / integrity.alerts.length,
    outcomeCompletenessRate:
      expectedObservationCount === 0
        ? null
        : integrity.joined.length / expectedObservationCount,
    instruments: Object.freeze(instrumentMetrics),
    integrityValid,
    snapshotRequirementMet,
    outcomeRequirementMet,
    health,
    healthReasons: Object.freeze(healthReasons),
  });
};
