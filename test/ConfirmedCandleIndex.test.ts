import { describe, expect, it } from 'vitest';

import { ConfirmedCandleIndex } from '../src/evaluation/confirmedCandleIndex';
import type {
  NormalizedCandleRecording,
  NormalizedConfirmedCandle,
} from '../src/evaluation/candleNormalization';
import { AlignmentReason } from '../src/evaluation/alignmentTypes';
import { createInstrumentKey } from '../src/evaluation/alignmentValidation';

const NOW = Date.UTC(2026, 6, 29, 12);
const SPOT = createInstrumentKey('BTC-USDT', 'SPOT');
const SWAP = createInstrumentKey('BTC-USDT-SWAP', 'SWAP');

const candle = (
  intervalEnd: number,
  recordOrdinal: number,
  overrides: Partial<NormalizedConfirmedCandle> = {},
): NormalizedConfirmedCandle => ({
  instrument: SPOT,
  interval: '1m',
  intervalStart: intervalEnd - 60_000,
  intervalEnd,
  eventTimestamp: intervalEnd,
  availabilityTimestamp: intervalEnd,
  recordedAt: intervalEnd,
  recordOrdinal,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 10,
  sourceSessionId: 'session-one',
  recordingId: 'recording-one',
  ...overrides,
});

const recording = (
  candles: readonly NormalizedConfirmedCandle[],
  conflicts: NormalizedCandleRecording['duplicateGroups'] = [],
): NormalizedCandleRecording => ({
  header: {
    recordType: 'header',
    schemaVersion: 1,
    recordedAt: NOW,
    sourceSessionId: 'session-one',
    recordingId: 'recording-one',
    startedAt: NOW,
    producer: { name: 'test', version: '1' },
    clockBasis: {
      eventTime: 'UTC_EPOCH_MS',
      availabilityTime: 'UTC_EPOCH_MS',
      arrivalOrder: 'FILE_ORDINAL',
    },
    instruments: [],
    subscriptions: {
      orderBookChannel: 'books',
      orderBookDepth: 400,
      candleIntervals: ['1m'],
    },
  },
  footer: null,
  termination: 'TRUNCATED',
  confirmedCandles: candles,
  formingCandleCount: 0,
  identicalDuplicateCount: 0,
  duplicateGroups: conflicts,
  finalFileRecordCount: candles.length + 1,
});

describe('ConfirmedCandleIndex', () => {
  it('selects exact boundaries and the first candle after a target', () => {
    const first = candle(NOW + 60_000, 2);
    const second = candle(NOW + 120_000, 3);
    const index = new ConfirmedCandleIndex(recording([second, first]));

    expect(index.findFirstAtOrAfter(SPOT, '1m', first.intervalEnd)).toEqual({
      valid: true,
      value: first,
    });
    expect(index.findFirstAtOrAfter(SPOT, '1m', first.intervalEnd + 1)).toEqual(
      { valid: true, value: second },
    );
  });

  it('returns an empty result when all candles precede the target', () => {
    expect(
      new ConfirmedCandleIndex(
        recording([candle(NOW + 60_000, 2)]),
      ).findFirstAtOrAfter(SPOT, '1m', NOW + 60_001),
    ).toEqual({ valid: true, value: undefined });
  });

  it('returns a deterministic inclusive range', () => {
    const first = candle(NOW + 60_000, 2);
    const second = candle(NOW + 120_000, 3);
    const third = candle(NOW + 180_000, 4);
    const index = new ConfirmedCandleIndex(recording([third, first, second]));

    expect(index.findRange(SPOT, '1m', NOW + 60_001, NOW + 180_000)).toEqual({
      valid: true,
      value: [second, third],
    });
  });

  it('never crosses instrument boundaries', () => {
    const swapCandle = candle(NOW + 60_000, 2, {
      instrument: SWAP,
    });
    const index = new ConfirmedCandleIndex(recording([swapCandle]));

    expect(index.findFirstAtOrAfter(SPOT, '1m', NOW)).toEqual({
      valid: true,
      value: undefined,
    });
    expect(index.findFirstAtOrAfter(SWAP, '1m', NOW)).toEqual({
      valid: true,
      value: swapCandle,
    });
  });

  it('returns an ambiguous result for conflicting confirmed duplicates', () => {
    const first = candle(NOW + 60_000, 2);
    const index = new ConfirmedCandleIndex(
      recording(
        [first],
        [
          {
            instrument: SPOT,
            interval: '1m',
            intervalStart: NOW,
            firstRecordOrdinal: 2,
            identicalDuplicateCount: 0,
            conflictingRecordOrdinals: [3],
          },
        ],
      ),
    );

    expect(index.findFirstAtOrAfter(SPOT, '1m', NOW)).toMatchObject({
      valid: false,
      completeness: 'AMBIGUOUS',
      primaryReason: AlignmentReason.CONFLICTING_DUPLICATE,
    });
    expect(index.findRange(SPOT, '1m', NOW, NOW + 60_000)).toMatchObject({
      valid: false,
      completeness: 'AMBIGUOUS',
      primaryReason: AlignmentReason.CONFLICTING_DUPLICATE,
    });
  });
});
