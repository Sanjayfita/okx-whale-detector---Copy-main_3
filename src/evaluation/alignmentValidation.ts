import type { MarketRecordingHeaderRecord } from '../recording/marketRecordingFormat';
import { isValidRuntimeSessionId } from '../runtime/runtimeSession';
import type { MarketInstrumentConfig } from '../types/instrument';
import type { AlignmentConfigurationV1 } from './alignmentConfiguration';
import {
  AlignmentReason,
  alignmentFailure,
  alignmentSuccess,
  type AlignmentReference,
  type AlignmentValidationResult,
  type EligibleObservation,
  type InstrumentKey,
  type PriceObservation,
  type PriceSource,
  type SourceFallbackPolicy,
  type ValidityInterval,
  type ValidityGapReason,
} from './alignmentTypes';

const SECOND_SCALE_UPPER_BOUND = 100_000_000_000;
const INSTRUMENT_ID_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/;
const RECORDING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const hasValue = (value: unknown): boolean => value !== undefined;

export const validateInstrumentKey = (
  value: unknown,
): AlignmentValidationResult<InstrumentKey> => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('instId' in value) ||
    !('instType' in value)
  ) {
    return alignmentFailure(AlignmentReason.INSTRUMENT_METADATA_MISSING);
  }

  const instrument = value as Record<string, unknown>;
  if (
    typeof instrument.instId !== 'string' ||
    !INSTRUMENT_ID_PATTERN.test(instrument.instId) ||
    (instrument.instType !== 'SPOT' && instrument.instType !== 'SWAP')
  ) {
    return alignmentFailure(AlignmentReason.INSTRUMENT_METADATA_CONFLICT);
  }

  return alignmentSuccess({
    instId: instrument.instId,
    instType: instrument.instType,
  });
};

export const createInstrumentKey = (
  instId: string,
  instType: InstrumentKey['instType'],
): InstrumentKey => {
  const result = validateInstrumentKey({ instId, instType });

  if (!result.valid) {
    throw new Error(`Invalid authoritative instrument key: ${instId}`);
  }

  return Object.freeze(result.value);
};

export const serializeInstrumentKey = (instrument: InstrumentKey): string => {
  const result = validateInstrumentKey(instrument);

  if (!result.valid) {
    throw new Error('Cannot serialize an invalid instrument key');
  }

  return JSON.stringify([result.value.instId, result.value.instType]);
};

export const instrumentKeysEqual = (
  left: InstrumentKey,
  right: InstrumentKey,
): boolean => left.instId === right.instId && left.instType === right.instType;

export const validateAlignmentTimestamp = (
  value: unknown,
  configuration: AlignmentConfigurationV1,
  now: number,
): AlignmentValidationResult<number> => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return alignmentFailure(AlignmentReason.TIMESTAMP_UNIT_INVALID);
  }

  if (value < SECOND_SCALE_UPPER_BOUND) {
    return alignmentFailure(AlignmentReason.TIMESTAMP_UNIT_INVALID);
  }

  const maximumForNow = Math.min(
    configuration.maximumValidTimestampMs,
    now + configuration.maximumFutureOffsetMs,
  );

  if (value < configuration.minimumValidTimestampMs || value > maximumForNow) {
    return alignmentFailure(AlignmentReason.TIMESTAMP_RANGE_INVALID);
  }

  return alignmentSuccess(value);
};

export const validateTimestampOrdering = (
  eventTimestamp: unknown,
  availabilityTimestamp: unknown,
  configuration: AlignmentConfigurationV1,
  now: number,
): AlignmentValidationResult<{
  eventTimestamp: number;
  availabilityTimestamp: number;
  availabilityDelayMs: number;
}> => {
  const eventResult = validateAlignmentTimestamp(
    eventTimestamp,
    configuration,
    now,
  );
  if (!eventResult.valid) {
    return eventResult;
  }

  const availabilityResult = validateAlignmentTimestamp(
    availabilityTimestamp,
    configuration,
    now,
  );
  if (!availabilityResult.valid) {
    return availabilityResult;
  }

  if (
    eventResult.value >
    availabilityResult.value + configuration.allowedClockSkewMs
  ) {
    return alignmentFailure(AlignmentReason.CLOCK_SKEW_INVALID);
  }

  return alignmentSuccess({
    eventTimestamp: eventResult.value,
    availabilityTimestamp: availabilityResult.value,
    availabilityDelayMs: availabilityResult.value - eventResult.value,
  });
};

export const calculateTargetTimestamp = (
  referenceTimestamp: unknown,
  horizonMs: unknown,
  configuration: AlignmentConfigurationV1,
  now: number,
): AlignmentValidationResult<number> => {
  const referenceResult = validateAlignmentTimestamp(
    referenceTimestamp,
    configuration,
    now,
  );
  if (!referenceResult.valid) {
    return referenceResult;
  }

  if (
    typeof horizonMs !== 'number' ||
    !Number.isSafeInteger(horizonMs) ||
    horizonMs <= 0
  ) {
    return alignmentFailure(AlignmentReason.TIMESTAMP_RANGE_INVALID);
  }

  const target = referenceResult.value + horizonMs;
  if (
    !Number.isSafeInteger(target) ||
    target > configuration.maximumValidTimestampMs
  ) {
    return alignmentFailure(AlignmentReason.TIMESTAMP_RANGE_INVALID);
  }

  return alignmentSuccess(target);
};

const validateObservationIdentity = (
  observation: PriceObservation,
): AlignmentValidationResult<PriceObservation> => {
  const instrumentResult = validateInstrumentKey(observation.instrument);
  if (!instrumentResult.valid) {
    return instrumentResult;
  }

  if (
    !isValidRuntimeSessionId(observation.sourceSessionId) ||
    !RECORDING_ID_PATTERN.test(observation.recordingId)
  ) {
    return alignmentFailure(AlignmentReason.NO_MATCHING_MARKET_SESSION);
  }

  if (
    !Number.isSafeInteger(observation.recordOrdinal) ||
    observation.recordOrdinal <= 0
  ) {
    return alignmentFailure(AlignmentReason.EVENT_TIME_OUT_OF_ORDER);
  }

  return alignmentSuccess(observation);
};

const hasOnlyFields = (
  observation: PriceObservation,
  allowed: ReadonlySet<keyof PriceObservation>,
): boolean => {
  const sourceFields: Array<keyof PriceObservation> = [
    'midpoint',
    'bestBid',
    'bestAsk',
    'close',
    'intervalStart',
    'intervalEnd',
  ];

  return sourceFields.every(
    (field) => !hasValue(observation[field]) || allowed.has(field),
  );
};

export const validatePriceObservation = (
  observation: PriceObservation,
  configuration: AlignmentConfigurationV1,
  now: number,
): AlignmentValidationResult<PriceObservation> => {
  const identityResult = validateObservationIdentity(observation);
  if (!identityResult.valid) {
    return identityResult;
  }

  const timestampResult = validateTimestampOrdering(
    observation.eventTimestamp,
    observation.availabilityTimestamp,
    configuration,
    now,
  );
  if (!timestampResult.valid) {
    return timestampResult;
  }

  if (observation.source === 'ORDER_BOOK_MIDPOINT') {
    if (
      !isPositiveFinite(observation.midpoint) ||
      !hasOnlyFields(observation, new Set(['midpoint']))
    ) {
      return alignmentFailure(AlignmentReason.PRICE_SOURCE_MISMATCH);
    }

    return alignmentSuccess(observation);
  }

  if (observation.source === 'ORDER_BOOK_BID_ASK') {
    if (
      !isPositiveFinite(observation.bestBid) ||
      !isPositiveFinite(observation.bestAsk) ||
      observation.bestAsk < observation.bestBid ||
      !hasOnlyFields(observation, new Set(['bestBid', 'bestAsk']))
    ) {
      return alignmentFailure(AlignmentReason.BOOK_INVALID);
    }

    return alignmentSuccess(observation);
  }

  if (observation.source !== 'CONFIRMED_CANDLE_CLOSE') {
    return alignmentFailure(AlignmentReason.PRICE_SOURCE_MISMATCH);
  }

  if (
    !isPositiveFinite(observation.close) ||
    !hasOnlyFields(
      observation,
      new Set(['close', 'intervalStart', 'intervalEnd']),
    )
  ) {
    return alignmentFailure(AlignmentReason.PRICE_SOURCE_MISMATCH);
  }

  const intervalStartResult = validateAlignmentTimestamp(
    observation.intervalStart,
    configuration,
    now,
  );
  if (!intervalStartResult.valid) {
    return intervalStartResult;
  }
  const intervalEndResult = validateAlignmentTimestamp(
    observation.intervalEnd,
    configuration,
    now,
  );
  if (!intervalEndResult.valid) {
    return intervalEndResult;
  }

  if (intervalEndResult.value <= intervalStartResult.value) {
    return alignmentFailure(AlignmentReason.TIMESTAMP_RANGE_INVALID);
  }

  if (observation.availabilityTimestamp < intervalEndResult.value) {
    return alignmentFailure(AlignmentReason.UNCONFIRMED_CANDLE);
  }

  return alignmentSuccess(observation);
};

export const validateAlignmentReference = (
  reference: AlignmentReference,
  configuration: AlignmentConfigurationV1,
  now: number,
): AlignmentValidationResult<AlignmentReference> => {
  const timestampResult = validateAlignmentTimestamp(
    reference.referenceTimestamp,
    configuration,
    now,
  );
  if (!timestampResult.valid) {
    return timestampResult;
  }

  if (!isPositiveFinite(reference.midpoint)) {
    return alignmentFailure(AlignmentReason.NO_REFERENCE_CONTEXT, 'MISSING');
  }

  if (
    (reference.bestBid !== undefined && !isPositiveFinite(reference.bestBid)) ||
    (reference.bestAsk !== undefined && !isPositiveFinite(reference.bestAsk)) ||
    (reference.bestBid !== undefined &&
      reference.bestAsk !== undefined &&
      reference.bestAsk < reference.bestBid)
  ) {
    return alignmentFailure(AlignmentReason.BOOK_INVALID);
  }

  if (
    reference.provenance === 'INFERRED_FROM_ORDER_BOOK' &&
    (!reference.legacyManifestId ||
      reference.legacyManifestId.trim().length === 0)
  ) {
    return alignmentFailure(
      AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
      'PARTIAL',
    );
  }

  if (
    reference.provenance === 'CAPTURED_ALERT_CONTEXT' &&
    reference.legacyManifestId !== undefined
  ) {
    return alignmentFailure(AlignmentReason.NO_REFERENCE_CONTEXT);
  }

  return alignmentSuccess(reference);
};

export const VALIDITY_GAP_OVERLAP_POLICY = 'REJECT_OVERLAP' as const;

const VALIDITY_GAP_REASONS = new Set<ValidityGapReason>([
  AlignmentReason.SEQUENCE_GAP,
  AlignmentReason.BOOK_INVALID,
  AlignmentReason.RECORDING_TRUNCATED,
  AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
]);

export const validateValidityIntervals = (
  intervals: readonly ValidityInterval[],
  configuration: AlignmentConfigurationV1,
  now: number,
): AlignmentValidationResult<readonly ValidityInterval[]> => {
  const sorted = intervals.map((interval) => ({ ...interval }));

  for (const interval of sorted) {
    if (!VALIDITY_GAP_REASONS.has(interval.reason)) {
      return alignmentFailure(AlignmentReason.BOOK_INVALID);
    }

    const startResult = validateAlignmentTimestamp(
      interval.startTimestamp,
      configuration,
      now,
    );
    if (!startResult.valid) {
      return startResult;
    }

    if (interval.endTimestamp !== undefined) {
      const endResult = validateAlignmentTimestamp(
        interval.endTimestamp,
        configuration,
        now,
      );
      if (!endResult.valid) {
        return endResult;
      }

      if (endResult.value <= startResult.value) {
        return alignmentFailure(AlignmentReason.TIMESTAMP_RANGE_INVALID);
      }
    }
  }

  sorted.sort(
    (left, right) =>
      left.startTimestamp - right.startTimestamp ||
      (left.endTimestamp ?? Number.MAX_SAFE_INTEGER) -
        (right.endTimestamp ?? Number.MAX_SAFE_INTEGER) ||
      left.reason.localeCompare(right.reason),
  );

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      (previous.endTimestamp === undefined ||
        current.startTimestamp < previous.endTimestamp)
    ) {
      return alignmentFailure(AlignmentReason.CONFLICTING_DUPLICATE);
    }
  }

  return alignmentSuccess(Object.freeze(sorted));
};

export const timestampIntersectsValidityGap = (
  timestamp: number,
  intervals: readonly ValidityInterval[],
): ValidityInterval | undefined =>
  intervals.find(
    (interval) =>
      timestamp >= interval.startTimestamp &&
      (interval.endTimestamp === undefined ||
        timestamp < interval.endTimestamp),
  );

export interface ObservationEligibilityRequest {
  observation: PriceObservation;
  requestedSource: PriceSource;
  sourceFallback: SourceFallbackPolicy;
  targetTimestamp: number;
  availableAtTimestamp: number;
  configuration: AlignmentConfigurationV1;
  now: number;
  validityGaps?: readonly ValidityInterval[];
  reference?: AlignmentReference;
  interpolationRequested?: boolean;
}

const maximumEventLateness = (
  source: PriceSource,
  configuration: AlignmentConfigurationV1,
): number =>
  source === 'CONFIRMED_CANDLE_CLOSE'
    ? configuration.candleMaximumEventLatenessMs
    : configuration.orderBookMaximumEventLatenessMs;

export const validateObservationEligibility = (
  request: ObservationEligibilityRequest,
): AlignmentValidationResult<EligibleObservation> => {
  const observationResult = validatePriceObservation(
    request.observation,
    request.configuration,
    request.now,
  );
  if (!observationResult.valid) {
    return observationResult;
  }

  const targetResult = validateAlignmentTimestamp(
    request.targetTimestamp,
    request.configuration,
    request.now,
  );
  if (!targetResult.valid) {
    return targetResult;
  }

  const availableAtResult = validateAlignmentTimestamp(
    request.availableAtTimestamp,
    request.configuration,
    request.now,
  );
  if (!availableAtResult.valid) {
    return availableAtResult;
  }

  if (request.interpolationRequested === true) {
    return alignmentFailure(AlignmentReason.INTERPOLATION_NOT_ALLOWED);
  }

  if (request.reference) {
    const referenceResult = validateAlignmentReference(
      request.reference,
      request.configuration,
      request.now,
    );
    if (!referenceResult.valid) {
      return referenceResult;
    }
  }

  const fallbackUsed = request.observation.source !== request.requestedSource;
  if (fallbackUsed && request.sourceFallback === 'NONE') {
    return alignmentFailure(AlignmentReason.PRICE_SOURCE_MISMATCH);
  }

  const observationDelayMs =
    request.observation.eventTimestamp - targetResult.value;
  if (observationDelayMs < 0) {
    return alignmentFailure(AlignmentReason.EVENT_TIME_OUT_OF_ORDER);
  }

  if (
    observationDelayMs >
    maximumEventLateness(request.observation.source, request.configuration)
  ) {
    return alignmentFailure(AlignmentReason.SAMPLE_TOO_LATE, 'MISSING');
  }

  if (availableAtResult.value < request.observation.availabilityTimestamp) {
    return alignmentFailure(AlignmentReason.AVAILABILITY_UNKNOWN, 'MISSING');
  }

  const maximumArrivalTimestamp =
    request.observation.eventTimestamp +
    request.configuration.localArrivalAllowanceMs +
    request.configuration.allowedClockSkewMs;
  if (
    !Number.isSafeInteger(maximumArrivalTimestamp) ||
    request.observation.availabilityTimestamp > maximumArrivalTimestamp
  ) {
    return alignmentFailure(AlignmentReason.SAMPLE_TOO_LATE, 'MISSING');
  }

  const gapsResult = validateValidityIntervals(
    request.validityGaps ?? [],
    request.configuration,
    request.now,
  );
  if (!gapsResult.valid) {
    return gapsResult;
  }

  const gap = timestampIntersectsValidityGap(
    request.observation.eventTimestamp,
    gapsResult.value,
  );
  if (gap) {
    return alignmentFailure(gap.reason, 'MISSING');
  }

  return alignmentSuccess({
    observation: request.observation,
    observationDelayMs,
    availabilityDelayMs:
      request.observation.availabilityTimestamp -
      request.observation.eventTimestamp,
    fallbackUsed,
    fallbackReason: fallbackUsed ? 'REQUESTED_SOURCE_UNAVAILABLE' : null,
  });
};

export interface SessionLinkageRequest {
  alertSourceSessionId?: string;
  expectedRecordingId?: string;
  instrument: InstrumentKey;
  candidateHeaders: readonly MarketRecordingHeaderRecord[];
}

export interface SessionLinkageMatch {
  header: MarketRecordingHeaderRecord;
  instrument: MarketInstrumentConfig;
}

export const validateSessionLinkage = (
  request: SessionLinkageRequest,
): AlignmentValidationResult<SessionLinkageMatch> => {
  const instrumentResult = validateInstrumentKey(request.instrument);
  if (!instrumentResult.valid) {
    return instrumentResult;
  }

  if (!isValidRuntimeSessionId(request.alertSourceSessionId)) {
    return alignmentFailure(
      AlignmentReason.NO_MATCHING_MARKET_SESSION,
      'MISSING',
    );
  }

  if (
    request.expectedRecordingId !== undefined &&
    !RECORDING_ID_PATTERN.test(request.expectedRecordingId)
  ) {
    return alignmentFailure(AlignmentReason.RECORDING_ID_MISSING, 'MISSING');
  }

  const sessionMatches = request.candidateHeaders.filter(
    (header) => header.sourceSessionId === request.alertSourceSessionId,
  );
  const recordingMatches =
    request.expectedRecordingId === undefined
      ? sessionMatches
      : sessionMatches.filter(
          (header) => header.recordingId === request.expectedRecordingId,
        );

  if (recordingMatches.length === 0) {
    return alignmentFailure(
      AlignmentReason.NO_MATCHING_MARKET_SESSION,
      'MISSING',
    );
  }

  if (recordingMatches.length > 1) {
    return alignmentFailure(
      AlignmentReason.MARKET_SESSION_AMBIGUOUS,
      'AMBIGUOUS',
    );
  }

  const header = recordingMatches[0];
  if (!header || !RECORDING_ID_PATTERN.test(header.recordingId)) {
    return alignmentFailure(AlignmentReason.RECORDING_ID_MISSING, 'MISSING');
  }

  if (header.instruments.length === 0) {
    return alignmentFailure(
      AlignmentReason.INSTRUMENT_METADATA_MISSING,
      'MISSING',
    );
  }

  const sameIdentifier = header.instruments.filter(
    (instrument) => instrument.instId === request.instrument.instId,
  );
  const exact = sameIdentifier.find(
    (instrument) => instrument.instType === request.instrument.instType,
  );

  if (exact) {
    return alignmentSuccess({ header, instrument: exact });
  }

  if (sameIdentifier.length > 0) {
    return alignmentFailure(
      AlignmentReason.INSTRUMENT_METADATA_CONFLICT,
      'AMBIGUOUS',
    );
  }

  return alignmentFailure(AlignmentReason.INSTRUMENT_MISMATCH, 'MISSING');
};
