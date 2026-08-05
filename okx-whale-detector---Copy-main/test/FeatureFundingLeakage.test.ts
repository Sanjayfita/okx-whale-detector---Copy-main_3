import { describe, expect, it } from 'vitest';

import { calculateResearchFeatures } from '../src/features/FeaturePipeline';

const timestamp = 1_700_000_000_000;
const shared = {
  instrumentId: 'BTC-USDT-SWAP',
  receivedAt: timestamp,
  source: 'SYNTHETIC_TEST' as const,
};

describe('FeaturePipeline funding chronology', () => {
  it('ignores funding records whose funding time is after the decision', () => {
    const result = calculateResearchFeatures({
      instrumentId: shared.instrumentId,
      asOf: timestamp + 60_000,
      trades: [
        {
          ...shared,
          kind: 'TRADE',
          observedAt: timestamp,
          tradeId: '1',
          side: 'BUY',
          price: 100,
          contracts: 1,
        },
      ],
      books: [
        {
          ...shared,
          kind: 'ORDER_BOOK',
          observedAt: timestamp,
          sequenceId: 1,
          bids: [{ price: 99.9, contracts: 1, orderCount: 1 }],
          asks: [{ price: 100.1, contracts: 1, orderCount: 1 }],
        },
      ],
      candles: [
        {
          ...shared,
          kind: 'CANDLE',
          observedAt: timestamp,
          intervalMs: 60_000,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          contractVolume: 1,
          baseVolume: null,
          quoteVolume: null,
          confirmed: true,
        },
      ],
      funding: [
        {
          ...shared,
          kind: 'FUNDING',
          observedAt: timestamp,
          fundingTime: timestamp,
          fundingRate: 0.0001,
          realizedRate: null,
        },
        {
          ...shared,
          kind: 'FUNDING',
          observedAt: timestamp + 30_000,
          fundingTime: timestamp + 8 * 60 * 60 * 1_000,
          fundingRate: 0.5,
          realizedRate: null,
        },
      ],
      openInterest: [
        {
          ...shared,
          kind: 'OPEN_INTEREST',
          observedAt: timestamp,
          contracts: 1,
          baseCurrencyAmount: null,
          quoteCurrencyAmount: null,
        },
      ],
      markIndex: [
        {
          ...shared,
          kind: 'MARK_INDEX',
          observedAt: timestamp,
          markPrice: 100,
          indexPrice: 100,
        },
      ],
    });

    expect(result.fundingRate).toBe(0.0001);
    expect(result.fundingAccelerationPerHour).toBe(0);
  });
});
