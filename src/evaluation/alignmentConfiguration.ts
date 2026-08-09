import { createHash } from 'node:crypto';

import type { SourceFallbackPolicy } from './alignmentTypes';

export const ALIGNMENT_CONFIGURATION_VERSION = 'alignment-v1' as const;

export interface AlignmentConfigurationV1 {
  version: typeof ALIGNMENT_CONFIGURATION_VERSION;
  horizonsMs: readonly number[];
  sourceFallback: SourceFallbackPolicy;
  orderBookMaximumEventLatenessMs: number;
  candleMaximumEventLatenessMs: number;
  localArrivalAllowanceMs: number;
  allowedClockSkewMs: number;
  legacyReferenceMaximumAgeMs: number;
  minimumValidTimestampMs: number;
  maximumValidTimestampMs: number;
  maximumFutureOffsetMs: number;
}

const MINUTE_MS = 60_000;

export const DEFAULT_ALIGNMENT_CONFIGURATION: AlignmentConfigurationV1 =
  Object.freeze({
    version: ALIGNMENT_CONFIGURATION_VERSION,
    horizonsMs: Object.freeze([
      MINUTE_MS,
      5 * MINUTE_MS,
      15 * MINUTE_MS,
      30 * MINUTE_MS,
      60 * MINUTE_MS,
    ]),
    sourceFallback: 'NONE',
    orderBookMaximumEventLatenessMs: 5_000,
    candleMaximumEventLatenessMs: MINUTE_MS,
    localArrivalAllowanceMs: 5_000,
    allowedClockSkewMs: 5_000,
    legacyReferenceMaximumAgeMs: 5_000,
    minimumValidTimestampMs: Date.UTC(2000, 0, 1),
    maximumValidTimestampMs: Date.UTC(2100, 0, 1),
    maximumFutureOffsetMs: 24 * 60 * MINUTE_MS,
  });

const requireNonNegativeSafeInteger = (
  value: number,
  fieldName: string,
): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }
};

export const validateAlignmentConfiguration = (
  configuration: AlignmentConfigurationV1,
): AlignmentConfigurationV1 => {
  if (configuration.version !== ALIGNMENT_CONFIGURATION_VERSION) {
    throw new Error('Unsupported alignment configuration version');
  }

  if (
    configuration.sourceFallback !== 'NONE' &&
    configuration.sourceFallback !== 'BEST_AVAILABLE'
  ) {
    throw new Error('Invalid alignment source fallback policy');
  }

  if (configuration.horizonsMs.length === 0) {
    throw new Error('At least one alignment horizon is required');
  }

  let previousHorizon = 0;
  for (const horizon of configuration.horizonsMs) {
    if (!Number.isSafeInteger(horizon) || horizon <= 0) {
      throw new Error(
        'Alignment horizons must be positive safe integer milliseconds',
      );
    }

    if (horizon <= previousHorizon) {
      throw new Error(
        'Alignment horizons must be unique and strictly increasing',
      );
    }

    previousHorizon = horizon;
  }

  requireNonNegativeSafeInteger(
    configuration.orderBookMaximumEventLatenessMs,
    'orderBookMaximumEventLatenessMs',
  );
  requireNonNegativeSafeInteger(
    configuration.candleMaximumEventLatenessMs,
    'candleMaximumEventLatenessMs',
  );
  requireNonNegativeSafeInteger(
    configuration.localArrivalAllowanceMs,
    'localArrivalAllowanceMs',
  );
  requireNonNegativeSafeInteger(
    configuration.allowedClockSkewMs,
    'allowedClockSkewMs',
  );
  requireNonNegativeSafeInteger(
    configuration.legacyReferenceMaximumAgeMs,
    'legacyReferenceMaximumAgeMs',
  );
  requireNonNegativeSafeInteger(
    configuration.minimumValidTimestampMs,
    'minimumValidTimestampMs',
  );
  requireNonNegativeSafeInteger(
    configuration.maximumValidTimestampMs,
    'maximumValidTimestampMs',
  );
  requireNonNegativeSafeInteger(
    configuration.maximumFutureOffsetMs,
    'maximumFutureOffsetMs',
  );

  if (
    configuration.minimumValidTimestampMs >=
    configuration.maximumValidTimestampMs
  ) {
    throw new Error(
      'minimumValidTimestampMs must be earlier than maximumValidTimestampMs',
    );
  }

  return configuration;
};

export const createAlignmentConfiguration = (
  overrides: Partial<AlignmentConfigurationV1> = {},
): AlignmentConfigurationV1 => {
  const configuration: AlignmentConfigurationV1 = {
    ...DEFAULT_ALIGNMENT_CONFIGURATION,
    ...overrides,
    horizonsMs: Object.freeze([
      ...(overrides.horizonsMs ?? DEFAULT_ALIGNMENT_CONFIGURATION.horizonsMs),
    ]),
  };

  validateAlignmentConfiguration(configuration);
  return Object.freeze(configuration);
};

export const serializeAlignmentConfiguration = (
  configuration: AlignmentConfigurationV1,
): string => {
  validateAlignmentConfiguration(configuration);

  return JSON.stringify({
    version: configuration.version,
    horizonsMs: [...configuration.horizonsMs],
    sourceFallback: configuration.sourceFallback,
    orderBookMaximumEventLatenessMs:
      configuration.orderBookMaximumEventLatenessMs,
    candleMaximumEventLatenessMs: configuration.candleMaximumEventLatenessMs,
    localArrivalAllowanceMs: configuration.localArrivalAllowanceMs,
    allowedClockSkewMs: configuration.allowedClockSkewMs,
    legacyReferenceMaximumAgeMs: configuration.legacyReferenceMaximumAgeMs,
    minimumValidTimestampMs: configuration.minimumValidTimestampMs,
    maximumValidTimestampMs: configuration.maximumValidTimestampMs,
    maximumFutureOffsetMs: configuration.maximumFutureOffsetMs,
  });
};

export const createAlignmentConfigurationFingerprint = (
  configuration: AlignmentConfigurationV1,
): string =>
  createHash('sha256')
    .update(serializeAlignmentConfiguration(configuration))
    .digest('hex');

export const getAlignmentEvaluationConfigVersion = (
  configuration: AlignmentConfigurationV1,
): string =>
  `${configuration.version}:${createAlignmentConfigurationFingerprint(
    configuration,
  )}`;
