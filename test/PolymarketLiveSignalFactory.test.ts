import { describe, expect, it } from 'vitest';

import type { PolymarketLiveAggregation } from '../src/external/providers/polymarket/PolymarketLiveAggregator';
import { PolymarketLiveSignalFactory } from '../src/external/providers/polymarket/PolymarketLiveSignalFactory';
import type { PolymarketMarket } from '../src/external/providers/polymarket/PolymarketPublicClient';

const market: PolymarketMarket = {
  id: 'market-1',
  conditionId: 'condition-1',
  question: 'Will Bitcoin be above $100,000 this year?',
  slug: 'bitcoin-above-100000',
  liquidity: 100_000,
  volume: 1_000_000,
};

const aggregation: PolymarketLiveAggregation = {
  marketConditionId: market.conditionId,
  windowStartedAt: 1_000,
  windowEndedAt: 61_000,
  executionCount: 10,
  bullishNotionalUsd: 8_000,
  bearishNotionalUsd: 2_000,
  netDirectionalNotionalUsd: 6_000,
  dominance: 0.6,
  direction: 'BULLISH',
  qualifies: true,
};

describe('PolymarketLiveSignalFactory', () => {
  it('creates a normalized correlation-ready external signal', () => {
    const factory = new PolymarketLiveSignalFactory({
      minimumNetNotionalUsd: 5_000,
    });
    const signal = factory.create(market, aggregation, 62_000);

    expect(signal).toMatchObject({
      provider: 'POLYMARKET',
      category: 'PREDICTION_POSITION',
      direction: 'BULLISH',
      asset: 'BTC',
      notionalUsd: 6_000,
      occurredAt: 61_000,
      receivedAt: 62_000,
    });
    expect(signal.confidence).toBeGreaterThan(30);
    expect(signal.confidence).toBeLessThanOrEqual(80);
    expect(signal.metadata).toMatchObject({
      bullishNotionalUsd: 8_000,
      bearishNotionalUsd: 2_000,
      executionCount: 10,
    });
  });

  it('preserves bearish direction and absolute net notional', () => {
    const factory = new PolymarketLiveSignalFactory();
    const signal = factory.create(market, {
      ...aggregation,
      bullishNotionalUsd: 1_000,
      bearishNotionalUsd: 7_000,
      netDirectionalNotionalUsd: -6_000,
      direction: 'BEARISH',
    });

    expect(signal.direction).toBe('BEARISH');
    expect(signal.notionalUsd).toBe(6_000);
  });

  it('rejects a non-qualifying aggregation', () => {
    const factory = new PolymarketLiveSignalFactory();

    expect(() =>
      factory.create(market, { ...aggregation, qualifies: false }),
    ).toThrow('Cannot create a signal from a non-qualifying aggregation');
  });
});
