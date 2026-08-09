import { describe, expect, it } from 'vitest';

import type { TestnetOrderIntentDocument } from '../src/safety/testnetOrderIntentPersistence';
import { summarizeTestnetOrderIntentTrend } from '../src/safety/testnetOrderIntentTrend';

const document = (input: {
  generatedAt: number;
  status: 'REJECTED' | 'PREPARED_FOR_DRY_RUN';
  estimatedNotional: number;
  maximumNotional: number;
  instrumentId?: string;
}): TestnetOrderIntentDocument => ({
  schemaVersion: 1,
  generatorVersion: 'testnet-order-intent-v1',
  generatedAt: input.generatedAt,
  intent: {
    status: input.status,
    environment: 'TESTNET',
    instrumentId: input.instrumentId ?? 'BTC-USDT',
    side: 'BUY',
    orderType: 'MARKET',
    quantity: input.estimatedNotional / 100,
    referencePrice: 100,
    limitPrice: null,
    estimatedNotional: input.estimatedNotional,
    maximumNotional: input.maximumNotional,
    createdAt: input.generatedAt - 1,
    reasons: ['deterministic test intent'],
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  },
});

describe('summarizeTestnetOrderIntentTrend', () => {
  it('detects decreasing risk', () => {
    const trend = summarizeTestnetOrderIntentTrend([
      document({
        generatedAt: 1_000,
        status: 'PREPARED_FOR_DRY_RUN',
        estimatedNotional: 80,
        maximumNotional: 100,
      }),
      document({
        generatedAt: 2_000,
        status: 'REJECTED',
        estimatedNotional: 40,
        maximumNotional: 60,
      }),
    ]);

    expect(trend.direction).toBe('DECREASING_RISK');
    expect(trend.riskReductions).toBe(1);
    expect(trend.estimatedNotionalChange).toBe(-40);
    expect(trend.orderExecutionAuthorized).toBe(false);
    expect(trend.transportDispatchAllowed).toBe(false);
  });

  it('detects increasing risk and sorts points chronologically', () => {
    const trend = summarizeTestnetOrderIntentTrend([
      document({
        generatedAt: 2_000,
        status: 'PREPARED_FOR_DRY_RUN',
        estimatedNotional: 90,
        maximumNotional: 120,
      }),
      document({
        generatedAt: 1_000,
        status: 'REJECTED',
        estimatedNotional: 50,
        maximumNotional: 70,
      }),
    ]);

    expect(trend.direction).toBe('INCREASING_RISK');
    expect(trend.riskIncreases).toBe(1);
    expect(trend.points.map((point) => point.generatedAt)).toEqual([1_000, 2_000]);
    expect(trend.highestEstimatedNotional).toBe(90);
  });

  it('detects a stable trend', () => {
    const trend = summarizeTestnetOrderIntentTrend([
      document({
        generatedAt: 1_000,
        status: 'REJECTED',
        estimatedNotional: 50,
        maximumNotional: 70,
      }),
      document({
        generatedAt: 2_000,
        status: 'REJECTED',
        estimatedNotional: 50,
        maximumNotional: 70,
      }),
    ]);

    expect(trend.direction).toBe('STABLE');
    expect(trend.riskIncreases).toBe(0);
    expect(trend.riskReductions).toBe(0);
  });

  it('rejects invalid document collections', () => {
    const first = document({
      generatedAt: 1_000,
      status: 'REJECTED',
      estimatedNotional: 50,
      maximumNotional: 70,
    });

    expect(() => summarizeTestnetOrderIntentTrend([first])).toThrow(
      'At least two testnet order intent documents are required',
    );
    expect(() => summarizeTestnetOrderIntentTrend([first, first])).toThrow(
      'Duplicate testnet order intent timestamp',
    );
    expect(() =>
      summarizeTestnetOrderIntentTrend([
        first,
        document({
          generatedAt: 2_000,
          status: 'REJECTED',
          estimatedNotional: 50,
          maximumNotional: 70,
          instrumentId: 'ETH-USDT',
        }),
      ]),
    ).toThrow(
      'Testnet order intents must describe the same instrument, side, and order type',
    );
  });
});
