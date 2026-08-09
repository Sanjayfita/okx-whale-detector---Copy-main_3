import {
  parseAlertOutcomeObservation,
  type AlertOutcomeObservation,
} from './alertOutcomeObservation';
import { resolveAlphaFeatureVector } from './alphaCapturedFeatures';
import type {
  AlphaResearchConfig,
  AlphaResearchDataset,
  AlphaResearchDatasetRow,
  AlphaResearchEventSnapshot,
} from './alphaFeatureTypes';
import { ALPHA_FEATURE_NAMES } from './alphaFeatureTypes';
import { ALPHA_FEATURE_REGISTRY } from './alphaFeatureRegistry';
import {
  validateAlphaFeatureExtractionConfig,
  validateAlphaResearchAnalysisConfig,
} from './alphaResearchConfig';
import {
  parseQualifiedAlertEvidenceRecord,
  type QualifiedAlertEvidenceRecord,
} from './qualifiedAlertEvidence';

const approximatelyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(1e-9, Math.abs(right) * 1e-9);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPotentialDatasetRow = (
  value: unknown,
): value is AlphaResearchDatasetRow =>
  isRecord(value) &&
  typeof value.evaluationId === 'string' &&
  typeof value.alertId === 'string' &&
  typeof value.instrumentId === 'string' &&
  typeof value.detectedAt === 'number' &&
  (value.direction === 'BULLISH' || value.direction === 'BEARISH') &&
  typeof value.outcomeObservedAt === 'number' &&
  typeof value.horizonMinutes === 'number' &&
  typeof value.grossReturnPercent === 'number' &&
  typeof value.netReturnPercent === 'number' &&
  isRecord(value.features) &&
  typeof value.synthetic === 'boolean';

const isPotentialDataset = (value: unknown): value is AlphaResearchDataset =>
  isRecord(value) &&
  typeof value.evaluationId === 'string' &&
  typeof value.targetHorizonMinutes === 'number' &&
  typeof value.roundTripCostPercent === 'number' &&
  Array.isArray(value.rows) &&
  value.rows.every(isPotentialDatasetRow) &&
  typeof value.inputAlertCount === 'number' &&
  typeof value.inputSnapshotCount === 'number' &&
  typeof value.inputOutcomeCount === 'number' &&
  typeof value.unmatchedSnapshots === 'number' &&
  typeof value.missingSnapshots === 'number' &&
  typeof value.unmatchedOutcomes === 'number' &&
  typeof value.ignoredOtherHorizonOutcomes === 'number' &&
  typeof value.synthetic === 'boolean' &&
  value.liveOrderExecutionAllowed === false;

const outcomeMatchesEvidence = (
  evidence: QualifiedAlertEvidenceRecord,
  outcome: AlertOutcomeObservation,
): boolean => {
  if (
    outcome.evaluationId !== evidence.evaluationId ||
    outcome.alertId !== evidence.alertId ||
    outcome.instrumentId !== evidence.instrumentId ||
    outcome.detectedAt !== evidence.detectedAt ||
    !approximatelyEqual(outcome.referencePrice, evidence.referencePrice)
  ) {
    return false;
  }
  const expectedDirectionalReturn =
    evidence.direction === 'BULLISH'
      ? outcome.rawReturnPercent
      : -outcome.rawReturnPercent;
  return approximatelyEqual(
    outcome.directionAdjustedReturnPercent,
    expectedDirectionalReturn,
  );
};

export const validateAlphaResearchDataset: (
  dataset: unknown,
) => asserts dataset is AlphaResearchDataset = (dataset: unknown) => {
  if (!isPotentialDataset(dataset)) {
    throw new Error('Alpha dataset envelope is invalid');
  }
  if (
    dataset.evaluationId.trim().length === 0 ||
    dataset.liveOrderExecutionAllowed !== false ||
    !Number.isFinite(dataset.roundTripCostPercent) ||
    dataset.roundTripCostPercent < 0
  ) {
    throw new Error('Alpha dataset envelope is invalid');
  }
  const accountingValues = [
    dataset.inputAlertCount,
    dataset.inputSnapshotCount,
    dataset.inputOutcomeCount,
    dataset.unmatchedSnapshots,
    dataset.missingSnapshots,
    dataset.unmatchedOutcomes,
    dataset.ignoredOtherHorizonOutcomes,
  ];
  if (
    accountingValues.some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    dataset.inputSnapshotCount !==
      dataset.rows.length + dataset.unmatchedSnapshots ||
    dataset.inputAlertCount !==
      dataset.inputSnapshotCount + dataset.missingSnapshots ||
    dataset.inputOutcomeCount !==
      dataset.rows.length +
        dataset.unmatchedOutcomes +
        dataset.ignoredOtherHorizonOutcomes
  ) {
    throw new Error('Alpha dataset accounting is inconsistent');
  }
  const allowedFeatures = new Set<string>(
    ALPHA_FEATURE_REGISTRY.map((definition) => definition.name),
  );
  const alertIds = new Set<string>();
  for (const row of dataset.rows) {
    if (
      row.evaluationId !== dataset.evaluationId ||
      row.alertId.trim().length === 0 ||
      row.instrumentId.trim().length === 0 ||
      alertIds.has(row.alertId) ||
      !Number.isSafeInteger(row.detectedAt) ||
      row.detectedAt < 0 ||
      !Number.isSafeInteger(row.outcomeObservedAt) ||
      row.outcomeObservedAt <
        row.detectedAt + dataset.targetHorizonMinutes * 60_000 ||
      row.horizonMinutes !== dataset.targetHorizonMinutes ||
      (row.direction !== 'BULLISH' && row.direction !== 'BEARISH') ||
      !Number.isFinite(row.grossReturnPercent) ||
      !Number.isFinite(row.netReturnPercent) ||
      !approximatelyEqual(
        row.netReturnPercent,
        row.grossReturnPercent - dataset.roundTripCostPercent,
      )
    ) {
      throw new Error(`Alpha dataset row is invalid: ${row.alertId}`);
    }
    alertIds.add(row.alertId);
    const featureKeys = Object.keys(row.features);
    if (
      featureKeys.length !== ALPHA_FEATURE_NAMES.length ||
      featureKeys.some((key) => !allowedFeatures.has(key)) ||
      ALPHA_FEATURE_NAMES.some((name) => {
        const value = row.features[name];
        return value !== null && !Number.isFinite(value);
      })
    ) {
      throw new Error(`Alpha feature vector is invalid: ${row.alertId}`);
    }
  }
  if (!dataset.synthetic && dataset.rows.some((row) => row.synthetic)) {
    throw new Error('Alpha dataset synthetic accounting is inconsistent');
  }
};

export const parseAlphaResearchDataset = (
  value: unknown,
): AlphaResearchDataset | undefined => {
  try {
    validateAlphaResearchDataset(value);
    return value;
  } catch {
    return undefined;
  }
};

export const createAlphaResearchDataset = (input: {
  readonly evaluationId: string;
  readonly qualifiedAlerts?: readonly unknown[];
  readonly snapshots: readonly AlphaResearchEventSnapshot[];
  readonly outcomes: readonly unknown[];
  readonly config: AlphaResearchConfig;
}): AlphaResearchDataset => {
  const evaluationId = input.evaluationId.trim();
  if (evaluationId.length === 0) {
    throw new Error('evaluationId must not be empty');
  }
  validateAlphaFeatureExtractionConfig(input.config.extraction);
  validateAlphaResearchAnalysisConfig(input.config.analysis);

  const alertById = new Map<string, QualifiedAlertEvidenceRecord>();
  const authoritativeAlerts =
    input.qualifiedAlerts ??
    input.snapshots.map((snapshot) => snapshot.evidence);
  for (const value of authoritativeAlerts) {
    const alert = parseQualifiedAlertEvidenceRecord(value);
    if (
      alert === undefined ||
      alert.evaluationId !== evaluationId ||
      alertById.has(alert.alertId)
    ) {
      throw new Error(
        'Every authoritative alpha alert must be valid and unique',
      );
    }
    alertById.set(alert.alertId, alert);
  }

  const snapshotByAlertId = new Map<string, AlphaResearchEventSnapshot>();
  let synthetic = false;
  for (const snapshot of input.snapshots) {
    const evidence = parseQualifiedAlertEvidenceRecord(snapshot.evidence);
    if (evidence === undefined || evidence.evaluationId !== evaluationId) {
      throw new Error(
        'Every alpha snapshot must contain valid matching evidence',
      );
    }
    if (snapshotByAlertId.has(evidence.alertId)) {
      throw new Error(`Duplicate alpha snapshot for alert ${evidence.alertId}`);
    }
    const authoritativeAlert = alertById.get(evidence.alertId);
    if (
      authoritativeAlert === undefined ||
      JSON.stringify(authoritativeAlert) !== JSON.stringify(evidence)
    ) {
      throw new Error(
        `Alpha snapshot evidence does not match alert ${evidence.alertId}`,
      );
    }
    snapshotByAlertId.set(evidence.alertId, snapshot);
    synthetic ||= snapshot.synthetic;
  }

  const targetOutcomeByAlertId = new Map<string, AlertOutcomeObservation>();
  const seenOutcomeKeys = new Set<string>();
  let unmatchedOutcomes = 0;
  let ignoredOtherHorizonOutcomes = 0;
  for (const value of input.outcomes) {
    const outcome = parseAlertOutcomeObservation(value);
    if (outcome === undefined || outcome.evaluationId !== evaluationId) {
      throw new Error(
        'Every alpha outcome must be valid and match the evaluation',
      );
    }
    const outcomeKey = `${outcome.alertId}:${outcome.horizonMinutes}`;
    if (seenOutcomeKeys.has(outcomeKey)) {
      throw new Error(
        outcome.horizonMinutes === input.config.analysis.targetHorizonMinutes
          ? `Duplicate target-horizon outcome for alert ${outcome.alertId}`
          : `Duplicate outcome for alert ${outcome.alertId} at ${outcome.horizonMinutes} minutes`,
      );
    }
    seenOutcomeKeys.add(outcomeKey);
    const alert = alertById.get(outcome.alertId);
    if (alert === undefined) {
      unmatchedOutcomes += 1;
      continue;
    }
    if (!outcomeMatchesEvidence(alert, outcome)) {
      throw new Error(
        `Outcome does not match qualified alert ${outcome.alertId}`,
      );
    }
    if (outcome.horizonMinutes !== input.config.analysis.targetHorizonMinutes) {
      ignoredOtherHorizonOutcomes += 1;
      continue;
    }
    const snapshot = snapshotByAlertId.get(outcome.alertId);
    if (snapshot === undefined) {
      unmatchedOutcomes += 1;
      continue;
    }
    targetOutcomeByAlertId.set(outcome.alertId, outcome);
  }

  const rows: AlphaResearchDatasetRow[] = [];
  let unmatchedSnapshots = 0;
  for (const snapshot of input.snapshots) {
    const outcome = targetOutcomeByAlertId.get(snapshot.evidence.alertId);
    if (outcome === undefined) {
      unmatchedSnapshots += 1;
      continue;
    }
    const featureVector = resolveAlphaFeatureVector(snapshot, input.config);
    rows.push(
      Object.freeze({
        evaluationId,
        alertId: featureVector.alertId,
        instrumentId: featureVector.instrumentId,
        detectedAt: featureVector.detectedAt,
        direction: featureVector.direction,
        outcomeObservedAt: outcome.observedAt,
        horizonMinutes: outcome.horizonMinutes,
        grossReturnPercent: outcome.directionAdjustedReturnPercent,
        netReturnPercent:
          outcome.directionAdjustedReturnPercent -
          input.config.analysis.roundTripCostPercent,
        features: featureVector.values,
        synthetic: snapshot.synthetic,
      }),
    );
  }
  rows.sort(
    (left, right) =>
      left.detectedAt - right.detectedAt ||
      left.instrumentId.localeCompare(right.instrumentId) ||
      left.alertId.localeCompare(right.alertId),
  );

  const dataset: AlphaResearchDataset = Object.freeze({
    evaluationId,
    targetHorizonMinutes: input.config.analysis.targetHorizonMinutes,
    roundTripCostPercent: input.config.analysis.roundTripCostPercent,
    rows: Object.freeze(rows),
    inputAlertCount: alertById.size,
    inputSnapshotCount: input.snapshots.length,
    inputOutcomeCount: input.outcomes.length,
    unmatchedSnapshots,
    missingSnapshots: alertById.size - snapshotByAlertId.size,
    unmatchedOutcomes,
    ignoredOtherHorizonOutcomes,
    synthetic,
    liveOrderExecutionAllowed: false,
  });
  validateAlphaResearchDataset(dataset);
  return dataset;
};
