import { describe, expect, it } from 'vitest';

import { createAlignmentConfiguration } from '../src/evaluation/alignmentConfiguration';
import {
  AlignmentReason,
  type PriceObservation,
  type ValidityInterval,
} from '../src/evaluation/alignmentTypes';
import {
  calculateTargetTimestamp,
  createInstrumentKey,
  timestampIntersectsValidityGap,
  validateAlignmentReference,
  validateAlignmentTimestamp,
  validateObservationEligibility,
  validatePriceObservation,
  validateTimestampOrdering,
  validateValidityIntervals,
} from '../src/evaluation/alignmentValidation';

const NOW = Date.UTC(2026, 6, 29, 12);
const CONFIGURATION = createAlignmentConfiguration();
const INSTRUMENT = createInstrumentKey('BTC-USDT', 'SPOT');

const createObservation = (
  overrides: Partial<PriceObservation> = {},
): PriceObservation => ({
  instrument: INSTRUMENT,
  source: 'ORDER_BOOK_MIDPOINT',
  eventTimestamp: NOW,
  availabilityTimestamp: NOW + 100,
  recordOrdinal: 1,
  midpoint: 100.5,
  recordingId: 'market-recording:runtime:one',
  sourceSessionId: 'runtime',
  ...overrides,
});

describe('alignment timestamp and observation validation', () => {
  it('accepts valid UTC epoch milliseconds', () => {
    expect(validateAlignmentTimestamp(NOW, CONFIGURATION, NOW)).toEqual({
      valid: true,
      value: NOW,
    });
  });

  it('rejects seconds, unsafe integers, old values, and excessive future values', () => {
    expect(
      validateAlignmentTimestamp(1_785_000_000, CONFIGURATION, NOW),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.TIMESTAMP_UNIT_INVALID,
    });
    expect(
      validateAlignmentTimestamp(
        Number.MAX_SAFE_INTEGER + 1,
        CONFIGURATION,
        NOW,
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.TIMESTAMP_UNIT_INVALID,
    });
    expect(
      validateAlignmentTimestamp(Date.UTC(1999, 0, 1), CONFIGURATION, NOW),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.TIMESTAMP_RANGE_INVALID,
    });
    expect(
      validateAlignmentTimestamp(
        NOW + CONFIGURATION.maximumFutureOffsetMs + 1,
        CONFIGURATION,
        NOW,
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.TIMESTAMP_RANGE_INVALID,
    });
  });

  it('accepts exact horizon boundaries and rejects target overflow', () => {
    expect(calculateTargetTimestamp(NOW, 60_000, CONFIGURATION, NOW)).toEqual({
      valid: true,
      value: NOW + 60_000,
    });

    expect(
      calculateTargetTimestamp(
        CONFIGURATION.maximumValidTimestampMs - 1,
        60_000,
        CONFIGURATION,
        CONFIGURATION.maximumValidTimestampMs,
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.TIMESTAMP_RANGE_INVALID,
    });
  });

  it('allows exchange clock lead within skew and rejects excess skew', () => {
    expect(
      validateTimestampOrdering(
        NOW + CONFIGURATION.allowedClockSkewMs,
        NOW,
        CONFIGURATION,
        NOW + 10_000,
      ).valid,
    ).toBe(true);
    expect(
      validateTimestampOrdering(
        NOW + CONFIGURATION.allowedClockSkewMs + 1,
        NOW,
        CONFIGURATION,
        NOW + 10_000,
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.CLOCK_SKEW_INVALID,
    });
  });

  it('validates source-specific midpoint observations', () => {
    expect(
      validatePriceObservation(createObservation(), CONFIGURATION, NOW + 10_000)
        .valid,
    ).toBe(true);
    expect(
      validatePriceObservation(
        createObservation({ midpoint: 0 }),
        CONFIGURATION,
        NOW + 10_000,
      ).valid,
    ).toBe(false);
    expect(
      validatePriceObservation(
        createObservation({ close: 100 }),
        CONFIGURATION,
        NOW + 10_000,
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.PRICE_SOURCE_MISMATCH,
    });
  });

  it('validates bid/ask observations and rejects crossed books', () => {
    expect(
      validatePriceObservation(
        createObservation({
          source: 'ORDER_BOOK_BID_ASK',
          midpoint: undefined,
          bestBid: 100,
          bestAsk: 101,
        }),
        CONFIGURATION,
        NOW + 10_000,
      ).valid,
    ).toBe(true);
    expect(
      validatePriceObservation(
        createObservation({
          source: 'ORDER_BOOK_BID_ASK',
          midpoint: undefined,
          bestBid: 102,
          bestAsk: 101,
        }),
        CONFIGURATION,
        NOW + 10_000,
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.BOOK_INVALID,
    });
  });

  it('validates confirmed candle close observations and interval ordering', () => {
    const candle = createObservation({
      source: 'CONFIRMED_CANDLE_CLOSE',
      midpoint: undefined,
      close: 101,
      intervalStart: NOW - 60_000,
      intervalEnd: NOW,
      availabilityTimestamp: NOW,
    });

    expect(
      validatePriceObservation(candle, CONFIGURATION, NOW + 10_000).valid,
    ).toBe(true);
    expect(
      validatePriceObservation(
        {
          ...candle,
          intervalEnd: candle.intervalStart,
        },
        CONFIGURATION,
        NOW + 10_000,
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.TIMESTAMP_RANGE_INVALID,
    });
  });

  it('rejects a confirmed candle made available before interval end', () => {
    expect(
      validatePriceObservation(
        createObservation({
          source: 'CONFIRMED_CANDLE_CLOSE',
          midpoint: undefined,
          close: 101,
          intervalStart: NOW - 60_000,
          intervalEnd: NOW,
          availabilityTimestamp: NOW - 1,
        }),
        CONFIGURATION,
        NOW + 10_000,
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.UNCONFIRMED_CANDLE,
    });
  });

  it('requires explicit linkage for inferred legacy references', () => {
    expect(
      validateAlignmentReference(
        {
          provenance: 'INFERRED_FROM_ORDER_BOOK',
          referenceTimestamp: NOW,
          midpoint: 100,
        },
        CONFIGURATION,
        NOW,
      ),
    ).toMatchObject({
      valid: false,
      completeness: 'PARTIAL',
      primaryReason: AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
    });
  });
});

describe('no-look-ahead invariants', () => {
  const validate = (
    observation: PriceObservation,
    overrides: Partial<
      Parameters<typeof validateObservationEligibility>[0]
    > = {},
  ) =>
    validateObservationEligibility({
      observation,
      requestedSource: 'ORDER_BOOK_MIDPOINT',
      sourceFallback: 'NONE',
      targetTimestamp: NOW,
      availableAtTimestamp: NOW + 1_000,
      configuration: CONFIGURATION,
      now: NOW + 10_000,
      ...overrides,
    });

  it('rejects a pre-target observation and accepts the exact boundary', () => {
    expect(
      validate(createObservation({ eventTimestamp: NOW - 1 })),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
    });
    expect(validate(createObservation()).valid).toBe(true);
  });

  it('rejects observations before availability', () => {
    expect(
      validate(createObservation(), { availableAtTimestamp: NOW + 99 }),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.AVAILABILITY_UNKNOWN,
    });
  });

  it('blocks fallback by default and permits explicit best-available fallback', () => {
    const candle = createObservation({
      source: 'CONFIRMED_CANDLE_CLOSE',
      midpoint: undefined,
      close: 101,
      intervalStart: NOW - 60_000,
      intervalEnd: NOW,
      availabilityTimestamp: NOW,
    });

    expect(validate(candle)).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.PRICE_SOURCE_MISMATCH,
    });
    expect(
      validate(candle, { sourceFallback: 'BEST_AVAILABLE' }),
    ).toMatchObject({
      valid: true,
      value: {
        fallbackUsed: true,
        fallbackReason: 'REQUESTED_SOURCE_UNAVAILABLE',
      },
    });
  });

  it('rejects interpolation requests', () => {
    expect(
      validate(createObservation(), { interpolationRequested: true }),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.INTERPOLATION_NOT_ALLOWED,
    });
  });

  it('rejects observations inside a validity gap and accepts the exact end', () => {
    const gaps: ValidityInterval[] = [
      {
        startTimestamp: NOW,
        endTimestamp: NOW + 1_000,
        reason: AlignmentReason.SEQUENCE_GAP,
      },
    ];

    expect(validate(createObservation(), { validityGaps: gaps })).toMatchObject(
      {
        valid: false,
        primaryReason: AlignmentReason.SEQUENCE_GAP,
      },
    );
    expect(
      validate(
        createObservation({
          eventTimestamp: NOW + 1_000,
          availabilityTimestamp: NOW + 1_000,
        }),
        {
          targetTimestamp: NOW + 1_000,
          availableAtTimestamp: NOW + 1_000,
          validityGaps: gaps,
        },
      ).valid,
    ).toBe(true);
  });
});

describe('validity interval contracts', () => {
  it('sorts deterministic non-overlapping intervals and permits open-ended gaps', () => {
    const intervals: ValidityInterval[] = [
      {
        startTimestamp: NOW + 2_000,
        reason: AlignmentReason.RECORDING_TRUNCATED,
      },
      {
        startTimestamp: NOW,
        endTimestamp: NOW + 1_000,
        reason: AlignmentReason.BOOK_INVALID,
      },
    ];
    const result = validateValidityIntervals(
      intervals,
      CONFIGURATION,
      NOW + 10_000,
    );

    expect(result).toMatchObject({
      valid: true,
      value: [
        { startTimestamp: NOW, endTimestamp: NOW + 1_000 },
        { startTimestamp: NOW + 2_000 },
      ],
    });
  });

  it('rejects invalid and overlapping intervals', () => {
    expect(
      validateValidityIntervals(
        [
          {
            startTimestamp: NOW,
            endTimestamp: NOW,
            reason: AlignmentReason.SEQUENCE_GAP,
          },
        ],
        CONFIGURATION,
        NOW + 10_000,
      ).valid,
    ).toBe(false);
    expect(
      validateValidityIntervals(
        [
          {
            startTimestamp: NOW,
            endTimestamp: NOW + 2_000,
            reason: AlignmentReason.SEQUENCE_GAP,
          },
          {
            startTimestamp: NOW + 1_000,
            endTimestamp: NOW + 3_000,
            reason: AlignmentReason.BOOK_INVALID,
          },
        ],
        CONFIGURATION,
        NOW + 10_000,
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.CONFLICTING_DUPLICATE,
    });
  });

  it('uses start-inclusive and end-exclusive gap boundaries', () => {
    const interval: ValidityInterval = {
      startTimestamp: NOW,
      endTimestamp: NOW + 1_000,
      reason: AlignmentReason.SEQUENCE_GAP,
    };

    expect(timestampIntersectsValidityGap(NOW, [interval])).toBe(interval);
    expect(
      timestampIntersectsValidityGap(NOW + 1_000, [interval]),
    ).toBeUndefined();
  });
});
