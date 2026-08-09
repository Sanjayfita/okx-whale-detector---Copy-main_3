import { describe, expect, it } from 'vitest';

import { calculateResearchFeatures } from '../src/features/FeaturePipeline';

const start = 1_700_000_000_000;
const instrumentId = 'BTC-USDT-SWAP';

const timestamped = (observedAt: number, receivedAt = observedAt + 5) => ({
  instrumentId,
  observedAt,
  receivedAt,
  source: 'SYNTHETIC_TEST' as const,
});

const completeInput = () => ({
  instrumentId,
  asOf: start + 180_000,
  trades: [
    {
      ...timestamped(start + 170_000),
      kind: 'TRADE' as const,
      tradeId: '1',
      side: 'BUY' as const,
      price: 103,
      contracts: 8,
    },
    {
      ...timestamped(start + 175_000),
      kind: 'TRADE' as const,
      tradeId: '2',
      side: 'SELL' as const,
      price: 104,
      contracts: 2,
    },
  ],
  books: [
    {
      ...timestamped(start + 179_000),
      kind: 'ORDER_BOOK' as const,
      sequenceId: 10,
      bids: [
        { price: 103.9, contracts: 20, orderCount: 2 },
        { price: 103.8, contracts: 10, orderCount: 1 },
      ],
      asks: [
        { price: 104.1, contracts: 10, orderCount: 1 },
        { price: 104.2, contracts: 5, orderCount: 1 },
      ],
    },
  ],
  candles: [
    {
      ...timestamped(start),
      kind: 'CANDLE' as const,
      intervalMs: 60_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      contractVolume: 100,
      baseVolume: null,
      quoteVolume: null,
      confirmed: true,
    },
    {
      ...timestamped(start + 60_000),
      kind: 'CANDLE' as const,
      intervalMs: 60_000,
      open: 100,
      high: 103,
      low: 100,
      close: 102,
      contractVolume: 120,
      baseVolume: null,
      quoteVolume: null,
      confirmed: true,
    },
    {
      ...timestamped(start + 120_000),
      kind: 'CANDLE' as const,
      intervalMs: 60_000,
      open: 102,
      high: 105,
      low: 102,
      close: 104,
      contractVolume: 140,
      baseVolume: null,
      quoteVolume: null,
      confirmed: true,
    },
  ],
  funding: [
    {
      ...timestamped(start),
      kind: 'FUNDING' as const,
      fundingTime: start,
      fundingRate: 0.0001,
      realizedRate: null,
    },
    {
      ...timestamped(start + 170_000),
      kind: 'FUNDING' as const,
      fundingTime: start + 60 * 60 * 1_000,
      fundingRate: 0.0002,
      realizedRate: null,
    },
  ],
  openInterest: [
    {
      ...timestamped(start),
      kind: 'OPEN_INTEREST' as const,
      contracts: 1_000,
      baseCurrencyAmount: null,
      quoteCurrencyAmount: null,
    },
    {
      ...timestamped(start + 170_000),
      kind: 'OPEN_INTEREST' as const,
      contracts: 1_100,
      baseCurrencyAmount: null,
      quoteCurrencyAmount: null,
    },
  ],
  markIndex: [
    {
      ...timestamped(start + 179_000),
      kind: 'MARK_INDEX' as const,
      markPrice: 104.1,
      indexPrice: 104,
    },
  ],
});

describe('calculateResearchFeatures', () => {
  it('calculates point-in-time derivatives features and data quality', () => {
    const result = calculateResearchFeatures(completeInput());

    expect(result.aggressiveDeltaContracts).toBe(6);
    expect(result.aggressiveDeltaNormalized).toBeCloseTo(0.6, 8);
    expect(result.orderBookImbalance).toBeCloseTo(1 / 3, 8);
    expect(result.openInterestMomentumPercent).toBeCloseTo(10, 8);
    expect(result.basisBps).toBeCloseTo(9.6153846, 6);
    expect(result.trendEfficiency).toBe(1);
    expect(result.regime).toBe('TRENDING_HIGH_VOLATILITY');
    expect(result.sourceMaxObservedAt).toBeLessThanOrEqual(result.observedAt);
    expect(result.sourceMaxReceivedAt).toBeLessThanOrEqual(result.observedAt);
    expect(result.dataQuality.status).toBe('PASSED');
  });

  it('excludes records not received by the decision timestamp', () => {
    const input = completeInput();
    const result = calculateResearchFeatures({
      ...input,
      trades: [
        ...input.trades,
        {
          ...input.trades[0],
          tradeId: 'late',
          observedAt: input.asOf - 1_000,
          receivedAt: input.asOf + 1,
          contracts: 1_000,
        },
      ],
    });

    expect(result.aggressiveDeltaContracts).toBe(6);
    expect(
      result.dataQuality.trades.excludedUnavailableAtDecisionCount,
    ).toBe(1);
  });

  it('uses bounded lookbacks instead of unbounded history', () => {
    const input = completeInput();
    const result = calculateResearchFeatures({
      ...input,
      trades: [
        {
          ...input.trades[0],
          tradeId: 'old',
          observedAt: input.asOf - 20 * 60_000,
          receivedAt: input.asOf - 20 * 60_000 + 5,
          contracts: 1_000,
        },
        ...input.trades,
      ],
    });

    expect(result.aggressiveDeltaContracts).toBe(6);
    expect(result.dataQuality.trades.excludedOutsideLookbackCount).toBe(1);
  });

  it('fails closed when a required source is stale', () => {
    const input = completeInput();
    expect(() =>
      calculateResearchFeatures({
        ...input,
        books: input.books.map((book) => ({
          ...book,
          observedAt: input.asOf - 30_000,
          receivedAt: input.asOf - 29_999,
        })),
      }),
    ).toThrow('LATEST_RECORD_TOO_STALE');
  });
});
