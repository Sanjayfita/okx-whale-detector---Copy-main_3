import { describe, expect, it } from 'vitest';

import {
  findFirstObservationAtOrAfter,
  sortAlignmentResults,
  sortPriceObservations,
} from '../src/evaluation/alignmentOrdering';
import {
  ALIGNMENT_SCHEMA_VERSION,
  AlignmentReason,
  type AlignmentResult,
  type PriceObservation,
} from '../src/evaluation/alignmentTypes';
import { createInstrumentKey } from '../src/evaluation/alignmentValidation';

const NOW = Date.UTC(2026, 6, 29, 12);
const INSTRUMENT = createInstrumentKey('BTC-USDT', 'SPOT');

const observation = (
  eventTimestamp: number,
  availabilityTimestamp = eventTimestamp,
  recordOrdinal = 1,
  overrides: Partial<PriceObservation> = {},
): PriceObservation => ({
  instrument: INSTRUMENT,
  source: 'ORDER_BOOK_MIDPOINT',
  eventTimestamp,
  availabilityTimestamp,
  recordOrdinal,
  midpoint: 100,
  recordingId: 'recording-one',
  sourceSessionId: 'session-one',
  ...overrides,
});

const alignmentResult = (
  alertId: string,
  referenceTimestamp: number,
  horizonMs: number,
  source: AlignmentResult['source'] = 'ORDER_BOOK_MIDPOINT',
): AlignmentResult => ({
  alignmentSchemaVersion: ALIGNMENT_SCHEMA_VERSION,
  evaluationConfigVersion: 'alignment-v1:fingerprint',
  alertId,
  instrument: INSTRUMENT,
  source,
  horizonMs,
  reference: {
    provenance: 'CAPTURED_ALERT_CONTEXT',
    referenceTimestamp,
    midpoint: 100,
  },
  targetTimestamp: referenceTimestamp + horizonMs,
  selectedObservation: null,
  observationDelayMs: null,
  availabilityDelayMs: null,
  completeness: 'MISSING',
  primaryReason: AlignmentReason.NO_SAMPLE_AFTER_HORIZON,
  reasons: [AlignmentReason.NO_SAMPLE_AFTER_HORIZON],
  sourceSessionId: 'session-one',
  recordingId: 'recording-one',
  validityGaps: [],
  fallbackUsed: false,
  fallbackReason: null,
});

describe('alignment observation ordering', () => {
  it('returns no observation from an empty collection', () => {
    expect(
      findFirstObservationAtOrAfter([], NOW, INSTRUMENT, 'ORDER_BOOK_MIDPOINT'),
    ).toEqual({ valid: true, value: undefined });
  });

  it('selects the exact target and the first observation after a target', () => {
    const observations = [
      observation(NOW - 1_000, NOW - 900, 1),
      observation(NOW, NOW + 100, 2),
      observation(NOW + 1_000, NOW + 1_100, 3),
    ];

    expect(
      findFirstObservationAtOrAfter(
        observations,
        NOW,
        INSTRUMENT,
        'ORDER_BOOK_MIDPOINT',
      ),
    ).toEqual({ valid: true, value: observations[1] });
    expect(
      findFirstObservationAtOrAfter(
        observations,
        NOW + 1,
        INSTRUMENT,
        'ORDER_BOOK_MIDPOINT',
      ),
    ).toEqual({ valid: true, value: observations[2] });
  });

  it('returns no observation when every observation precedes the target', () => {
    expect(
      findFirstObservationAtOrAfter(
        [observation(NOW - 2), observation(NOW - 1)],
        NOW,
        INSTRUMENT,
        'ORDER_BOOK_MIDPOINT',
      ),
    ).toEqual({ valid: true, value: undefined });
  });

  it('resolves equal event times by availability and file ordinal', () => {
    const observations = sortPriceObservations([
      observation(NOW, NOW + 200, 3),
      observation(NOW, NOW + 100, 2),
      observation(NOW, NOW + 100, 1),
    ]);

    expect(observations.map((value) => value.recordOrdinal)).toEqual([1, 2, 3]);
    expect(
      findFirstObservationAtOrAfter(
        observations,
        NOW,
        INSTRUMENT,
        'ORDER_BOOK_MIDPOINT',
      ),
    ).toEqual({ valid: true, value: observations[0] });
  });

  it('rejects mixed instruments and sources', () => {
    expect(
      findFirstObservationAtOrAfter(
        [
          observation(NOW, NOW, 1, {
            instrument: createInstrumentKey('ETH-USDT', 'SPOT'),
          }),
        ],
        NOW,
        INSTRUMENT,
        'ORDER_BOOK_MIDPOINT',
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.INSTRUMENT_MISMATCH,
    });
    expect(
      findFirstObservationAtOrAfter(
        [
          observation(NOW, NOW, 1, {
            source: 'ORDER_BOOK_BID_ASK',
            midpoint: undefined,
            bestBid: 99,
            bestAsk: 101,
          }),
        ],
        NOW,
        INSTRUMENT,
        'ORDER_BOOK_MIDPOINT',
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.PRICE_SOURCE_MISMATCH,
    });
  });

  it('rejects observations not already in deterministic order', () => {
    expect(
      findFirstObservationAtOrAfter(
        [observation(NOW + 1, NOW + 1, 2), observation(NOW, NOW, 1)],
        NOW,
        INSTRUMENT,
        'ORDER_BOOK_MIDPOINT',
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
    });
  });

  it('sorts without mutating the caller collection', () => {
    const first = observation(NOW + 1, NOW + 1, 2);
    const second = observation(NOW, NOW, 1);
    const input = [first, second];

    expect(sortPriceObservations(input)).toEqual([second, first]);
    expect(input).toEqual([first, second]);
  });
});

describe('alignment result ordering', () => {
  it('orders by reference time, alert ID, source, and horizon', () => {
    const results = [
      alignmentResult('alert-b', NOW, 300_000),
      alignmentResult('alert-a', NOW, 300_000, 'ORDER_BOOK_BID_ASK'),
      alignmentResult('alert-a', NOW, 60_000, 'ORDER_BOOK_BID_ASK'),
      alignmentResult('alert-z', NOW - 1, 300_000),
    ];

    expect(
      sortAlignmentResults(results).map(
        (result) => `${result.alertId}:${result.source}:${result.horizonMs}`,
      ),
    ).toEqual([
      'alert-z:ORDER_BOOK_MIDPOINT:300000',
      'alert-a:ORDER_BOOK_BID_ASK:60000',
      'alert-a:ORDER_BOOK_BID_ASK:300000',
      'alert-b:ORDER_BOOK_MIDPOINT:300000',
    ]);
    expect(results[0]?.alertId).toBe('alert-b');
  });
});
