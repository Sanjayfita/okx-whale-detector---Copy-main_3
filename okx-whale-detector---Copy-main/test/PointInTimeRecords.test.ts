import { describe, expect, it } from 'vitest';

import {
  requirePointInTimeSelection,
  selectPointInTimeRecords,
} from '../src/data/PointInTimeRecords';

const record = (observedAt: number, receivedAt = observedAt + 1) => ({
  instrumentId: 'BTC-USDT-SWAP',
  observedAt,
  receivedAt,
  value: observedAt,
});

describe('selectPointInTimeRecords', () => {
  it('excludes future, late-arriving, and outside-window records separately', () => {
    const selection = selectPointInTimeRecords({
      sourceName: 'test trades',
      instrumentId: 'BTC-USDT-SWAP',
      asOf: 10_000,
      records: [
        record(1_000),
        record(9_000),
        record(9_500, 10_001),
        record(10_001, 10_001),
      ],
      policy: {
        lookbackMs: 2_000,
        maximumAgeMs: 1_500,
        minimumRecords: 1,
      },
    });

    expect(selection.records.map((item) => item.observedAt)).toEqual([9_000]);
    expect(selection.quality).toMatchObject({
      status: 'PASSED',
      excludedOutsideLookbackCount: 1,
      excludedUnavailableAtDecisionCount: 1,
      excludedFutureObservationCount: 1,
      ageMs: 1_000,
    });
  });

  it('fails closed when available data is stale or insufficient', () => {
    const selection = selectPointInTimeRecords({
      sourceName: 'test books',
      instrumentId: 'BTC-USDT-SWAP',
      asOf: 10_000,
      records: [record(1_000)],
      policy: {
        lookbackMs: 10_000,
        maximumAgeMs: 1_000,
        minimumRecords: 2,
      },
    });

    expect(selection.quality.status).toBe('REJECTED');
    expect(selection.quality.rejectionReasons).toEqual([
      'INSUFFICIENT_POINT_IN_TIME_RECORDS',
      'LATEST_RECORD_TOO_STALE',
    ]);
    expect(() => requirePointInTimeSelection(selection)).toThrow(
      'point-in-time quality failed',
    );
  });

  it('rejects cross-instrument contamination', () => {
    expect(() =>
      selectPointInTimeRecords({
        sourceName: 'test source',
        instrumentId: 'BTC-USDT-SWAP',
        asOf: 10_000,
        records: [
          {
            ...record(9_000),
            instrumentId: 'ETH-USDT-SWAP',
          },
        ],
        policy: {
          lookbackMs: 2_000,
          maximumAgeMs: 2_000,
          minimumRecords: 1,
        },
      }),
    ).toThrow('instrument mismatch');
  });
});
