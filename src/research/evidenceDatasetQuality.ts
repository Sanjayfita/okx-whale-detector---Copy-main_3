import { resolveAlphaFeatureVector } from './alphaCapturedFeatures';
import type {
  AlphaResearchConfig,
  AlphaResearchEventSnapshot,
} from './alphaFeatureTypes';
import {
  hasObservedExcursionPath,
  outcomeHorizonMilliseconds,
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
  readonly invalidJsonRecordCount: number;
  readonly schemaInvalidRecordCount: number;
  readonly unexpectedInstrumentCount: number;
  readonly duplicateEventCount: number;
  readonly duplicateSnapshotCount: number;
  readonly duplicateObservationCount: number;
  readonly orphanObservationCount: number;
  readonly temporalInconsistencyCount: number;
  readonly pendingEventInitializationCount: number;
  readonly criticalFailureCount: number;
  readonly observationLatencyMs: EvidenceLatencySummary;
  readonly rawEventCount: number;
  readonly qualifiedAlertCount: number;
  readonly snapshotCount: number;
  readonly capturedFeatureSnapshotCount: number;
  readonly missingCapturedFeatureSnapshotCount: number;
  readonly missingSnapshotIntegrityCount: number;
  readonly missingDerivativeMetadataCount: number;
  readonly explicitlyMissingDerivativeValueCount: number;
  readonly requiredFeatureCalculationFailureCount: number;
  readonly featureAvailabilityInterpretation: string;
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
  readonly missedObservationCount: number;
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
  readonly sideDistribution: Readonly<{
    bullish: number;
    bearish: number;
  }>;
  readonly signalTypeDistribution: Readonly<Record<string, number>>;
  readonly integrityValid: boolean;
  readonly snapshotRequirementMet: boolean;
  readonly outcomeRequirementMet: boolean;
  readonly health: EvidenceCollectionHealth;
  readonly healthReasons: readonly string[];
}

export interface EvidenceLatencySummary {
  readonly count: number;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly mean: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
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
  readonly invalidJsonRecords?: number;
  readonly schemaInvalidRecords?: number;
  readonly pendingEventInitializationCount?: number;
  readonly criticalFailureCount?: number;
  readonly collectionUnhealthy?: boolean;
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
  const duplicateEventCount =
    input.alerts.length -
    new Set(input.alerts.map((alert) => alert.alertId)).size;
  const duplicateSnapshotCount =
    input.snapshots.length -
    new Set(input.snapshots.map((snapshot) => snapshot.evidence.alertId)).size;
  const duplicateObservationCount =
    input.outcomes.length -
    new Set(
      input.outcomes.map(
        (outcome) => `${outcome.alertId}:${outcome.horizonMinutes}`,
      ),
    ).size;
  const invalidJsonRecordCount = input.invalidJsonRecords ?? 0;
  const schemaInvalidRecordCount = input.schemaInvalidRecords ?? 0;
  const pendingEventInitializationCount =
    input.pendingEventInitializationCount ?? 0;
  const criticalFailureCount = input.criticalFailureCount ?? 0;
  let malformedRecordCount = integrity.malformedRecords;
  const configuredInstruments = new Set(input.manifest.instruments);
  const unexpectedInstrumentCount = input.alerts.filter(
    (alert) => !configuredInstruments.has(alert.instrumentId),
  ).length;
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
  let missingSnapshotIntegrityCount = 0;
  let missingDerivativeMetadataCount = 0;
  let explicitlyMissingDerivativeValueCount = 0;
  let requiredFeatureCalculationFailureCount = 0;
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
      if (
        snapshot.integrity === undefined ||
        snapshot.integrity.eventTimestamp !== alert.detectedAt ||
        snapshot.integrity.featureTimestamp > alert.detectedAt ||
        snapshot.integrity.maximumSourceAvailabilityTimestamp >
          alert.detectedAt ||
        !snapshot.integrity.temporalIntegrityVerified
      ) {
        missingSnapshotIntegrityCount += 1;
      }
      if (snapshot.derivatives === undefined) {
        missingDerivativeMetadataCount += 1;
      } else {
        explicitlyMissingDerivativeValueCount += [
          snapshot.derivatives.fundingRate,
          snapshot.derivatives.openInterest,
          snapshot.derivatives.openInterestChange,
        ].filter((value) => value === null).length;
      }
      snapshotByAlertId.set(snapshot.evidence.alertId, snapshot);
    } catch {
      malformedRecordCount += 1;
      requiredFeatureCalculationFailureCount += 1;
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
  let missedObservationCount = 0;
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
    if (job.status === 'MISSED') missedObservationCount += 1;
    if (
      job.status === 'MISSED' ||
      input.now > job.dueAt + input.maximumObservationDelayMs
    ) {
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
  const pointInTimeRequirementMet = missingSnapshotIntegrityCount === 0;
  const outcomeRequirementMet =
    integrity.alerts.length > 0 &&
    completeBundleCount === integrity.alerts.length &&
    missingObservationCount === 0 &&
    pendingObservationCount === 0 &&
    observedPathExcursionCount === integrity.outcomes.length;
  const integrityValid =
    malformedRecordCount === 0 &&
    integrity.unmatchedObservations === 0 &&
    unmatchedSnapshotCount === 0 &&
    overduePendingObservationCount === 0 &&
    schedulerCoverageGapCount === 0 &&
    unexpectedInstrumentCount === 0 &&
    pendingEventInitializationCount === 0 &&
    criticalFailureCount === 0 &&
    input.collectionUnhealthy !== true;

  const healthReasons: string[] = [];
  if (malformedRecordCount > 0)
    healthReasons.push(
      `${malformedRecordCount} malformed or inconsistent record(s)`,
    );
  if (invalidJsonRecordCount > 0)
    healthReasons.push(`${invalidJsonRecordCount} invalid JSON record(s)`);
  if (schemaInvalidRecordCount > 0)
    healthReasons.push(`${schemaInvalidRecordCount} schema-invalid record(s)`);
  if (unexpectedInstrumentCount > 0)
    healthReasons.push(
      `${unexpectedInstrumentCount} unexpected instrument record(s)`,
    );
  if (duplicateEventCount > 0)
    healthReasons.push(`${duplicateEventCount} duplicate event(s)`);
  if (duplicateSnapshotCount > 0)
    healthReasons.push(`${duplicateSnapshotCount} duplicate snapshot(s)`);
  if (duplicateObservationCount > 0)
    healthReasons.push(`${duplicateObservationCount} duplicate observation(s)`);
  if (pendingEventInitializationCount > 0)
    healthReasons.push(
      `${pendingEventInitializationCount} event initialization(s) pending recovery`,
    );
  if (criticalFailureCount > 0 || input.collectionUnhealthy === true)
    healthReasons.push(`${criticalFailureCount} durable critical failure(s)`);
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
  if (missingSnapshotIntegrityCount > 0)
    healthReasons.push(
      `${missingSnapshotIntegrityCount} snapshot(s) missing verified point-in-time metadata`,
    );
  if (missingDerivativeMetadataCount > 0)
    healthReasons.push(
      `${missingDerivativeMetadataCount} snapshot(s) missing explicit derivatives availability metadata`,
    );
  if (unavailablePathExcursionCount > 0)
    healthReasons.push(
      `${unavailablePathExcursionCount} outcome(s) missing sampled path excursions`,
    );
  if (!minimumInstrumentsMet)
    healthReasons.push(
      `only ${observedInstrumentCount}/${input.manifest.minimumInstruments} required instruments observed`,
    );

  const health: EvidenceCollectionHealth = !integrityValid
    ? 'UNHEALTHY'
    : missingSnapshotCount > 0 ||
        missingCapturedFeatureSnapshotCount > 0 ||
        !pointInTimeRequirementMet
      ? 'DEGRADED'
      : 'HEALTHY';

  const signalTypeDistribution: Record<string, number> = {};
  for (const alert of integrity.alerts) {
    signalTypeDistribution[alert.signalType] =
      (signalTypeDistribution[alert.signalType] ?? 0) + 1;
  }
  const bullish = integrity.alerts.filter(
    (alert) => alert.direction === 'BULLISH',
  ).length;
  const latencyValues = integrity.outcomes
    .map(
      (outcome) =>
        outcome.observedAt -
        (outcome.detectedAt +
          outcomeHorizonMilliseconds(outcome.horizonMinutes)),
    )
    .sort((left, right) => left - right);
  const percentile = (fraction: number): number | null =>
    latencyValues.length === 0
      ? null
      : (latencyValues[
          Math.min(
            latencyValues.length - 1,
            Math.ceil(latencyValues.length * fraction) - 1,
          )
        ] ?? null);
  const observationLatencyMs: EvidenceLatencySummary = Object.freeze({
    count: latencyValues.length,
    minimum: latencyValues[0] ?? null,
    maximum: latencyValues.at(-1) ?? null,
    mean:
      latencyValues.length === 0
        ? null
        : latencyValues.reduce((sum, value) => sum + value, 0) /
          latencyValues.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
  });

  return Object.freeze({
    invalidJsonRecordCount,
    schemaInvalidRecordCount,
    unexpectedInstrumentCount,
    duplicateEventCount,
    duplicateSnapshotCount,
    duplicateObservationCount,
    orphanObservationCount: integrity.unmatchedObservations,
    temporalInconsistencyCount: missingSnapshotIntegrityCount,
    pendingEventInitializationCount,
    criticalFailureCount,
    observationLatencyMs,
    rawEventCount: integrity.alerts.length,
    qualifiedAlertCount: integrity.alerts.length,
    snapshotCount: snapshotByAlertId.size,
    capturedFeatureSnapshotCount,
    missingCapturedFeatureSnapshotCount,
    missingSnapshotIntegrityCount,
    missingDerivativeMetadataCount,
    explicitlyMissingDerivativeValueCount,
    requiredFeatureCalculationFailureCount,
    featureAvailabilityInterpretation:
      'Persisted model-input values; explicit schema-supported missing derivatives are reported separately and are not corruption',
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
    missedObservationCount,
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
    sideDistribution: Object.freeze({
      bullish,
      bearish: integrity.alerts.length - bullish,
    }),
    signalTypeDistribution: Object.freeze(signalTypeDistribution),
    integrityValid,
    snapshotRequirementMet: snapshotRequirementMet && pointInTimeRequirementMet,
    outcomeRequirementMet,
    health,
    healthReasons: Object.freeze(healthReasons),
  });
};
