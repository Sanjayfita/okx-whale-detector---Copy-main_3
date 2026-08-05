export const ALERT_OUTCOME_OBSERVATION_SCHEMA_VERSION = 1 as const;

export const ALERT_OUTCOME_HORIZONS_MINUTES = [1, 5, 15, 30, 60] as const;

export type AlertOutcomeHorizonMinutes =
  (typeof ALERT_OUTCOME_HORIZONS_MINUTES)[number];

export type ExcursionMeasurement =
  'OBSERVED_PATH' | 'UNAVAILABLE' | 'LEGACY_UNSPECIFIED';

export const isAlertOutcomeHorizonMinutes = (
  value: unknown,
): value is AlertOutcomeHorizonMinutes =>
  typeof value === 'number' &&
  ALERT_OUTCOME_HORIZONS_MINUTES.some((horizon) => horizon === value);

export interface AlertOutcomeObservation {
  schemaVersion: typeof ALERT_OUTCOME_OBSERVATION_SCHEMA_VERSION;
  evaluationId: string;
  alertId: string;
  instrumentId: string;
  detectedAt: number;
  horizonMinutes: AlertOutcomeHorizonMinutes;
  observedAt: number;
  referencePrice: number;
  observedPrice: number;
  rawReturnPercent: number;
  directionAdjustedReturnPercent: number;
  maximumFavorableExcursionPercent: number;
  maximumAdverseExcursionPercent: number;
  /**
   * Missing on legacy serialized records. Parsers normalize those records to
   * either OBSERVED_PATH or LEGACY_UNSPECIFIED before analysis.
   */
  excursionMeasurement?: ExcursionMeasurement;
  complete: true;
  liveOrderExecutionAllowed: false;
}

export const hasObservedExcursionPath = (
  observation: Pick<
    AlertOutcomeObservation,
    | 'excursionMeasurement'
    | 'maximumFavorableExcursionPercent'
    | 'maximumAdverseExcursionPercent'
  >,
): boolean =>
  observation.excursionMeasurement === 'OBSERVED_PATH' ||
  (observation.excursionMeasurement === undefined &&
    (observation.maximumFavorableExcursionPercent !== 0 ||
      observation.maximumAdverseExcursionPercent !== 0));

const requireNonEmpty = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
};

const requireTimestamp = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
};

const requireFinitePositive = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return value;
};

const requireFiniteNonNegative = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return value;
};

const requireFinite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
};

const approximatelyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(1e-9, Math.abs(right) * 1e-9);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const createAlertOutcomeObservation = (
  input: Omit<
    AlertOutcomeObservation,
    'schemaVersion' | 'complete' | 'liveOrderExecutionAllowed'
  >,
): AlertOutcomeObservation => {
  const detectedAt = requireTimestamp(input.detectedAt, 'detectedAt');
  const observedAt = requireTimestamp(input.observedAt, 'observedAt');

  if (!ALERT_OUTCOME_HORIZONS_MINUTES.includes(input.horizonMinutes)) {
    throw new Error('horizonMinutes must be one of 1, 5, 15, 30, or 60');
  }
  const expectedObservedAt = detectedAt + input.horizonMinutes * 60_000;
  if (!Number.isSafeInteger(expectedObservedAt)) {
    throw new Error('requested outcome horizon exceeds the timestamp range');
  }
  if (observedAt < expectedObservedAt) {
    throw new Error('observedAt cannot be earlier than the requested horizon');
  }

  const referencePrice = requireFinitePositive(
    input.referencePrice,
    'referencePrice',
  );
  const observedPrice = requireFinitePositive(
    input.observedPrice,
    'observedPrice',
  );
  const rawReturnPercent = requireFinite(
    input.rawReturnPercent,
    'rawReturnPercent',
  );
  const directionAdjustedReturnPercent = requireFinite(
    input.directionAdjustedReturnPercent,
    'directionAdjustedReturnPercent',
  );
  const expectedRawReturnPercent =
    ((observedPrice - referencePrice) / referencePrice) * 100;

  if (!approximatelyEqual(rawReturnPercent, expectedRawReturnPercent)) {
    throw new Error('rawReturnPercent does not match the recorded prices');
  }

  const maximumFavorableExcursionPercent = requireFiniteNonNegative(
    input.maximumFavorableExcursionPercent,
    'maximumFavorableExcursionPercent',
  );
  const maximumAdverseExcursionPercent = requireFiniteNonNegative(
    input.maximumAdverseExcursionPercent,
    'maximumAdverseExcursionPercent',
  );
  const excursionMeasurement = input.excursionMeasurement ?? 'OBSERVED_PATH';
  if (
    excursionMeasurement !== 'OBSERVED_PATH' &&
    excursionMeasurement !== 'UNAVAILABLE' &&
    excursionMeasurement !== 'LEGACY_UNSPECIFIED'
  ) {
    throw new Error('excursionMeasurement is invalid');
  }
  if (
    excursionMeasurement !== 'OBSERVED_PATH' &&
    (maximumFavorableExcursionPercent !== 0 ||
      maximumAdverseExcursionPercent !== 0)
  ) {
    throw new Error(
      'Unavailable excursion measurements must use zero placeholders',
    );
  }

  return Object.freeze({
    schemaVersion: ALERT_OUTCOME_OBSERVATION_SCHEMA_VERSION,
    evaluationId: requireNonEmpty(input.evaluationId, 'evaluationId'),
    alertId: requireNonEmpty(input.alertId, 'alertId'),
    instrumentId: requireNonEmpty(input.instrumentId, 'instrumentId'),
    detectedAt,
    horizonMinutes: input.horizonMinutes,
    observedAt,
    referencePrice,
    observedPrice,
    rawReturnPercent,
    directionAdjustedReturnPercent,
    maximumFavorableExcursionPercent,
    maximumAdverseExcursionPercent,
    excursionMeasurement,
    complete: true,
    liveOrderExecutionAllowed: false,
  });
};

export const parseAlertOutcomeObservation = (
  value: unknown,
): AlertOutcomeObservation | undefined => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== ALERT_OUTCOME_OBSERVATION_SCHEMA_VERSION ||
    value.complete !== true ||
    value.liveOrderExecutionAllowed !== false ||
    typeof value.evaluationId !== 'string' ||
    typeof value.alertId !== 'string' ||
    typeof value.instrumentId !== 'string' ||
    typeof value.detectedAt !== 'number' ||
    !isAlertOutcomeHorizonMinutes(value.horizonMinutes) ||
    typeof value.observedAt !== 'number' ||
    typeof value.referencePrice !== 'number' ||
    typeof value.observedPrice !== 'number' ||
    typeof value.rawReturnPercent !== 'number' ||
    typeof value.directionAdjustedReturnPercent !== 'number' ||
    typeof value.maximumFavorableExcursionPercent !== 'number' ||
    typeof value.maximumAdverseExcursionPercent !== 'number' ||
    (value.excursionMeasurement !== undefined &&
      value.excursionMeasurement !== 'OBSERVED_PATH' &&
      value.excursionMeasurement !== 'UNAVAILABLE' &&
      value.excursionMeasurement !== 'LEGACY_UNSPECIFIED')
  ) {
    return undefined;
  }

  try {
    const excursionMeasurement =
      value.excursionMeasurement === undefined
        ? value.maximumFavorableExcursionPercent === 0 &&
          value.maximumAdverseExcursionPercent === 0
          ? 'LEGACY_UNSPECIFIED'
          : 'OBSERVED_PATH'
        : value.excursionMeasurement;
    return createAlertOutcomeObservation({
      evaluationId: value.evaluationId,
      alertId: value.alertId,
      instrumentId: value.instrumentId,
      detectedAt: value.detectedAt,
      horizonMinutes: value.horizonMinutes,
      observedAt: value.observedAt,
      referencePrice: value.referencePrice,
      observedPrice: value.observedPrice,
      rawReturnPercent: value.rawReturnPercent,
      directionAdjustedReturnPercent: value.directionAdjustedReturnPercent,
      maximumFavorableExcursionPercent: value.maximumFavorableExcursionPercent,
      maximumAdverseExcursionPercent: value.maximumAdverseExcursionPercent,
      excursionMeasurement,
    });
  } catch {
    return undefined;
  }
};
