export const ALERT_OUTCOME_OBSERVATION_SCHEMA_VERSION = 1 as const;

/**
 * Frozen standardized observation horizons. Fractions are minutes so existing
 * dataset consumers remain compatible while the collector can also represent
 * the required 5s, 15s, and 30s observations exactly.
 */
export const ALERT_OUTCOME_HORIZONS_MINUTES = [
  0.08333333333333333, 0.25, 0.5, 1, 3, 5, 15, 30, 60,
] as const;

export type AlertOutcomeHorizonMinutes =
  (typeof ALERT_OUTCOME_HORIZONS_MINUTES)[number];

export type ExcursionMeasurement =
  'OBSERVED_PATH' | 'UNAVAILABLE' | 'LEGACY_UNSPECIFIED';

export type OutcomePathSampling =
  'STANDARDIZED_HORIZON_SAMPLES' | 'LEGACY_UNSPECIFIED';

export const outcomeHorizonMilliseconds = (
  horizonMinutes: AlertOutcomeHorizonMinutes,
): number => Math.round(horizonMinutes * 60_000);

export const formatOutcomeHorizon = (
  horizonMinutes: AlertOutcomeHorizonMinutes,
): string => {
  const milliseconds = outcomeHorizonMilliseconds(horizonMinutes);
  return milliseconds < 60_000
    ? `${milliseconds / 1_000}s`
    : `${milliseconds / 60_000}m`;
};

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
  /** Raw, strategy-independent sampled path measurements. */
  maximumUpwardExcursionPercent?: number;
  maximumDownwardExcursionPercent?: number;
  timeToMaximumFavorableExcursionMs?: number;
  timeToMaximumAdverseExcursionMs?: number;
  timeToMaximumUpwardExcursionMs?: number;
  timeToMaximumDownwardExcursionMs?: number;
  pathSampleCount?: number;
  pathSampling?: OutcomePathSampling;
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
    throw new Error('horizonMinutes must be a supported standardized horizon');
  }
  const expectedObservedAt =
    detectedAt + outcomeHorizonMilliseconds(input.horizonMinutes);
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

  const optionalNonNegative = (
    value: number | undefined,
    name: string,
  ): number | undefined =>
    value === undefined ? undefined : requireFiniteNonNegative(value, name);
  const maximumUpwardExcursionPercent = optionalNonNegative(
    input.maximumUpwardExcursionPercent,
    'maximumUpwardExcursionPercent',
  );
  const maximumDownwardExcursionPercent = optionalNonNegative(
    input.maximumDownwardExcursionPercent,
    'maximumDownwardExcursionPercent',
  );
  const timeToMaximumFavorableExcursionMs = optionalNonNegative(
    input.timeToMaximumFavorableExcursionMs,
    'timeToMaximumFavorableExcursionMs',
  );
  const timeToMaximumAdverseExcursionMs = optionalNonNegative(
    input.timeToMaximumAdverseExcursionMs,
    'timeToMaximumAdverseExcursionMs',
  );
  const timeToMaximumUpwardExcursionMs = optionalNonNegative(
    input.timeToMaximumUpwardExcursionMs,
    'timeToMaximumUpwardExcursionMs',
  );
  const timeToMaximumDownwardExcursionMs = optionalNonNegative(
    input.timeToMaximumDownwardExcursionMs,
    'timeToMaximumDownwardExcursionMs',
  );
  const pathSampleCount = input.pathSampleCount;
  if (
    pathSampleCount !== undefined &&
    (!Number.isSafeInteger(pathSampleCount) || pathSampleCount <= 0)
  ) {
    throw new Error('pathSampleCount must be a positive safe integer');
  }
  const pathSampling = input.pathSampling;
  if (
    pathSampling !== undefined &&
    pathSampling !== 'STANDARDIZED_HORIZON_SAMPLES' &&
    pathSampling !== 'LEGACY_UNSPECIFIED'
  ) {
    throw new Error('pathSampling is invalid');
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
    ...(maximumUpwardExcursionPercent === undefined
      ? {}
      : { maximumUpwardExcursionPercent }),
    ...(maximumDownwardExcursionPercent === undefined
      ? {}
      : { maximumDownwardExcursionPercent }),
    ...(timeToMaximumFavorableExcursionMs === undefined
      ? {}
      : { timeToMaximumFavorableExcursionMs }),
    ...(timeToMaximumAdverseExcursionMs === undefined
      ? {}
      : { timeToMaximumAdverseExcursionMs }),
    ...(timeToMaximumUpwardExcursionMs === undefined
      ? {}
      : { timeToMaximumUpwardExcursionMs }),
    ...(timeToMaximumDownwardExcursionMs === undefined
      ? {}
      : { timeToMaximumDownwardExcursionMs }),
    ...(pathSampleCount === undefined ? {} : { pathSampleCount }),
    ...(pathSampling === undefined ? {} : { pathSampling }),
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
    (value.maximumUpwardExcursionPercent !== undefined &&
      typeof value.maximumUpwardExcursionPercent !== 'number') ||
    (value.maximumDownwardExcursionPercent !== undefined &&
      typeof value.maximumDownwardExcursionPercent !== 'number') ||
    (value.timeToMaximumFavorableExcursionMs !== undefined &&
      typeof value.timeToMaximumFavorableExcursionMs !== 'number') ||
    (value.timeToMaximumAdverseExcursionMs !== undefined &&
      typeof value.timeToMaximumAdverseExcursionMs !== 'number') ||
    (value.timeToMaximumUpwardExcursionMs !== undefined &&
      typeof value.timeToMaximumUpwardExcursionMs !== 'number') ||
    (value.timeToMaximumDownwardExcursionMs !== undefined &&
      typeof value.timeToMaximumDownwardExcursionMs !== 'number') ||
    (value.pathSampleCount !== undefined &&
      typeof value.pathSampleCount !== 'number') ||
    (value.pathSampling !== undefined &&
      value.pathSampling !== 'STANDARDIZED_HORIZON_SAMPLES' &&
      value.pathSampling !== 'LEGACY_UNSPECIFIED') ||
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
      maximumUpwardExcursionPercent: value.maximumUpwardExcursionPercent,
      maximumDownwardExcursionPercent: value.maximumDownwardExcursionPercent,
      timeToMaximumFavorableExcursionMs:
        value.timeToMaximumFavorableExcursionMs,
      timeToMaximumAdverseExcursionMs: value.timeToMaximumAdverseExcursionMs,
      timeToMaximumUpwardExcursionMs: value.timeToMaximumUpwardExcursionMs,
      timeToMaximumDownwardExcursionMs: value.timeToMaximumDownwardExcursionMs,
      pathSampleCount: value.pathSampleCount,
      pathSampling: value.pathSampling,
      excursionMeasurement,
    });
  } catch {
    return undefined;
  }
};
