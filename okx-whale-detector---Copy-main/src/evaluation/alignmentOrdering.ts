import {
  AlignmentReason,
  alignmentFailure,
  alignmentSuccess,
  type AlignmentResult,
  type AlignmentValidationResult,
  type InstrumentKey,
  type PriceObservation,
  type PriceSource,
} from './alignmentTypes';
import {
  instrumentKeysEqual,
  validateInstrumentKey,
} from './alignmentValidation';

export const comparePriceObservations = (
  left: PriceObservation,
  right: PriceObservation,
): number =>
  left.eventTimestamp - right.eventTimestamp ||
  left.availabilityTimestamp - right.availabilityTimestamp ||
  left.recordOrdinal - right.recordOrdinal;

export const sortPriceObservations = (
  observations: readonly PriceObservation[],
): PriceObservation[] => [...observations].sort(comparePriceObservations);

const resultReferenceTimestamp = (result: AlignmentResult): number =>
  result.reference?.referenceTimestamp ?? Number.MAX_SAFE_INTEGER;

export const compareAlignmentResults = (
  left: AlignmentResult,
  right: AlignmentResult,
): number =>
  resultReferenceTimestamp(left) - resultReferenceTimestamp(right) ||
  left.alertId.localeCompare(right.alertId) ||
  left.source.localeCompare(right.source) ||
  left.horizonMs - right.horizonMs;

export const sortAlignmentResults = (
  results: readonly AlignmentResult[],
): AlignmentResult[] => [...results].sort(compareAlignmentResults);

export const findFirstObservationAtOrAfter = (
  observations: readonly PriceObservation[],
  targetTimestamp: number,
  expectedInstrument: InstrumentKey,
  expectedSource: PriceSource,
): AlignmentValidationResult<PriceObservation | undefined> => {
  const instrumentResult = validateInstrumentKey(expectedInstrument);
  if (!instrumentResult.valid) {
    return instrumentResult;
  }

  if (!Number.isSafeInteger(targetTimestamp) || targetTimestamp < 0) {
    return alignmentFailure(AlignmentReason.TIMESTAMP_UNIT_INVALID);
  }

  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    if (!observation) {
      continue;
    }

    if (!instrumentKeysEqual(observation.instrument, expectedInstrument)) {
      return alignmentFailure(AlignmentReason.INSTRUMENT_MISMATCH);
    }

    if (observation.source !== expectedSource) {
      return alignmentFailure(AlignmentReason.PRICE_SOURCE_MISMATCH);
    }

    const previous = observations[index - 1];
    if (
      previous !== undefined &&
      comparePriceObservations(previous, observation) > 0
    ) {
      return alignmentFailure(AlignmentReason.EVENT_TIME_OUT_OF_ORDER);
    }
  }

  let lower = 0;
  let upper = observations.length;

  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const observation = observations[middle];

    if (observation && observation.eventTimestamp < targetTimestamp) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }

  return alignmentSuccess(observations[lower]);
};
