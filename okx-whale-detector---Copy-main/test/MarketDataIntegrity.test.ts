import { describe, expect, it } from 'vitest';

import {
  detectTimestampGaps,
  validateHistoricalMarketDataBatch,
} from '../src/data/MarketDataIntegrity';
import type {
  HistoricalMarketDataBatch,
  HistoricalTradeRecord,
  OrderBookSnapshotRecord,
} from '../src/data/ResearchMarketData';

const observedAt = 1_700_000_000_000;

const trade = (
  override: Partial<HistoricalTradeRecord> = {},
): HistoricalTradeRecord => ({
  kind: 'TRADE',
  instrumentId: 'BTC-USDT-SWAP',
  observedAt,
  receivedAt: observedAt + 5,
  source: 'SYNTHETIC_TEST',
  tradeId: '1',
  side: 'BUY',
  price: 100,
  contracts: 2,
  ...override,
});

const book = (
  override: Partial<OrderBookSnapshotRecord> = {},
): OrderBookSnapshotRecord => ({
  kind: 'ORDER_BOOK',
  instrumentId: 'BTC-USDT-SWAP',
  observedAt: observedAt + 1,
  receivedAt: observedAt + 6,
  source: 'SYNTHETIC_TEST',
  sequenceId: 1,
  bids: [
    { price: 99.9, contracts: 10, orderCount: 2 },
    { price: 99.8, contracts: 20, orderCount: 3 },
  ],
  asks: [
    { price: 100.1, contracts: 12, orderCount: 2 },
    { price: 100.2, contracts: 22, orderCount: 4 },
  ],
  ...override,
});

const batch = (
  records: HistoricalMarketDataBatch['records'],
): HistoricalMarketDataBatch => ({
  instrumentId: 'BTC-USDT-SWAP',
  rangeStart: observedAt - 1_000,
  rangeEnd: observedAt + 1_000,
  records,
});

describe('validateHistoricalMarketDataBatch', () => {
  it('accepts a clean canonical derivatives dataset', () => {
    const result = validateHistoricalMarketDataBatch(batch([trade(), book()]));

    expect(result).toEqual({ status: 'VALID', issues: [] });
  });

  it('rejects duplicate trades and crossed books', () => {
    const result = validateHistoricalMarketDataBatch(
      batch([
        trade(),
        trade(),
        book({
          bids: [{ price: 100.2, contracts: 1, orderCount: 1 }],
          asks: [{ price: 100.1, contracts: 1, orderCount: 1 }],
        }),
      ]),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.issues.map((issue) => issue.code)).toContain(
      'DUPLICATE_RECORD',
    );
    expect(result.issues.map((issue) => issue.code)).toContain('CROSSED_BOOK');
  });

  it('rejects records outside the declared range and invalid receive order', () => {
    const result = validateHistoricalMarketDataBatch(
      batch([
        trade({
          observedAt: observedAt + 2_000,
          receivedAt: observedAt + 1_500,
        }),
      ]),
    );

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'TIMESTAMP_OUTSIDE_RANGE',
        'RECEIVED_BEFORE_OBSERVED',
      ]),
    );
  });
});

describe('detectTimestampGaps', () => {
  it('detects missing intervals while tolerating small timing jitter', () => {
    const gaps = detectTimestampGaps(
      [observedAt, observedAt + 1_002, observedAt + 4_000],
      { expectedIntervalMs: 1_000, toleranceMs: 5 },
    );

    expect(gaps).toEqual([
      {
        previousTimestamp: observedAt + 1_002,
        nextTimestamp: observedAt + 4_000,
        missingFrom: observedAt + 2_002,
        missingTo: observedAt + 3_000,
        estimatedMissingRecords: 1,
      },
    ]);
  });
});
