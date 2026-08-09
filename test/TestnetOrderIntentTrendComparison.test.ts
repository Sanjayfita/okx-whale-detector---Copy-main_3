import { describe, expect, it } from 'vitest';

import { compareTestnetOrderIntentTrendDocuments } from '../src/safety/testnetOrderIntentTrendComparison';
import type { TestnetOrderIntentTrendDocument } from '../src/safety/testnetOrderIntentTrendPersistence';

const document = (input: {
  generatedAt: number;
  instrumentId?: string;
  direction?: 'DECREASING_RISK' | 'STABLE' | 'INCREASING_RISK';
  estimatedNotionalChange?: number;
  maximumNotionalChange?: number;
  riskIncreases?: number;
  riskReductions?: number;
  highestEstimatedNotional?: number;
  lowestEstimatedNotional?: number;
}): TestnetOrderIntentTrendDocument => ({
  schemaVersion: 1,
  generatorVersion: 'testnet-order-intent-trend-v1',
  generatedAt: input.generatedAt,
  trend: {
    instrumentId: input.instrumentId ?? 'BTC-USDT',
    side: 'BUY',
    orderType: 'MARKET',
    direction: input.direction ?? 'STABLE',
    points: [
      {
        generatedAt: input.generatedAt - 20,
        status: 'PREPARED_FOR_DRY_RUN',
        estimatedNotional: 100,
        maximumNotional: 200,
        quantity: 1,
        referencePrice: 100,
      },
      {
        generatedAt: input.generatedAt - 10,
        status: 'PREPARED_FOR_DRY_RUN',
        estimatedNotional: 100 + (input.estimatedNotionalChange ?? 0),
        maximumNotional: 200 + (input.maximumNotionalChange ?? 0),
        quantity: 1,
        referencePrice: 100,
      },
    ],
    estimatedNotionalChange: input.estimatedNotionalChange ?? 0,
    maximumNotionalChange: input.maximumNotionalChange ?? 0,
    riskIncreases: input.riskIncreases ?? 0,
    riskReductions: input.riskReductions ?? 0,
    highestEstimatedNotional: input.highestEstimatedNotional ?? 100,
    lowestEstimatedNotional: input.lowestEstimatedNotional ?? 100,
    reasons: ['deterministic trend'],
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  },
});

describe('compareTestnetOrderIntentTrendDocuments', () => {
  it('marks reduced exposure and risk direction as improved', () => {
    const comparison = compareTestnetOrderIntentTrendDocuments({
      baseline: document({
        generatedAt: 1_000,
        direction: 'STABLE',
        highestEstimatedNotional: 150,
      }),
      candidate: document({
        generatedAt: 2_000,
        direction: 'DECREASING_RISK',
        estimatedNotionalChange: -25,
        maximumNotionalChange: -50,
        riskReductions: 1,
        highestEstimatedNotional: 100,
        lowestEstimatedNotional: 75,
      }),
    });

    expect(comparison.outcome).toBe('IMPROVED');
    expect(comparison.candidateDirection).toBe('DECREASING_RISK');
    expect(comparison.highestEstimatedNotionalDelta).toBe(-50);
    expect(comparison.transportDispatchAllowed).toBe(false);
    expect(comparison.testnetExecutionAuthorized).toBe(false);
    expect(comparison.orderExecutionAuthorized).toBe(false);
  });

  it('conservatively marks any increased exposure or risk as worsened', () => {
    const comparison = compareTestnetOrderIntentTrendDocuments({
      baseline: document({
        generatedAt: 1_000,
        direction: 'DECREASING_RISK',
        riskReductions: 2,
      }),
      candidate: document({
        generatedAt: 2_000,
        direction: 'STABLE',
        estimatedNotionalChange: 10,
        riskIncreases: 1,
        riskReductions: 3,
        highestEstimatedNotional: 110,
      }),
    });

    expect(comparison.outcome).toBe('WORSENED');
    expect(comparison.riskIncreasesDelta).toBe(1);
    expect(comparison.riskReductionsDelta).toBe(1);
  });

  it('marks identical safety exposure as unchanged', () => {
    const comparison = compareTestnetOrderIntentTrendDocuments({
      baseline: document({ generatedAt: 1_000 }),
      candidate: document({ generatedAt: 2_000 }),
    });

    expect(comparison.outcome).toBe('UNCHANGED');
    expect(comparison.estimatedNotionalChangeDelta).toBe(0);
    expect(comparison.maximumNotionalChangeDelta).toBe(0);
  });

  it('rejects older candidates and mismatched trend identities', () => {
    expect(() =>
      compareTestnetOrderIntentTrendDocuments({
        baseline: document({ generatedAt: 2_000 }),
        candidate: document({ generatedAt: 1_000 }),
      }),
    ).toThrow('cannot be older than baseline');

    expect(() =>
      compareTestnetOrderIntentTrendDocuments({
        baseline: document({ generatedAt: 1_000 }),
        candidate: document({ generatedAt: 2_000, instrumentId: 'ETH-USDT' }),
      }),
    ).toThrow('same instrument, side, and order type');
  });
});
