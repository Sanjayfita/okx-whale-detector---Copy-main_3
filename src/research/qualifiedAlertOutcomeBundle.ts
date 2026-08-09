import {
  ALERT_OUTCOME_HORIZONS_MINUTES,
  parseAlertOutcomeObservation,
  type AlertOutcomeObservation,
} from './alertOutcomeObservation';
import {
  parseQualifiedAlertEvidenceRecord,
  type QualifiedAlertEvidenceRecord,
} from './qualifiedAlertEvidence';

export const QUALIFIED_ALERT_OUTCOME_BUNDLE_SCHEMA_VERSION = 1 as const;

export interface QualifiedAlertOutcomeBundle {
  schemaVersion: typeof QUALIFIED_ALERT_OUTCOME_BUNDLE_SCHEMA_VERSION;
  evidence: QualifiedAlertEvidenceRecord;
  observations: readonly AlertOutcomeObservation[];
  completeHorizons: readonly number[];
  complete: true;
  liveOrderExecutionAllowed: false;
}

export const createQualifiedAlertOutcomeBundle = (input: {
  evidence: QualifiedAlertEvidenceRecord;
  observations: readonly AlertOutcomeObservation[];
}): QualifiedAlertOutcomeBundle => {
  const evidence = parseQualifiedAlertEvidenceRecord(input.evidence);
  if (evidence === undefined) {
    throw new Error('Qualified alert evidence is invalid');
  }
  const observations = input.observations.map((observation) => {
    const parsed = parseAlertOutcomeObservation(observation);
    if (parsed === undefined) {
      throw new Error('Alert outcome observation is invalid');
    }
    return parsed;
  });

  if (observations.length !== ALERT_OUTCOME_HORIZONS_MINUTES.length) {
    throw new Error('Exactly five alert outcome observations are required');
  }

  const horizons = new Set<number>();

  for (const observation of observations) {
    if (
      observation.evaluationId !== evidence.evaluationId ||
      observation.alertId !== evidence.alertId ||
      observation.instrumentId !== evidence.instrumentId ||
      observation.detectedAt !== evidence.detectedAt ||
      observation.referencePrice !== evidence.referencePrice
    ) {
      throw new Error(
        'Every observation must match the qualified alert evidence record',
      );
    }
    const expectedDirectionalReturn =
      evidence.direction === 'BULLISH'
        ? observation.rawReturnPercent
        : -observation.rawReturnPercent;
    if (
      Math.abs(
        observation.directionAdjustedReturnPercent - expectedDirectionalReturn,
      ) > Math.max(1e-9, Math.abs(expectedDirectionalReturn) * 1e-9)
    ) {
      throw new Error(
        'Observation direction-adjusted return does not match the alert direction',
      );
    }

    if (horizons.has(observation.horizonMinutes)) {
      throw new Error('Duplicate alert outcome horizons are not allowed');
    }

    horizons.add(observation.horizonMinutes);
  }

  for (const requiredHorizon of ALERT_OUTCOME_HORIZONS_MINUTES) {
    if (!horizons.has(requiredHorizon)) {
      throw new Error(
        `Missing required alert outcome horizon: ${requiredHorizon} minutes`,
      );
    }
  }

  const orderedObservations = [...observations].sort(
    (left, right) => left.horizonMinutes - right.horizonMinutes,
  );

  return Object.freeze({
    schemaVersion: QUALIFIED_ALERT_OUTCOME_BUNDLE_SCHEMA_VERSION,
    evidence,
    observations: Object.freeze(orderedObservations),
    completeHorizons: Object.freeze([...ALERT_OUTCOME_HORIZONS_MINUTES]),
    complete: true,
    liveOrderExecutionAllowed: false,
  });
};

export const validateQualifiedAlertOutcomeBundle = (
  value: QualifiedAlertOutcomeBundle,
): void => {
  if (
    value.schemaVersion !== QUALIFIED_ALERT_OUTCOME_BUNDLE_SCHEMA_VERSION ||
    value.complete !== true ||
    value.liveOrderExecutionAllowed !== false ||
    !Array.isArray(value.observations) ||
    !Array.isArray(value.completeHorizons)
  ) {
    throw new Error('Qualified alert outcome bundle envelope is invalid');
  }
  createQualifiedAlertOutcomeBundle({
    evidence: value.evidence,
    observations: value.observations,
  });
  if (
    value.completeHorizons.length !== ALERT_OUTCOME_HORIZONS_MINUTES.length ||
    value.completeHorizons.some(
      (horizon, index) => horizon !== ALERT_OUTCOME_HORIZONS_MINUTES[index],
    )
  ) {
    throw new Error('Qualified alert outcome bundle horizons are invalid');
  }
};
