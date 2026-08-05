import {
  parseAlertOutcomeObservation,
  type AlertOutcomeObservation,
} from './alertOutcomeObservation';
import {
  parseQualifiedAlertEvidenceRecord,
  type QualifiedAlertEvidenceRecord,
} from './qualifiedAlertEvidence';

export interface JoinedEvidenceObservation {
  readonly alert: QualifiedAlertEvidenceRecord;
  readonly outcome: AlertOutcomeObservation;
}

export interface EvidenceIntegrityResult {
  readonly alerts: readonly QualifiedAlertEvidenceRecord[];
  readonly outcomes: readonly AlertOutcomeObservation[];
  readonly joined: readonly JoinedEvidenceObservation[];
  readonly unmatchedObservations: number;
  readonly malformedRecords: number;
}

const approximatelyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(1e-9, Math.abs(right) * 1e-9);

const outcomeMatchesAlert = (
  alert: QualifiedAlertEvidenceRecord,
  outcome: AlertOutcomeObservation,
): boolean => {
  if (
    outcome.evaluationId !== alert.evaluationId ||
    outcome.instrumentId !== alert.instrumentId ||
    outcome.detectedAt !== alert.detectedAt ||
    !approximatelyEqual(outcome.referencePrice, alert.referencePrice)
  ) {
    return false;
  }

  const expectedDirectionalReturn =
    alert.direction === 'BEARISH'
      ? -outcome.rawReturnPercent
      : outcome.rawReturnPercent;

  return approximatelyEqual(
    outcome.directionAdjustedReturnPercent,
    expectedDirectionalReturn,
  );
};

export const prepareEvidenceRecords = (input: {
  readonly evaluationId: string;
  readonly alerts: readonly unknown[];
  readonly outcomes: readonly unknown[];
  readonly malformedRecords?: number;
}): EvidenceIntegrityResult => {
  const evaluationId = input.evaluationId.trim();
  if (evaluationId.length === 0) {
    throw new Error('evaluationId must not be empty');
  }

  const initialMalformed = input.malformedRecords ?? 0;
  if (!Number.isSafeInteger(initialMalformed) || initialMalformed < 0) {
    throw new Error('malformedRecords must be a non-negative safe integer');
  }

  let malformedRecords = initialMalformed;
  const alertById = new Map<string, QualifiedAlertEvidenceRecord>();

  for (const value of input.alerts) {
    const alert = parseQualifiedAlertEvidenceRecord(value);

    if (
      !alert ||
      alert.evaluationId !== evaluationId ||
      alertById.has(alert.alertId)
    ) {
      malformedRecords += 1;
      continue;
    }

    alertById.set(alert.alertId, alert);
  }

  const outcomes: AlertOutcomeObservation[] = [];
  const joined: JoinedEvidenceObservation[] = [];
  const outcomeKeys = new Set<string>();
  let unmatchedObservations = 0;

  for (const value of input.outcomes) {
    const outcome = parseAlertOutcomeObservation(value);

    if (!outcome || outcome.evaluationId !== evaluationId) {
      malformedRecords += 1;
      continue;
    }

    const outcomeKey = `${outcome.alertId}:${outcome.horizonMinutes}`;
    if (outcomeKeys.has(outcomeKey)) {
      malformedRecords += 1;
      continue;
    }

    const alert = alertById.get(outcome.alertId);
    if (!alert) {
      outcomeKeys.add(outcomeKey);
      outcomes.push(outcome);
      unmatchedObservations += 1;
      continue;
    }

    if (!outcomeMatchesAlert(alert, outcome)) {
      malformedRecords += 1;
      continue;
    }

    outcomeKeys.add(outcomeKey);
    outcomes.push(outcome);
    joined.push(Object.freeze({ alert, outcome }));
  }

  return Object.freeze({
    alerts: Object.freeze([...alertById.values()]),
    outcomes: Object.freeze(outcomes),
    joined: Object.freeze(joined),
    unmatchedObservations,
    malformedRecords,
  });
};
