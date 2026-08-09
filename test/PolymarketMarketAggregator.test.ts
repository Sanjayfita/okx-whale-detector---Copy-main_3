import { describe, expect, it } from 'vitest';

import { PolymarketMarketAggregator } from '../src/external/providers/polymarket/PolymarketMarketAggregator';
import type {
  PolymarketMarket,
  PolymarketTrade,
} from '../src/external/providers/polymarket/PolymarketPublicClient';
import { PolymarketWhaleDetector } from '../src/external/providers/polymarket/PolymarketWhaleDetector';

const now = 2_000_000;

const market: PolymarketMarket = {
  id: 'market-1',
  conditionId: 'condition-1',
  question: 'Will the price of Bitcoin be above $62,000 tomorrow?',
  slug: 'bitcoin-above-62000',
  liquidity: 100_000,
  volume: 1_000_000,
  endDate: new Date(now + 48 * 60 * 60 * 1_000).toISOString(),
};

const createTrade = (
  overrides: Partial<PolymarketTrade> = {},
): PolymarketTrade => ({
  proxyWallet: 'wallet-1',
  side: 'BUY',
  asset: 'yes-token',
  conditionId: market.conditionId,
  size: 20_000,
  price: 0.5,
  timestamp: (now - 10_000) / 1_000,
  title: market.question,
  slug: market.slug,
  eventSlug: 'bitcoin-event',
  outcome: 'YES',
  outcomeIndex: 0,
  transactionHash: 'tx-1',
  ...overrides,
});

const createAggregator = () =>
  new PolymarketMarketAggregator(
    new PolymarketWhaleDetector({ minimumTradeNotionalUsd: 1_000 }),
    { minimumNetNotionalUsd: 1_000 },
  );

describe('PolymarketMarketAggregator', () => {
  it('nets opposing trades into one market-level signal', () => {
    const aggregator = createAggregator();
    const result = aggregator.aggregate(
      market,
      [
        createTrade({ size: 40_000, transactionHash: 'bullish' }),
        createTrade({
          side: 'SELL',
          size: 20_000,
          transactionHash: 'bearish',
          proxyWallet: 'wallet-2',
        }),
      ],
      now,
    );

    expect(result.bullishNotionalUsd).toBe(20_000);
    expect(result.bearishNotionalUsd).toBe(10_000);
    expect(result.netDirectionalNotionalUsd).toBe(10_000);
    expect(result.dominance).toBeCloseTo(1 / 3);
    expect(result.signal).toMatchObject({
      category: 'PREDICTION_POSITION',
      direction: 'BULLISH',
      notionalUsd: 10_000,
    });
  });

  it('produces no signal when opposing flow is nearly balanced', () => {
    const aggregator = new PolymarketMarketAggregator(
      new PolymarketWhaleDetector(),
      { minimumNetNotionalUsd: 1_000, minimumDominance: 0.2 },
    );
    const result = aggregator.aggregate(
      market,
      [
        createTrade({ size: 20_000, transactionHash: 'bullish' }),
        createTrade({
          side: 'SELL',
          size: 18_000,
          transactionHash: 'bearish',
        }),
      ],
      now,
    );

    expect(result.dominance).toBeCloseTo(1_000 / 19_000);
    expect(result.signal).toBeUndefined();
  });

  it('tracks unique wallets and largest-wallet concentration', () => {
    const aggregator = createAggregator();
    const result = aggregator.aggregate(
      market,
      [
        createTrade({ size: 20_000, transactionHash: 'one' }),
        createTrade({
          size: 10_000,
          proxyWallet: 'wallet-2',
          transactionHash: 'two',
        }),
      ],
      now,
    );

    expect(result.uniqueWallets).toBe(2);
    expect(result.largestWalletConcentration).toBeCloseTo(2 / 3);
    expect(result.signal?.metadata).toMatchObject({
      uniqueWallets: 2,
    });
  });

  it('separately reports stale and semantically unknown trades', () => {
    const aggregator = new PolymarketMarketAggregator(
      new PolymarketWhaleDetector({ minimumTradeNotionalUsd: 1_000 }),
      {
        minimumNetNotionalUsd: 1_000,
        maximumTradeAgeMs: 60 * 60 * 1_000,
      },
    );
    const ambiguousMarket = {
      ...market,
      question: 'What will happen to Bitcoin tomorrow?',
    };
    const result = aggregator.aggregate(
      ambiguousMarket,
      [
        createTrade(),
        createTrade({
          timestamp: (now - 2 * 60 * 60 * 1_000) / 1_000,
          transactionHash: 'stale',
        }),
      ],
      now,
    );

    expect(result.directionalTrades).toBe(0);
    expect(result.ignoredTrades).toBe(2);
    expect(result.unknownDirectionTrades).toBe(1);
    expect(result.staleTrades).toBe(1);
    expect(result.mismatchedTrades).toBe(0);
    expect(result.signal).toBeUndefined();
  });

  it('accepts trades inside a configured 24-hour freshness window', () => {
    const aggregator = new PolymarketMarketAggregator(
      new PolymarketWhaleDetector({ minimumTradeNotionalUsd: 1_000 }),
      {
        minimumNetNotionalUsd: 1_000,
        maximumTradeAgeMs: 24 * 60 * 60 * 1_000,
      },
    );
    const result = aggregator.aggregate(
      market,
      [
        createTrade({
          timestamp: (now - 12 * 60 * 60 * 1_000) / 1_000,
          transactionHash: 'twelve-hours-old',
        }),
      ],
      now,
    );

    expect(result.directionalTrades).toBe(1);
    expect(result.staleTrades).toBe(0);
    expect(result.signal?.direction).toBe('BULLISH');
  });

  it('reduces confidence when a market is close to resolution', () => {
    const aggregator = createAggregator();
    const trades = [createTrade({ size: 40_000 })];
    const distant = aggregator.aggregate(market, trades, now);
    const near = aggregator.aggregate(
      {
        ...market,
        endDate: new Date(now + 30 * 60 * 1_000).toISOString(),
      },
      trades,
      now,
    );

    expect(near.signal?.confidence).toBeLessThan(
      distant.signal?.confidence ?? 0,
    );
    expect(near.signal?.metadata?.resolutionFactor).toBe(0.55);
  });

  it('reverses market flow for a negative question', () => {
    const aggregator = createAggregator();
    const result = aggregator.aggregate(
      {
        ...market,
        question: 'Will Bitcoin crash below $50,000 tomorrow?',
      },
      [createTrade()],
      now,
    );

    expect(result.signal?.direction).toBe('BEARISH');
  });
});
