import { describe, expect, it } from 'vitest';

import { compareTestnetOrderIntentDocuments } from '../src/safety/testnetOrderIntentComparison';
import type { TestnetOrderIntentDocument } from '../src/safety/testnetOrderIntentPersistence';

const document = (input: {
  generatedAt: number;
  status?: 'REJECTED' | 'PREPARED_FOR_DRY_RUN';
  quantity?: number;
  referencePrice?: number;
  maximumNotional?: number;
  instrumentId?: string;
}): TestnetOrderIntentDocument => {
  const quantity = input.quantity ?? 1;
  const referencePrice = input.referencePrice ?? 100;

  return {
    schemaVersion: 1,
    generatorVersion: 'testnet-order-intent-v1',
    generatedAt: input.generatedAt,
    intent: {
      status: input.status ?? 'PREPARED_FOR_DRY_RUN',
      environment: 'TESTNET',
      instrumentId: input.instrumentId ?? 'BTC-USDT',
      side: 'BUY',
      orderType: 'MARKET',
      quantity,
      referencePrice,
      limitPrice: null,
      estimatedNotional: quantity * referencePrice,
      maximumNotional: input.maximumNotional ?? 200,
      createdAt: input.generatedAt - 1,
      reasons: ['deterministic test intent'],
      dryRunOnly: true,
      transportDispatchAllowed: false,
      testnetExecutionAuthorized: false,
      orderExecutionAuthorized: false,
    },
  };
};

describe('compareTestnetOrderIntentDocuments', () => {
  it('marks reduced notional exposure as improved', () => {
    const comparison = compareTestnetOrderIntentDocuments({
      baseline: document({ generatedAt: 1_000, quantity: 1, maximumNotional: 200 }),
      candidate: document({ generatedAt: 2_000, quantity: 0.5, maximumNotional: 150 }),
    });

    expect(comparison.outcome).toBe('IMPROVED');
    expect(comparison.estimatedNotionalDelta).toBe(-50);
    expect(comparison.maximumNotionalDelta).toBe(-50);
    expect(comparison.transportDispatchAllowed).toBe(false);
    expect(comparison.testnetExecutionAuthorized).toBe(false);
    expect(comparison.orderExecutionAuthorized).toBe(false);
  });

  it('marks increased exposure or permissiveness as worsened', () => {
    const comparison = compareTestnetOrderIntentDocuments({
      baseline: document({ generatedAt: 1_000, status: 'REJECTED', quantity: 0.5 }),
      candidate: document({ generatedAt: 2_000, quantity: 1 }),
    });

    expect(comparison.outcome).toBe('WORSENED');
    expect(comparison.baselineStatus).toBe('REJECTED');
    expect(comparison.candidateStatus).toBe('PREPARED_FOR_DRY_RUN');
  });

  it('marks identical safety exposure as unchanged', () => {
    const comparison = compareTestnetOrderIntentDocuments({
      baseline: document({ generatedAt: 1_000 }),
      candidate: document({ generatedAt: 2_000 }),
    });

    expect(comparison.outcome).toBe('UNCHANGED');
    expect(comparison.estimatedNotionalDelta).toBe(0);
    expect(comparison.maximumNotionalDelta).toBe(0);
  });

  it('rejects older candidates and mismatched intents', () => {
    expect(() =>
      compareTestnetOrderIntentDocuments({
        baseline: document({ generatedAt: 2_000 }),
        candidate: document({ generatedAt: 1_000 }),
      }),
    ).toThrow('cannot be older than baseline');

    expect(() =>
      compareTestnetOrderIntentDocuments({
        baseline: document({ generatedAt: 1_000 }),
        candidate: document({ generatedAt: 2_000, instrumentId: 'ETH-USDT' }),
      }),
    ).toThrow('same instrument, side, and order type');
  });
});
