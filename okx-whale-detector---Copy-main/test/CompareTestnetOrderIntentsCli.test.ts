import { describe, expect, it, vi } from 'vitest';

import type { TestnetOrderIntentDocument } from '../src/safety/testnetOrderIntentPersistence';
import { runCompareTestnetOrderIntentsCli } from '../src/tools/compareTestnetOrderIntents';

const document = (input: {
  generatedAt: number;
  status?: 'REJECTED' | 'PREPARED_FOR_DRY_RUN';
  quantity?: number;
  maximumNotional?: number;
}): TestnetOrderIntentDocument => {
  const quantity = input.quantity ?? 1;
  const referencePrice = 100;

  return {
    schemaVersion: 1,
    generatorVersion: 'testnet-order-intent-v1',
    generatedAt: input.generatedAt,
    intent: {
      status: input.status ?? 'PREPARED_FOR_DRY_RUN',
      environment: 'TESTNET',
      instrumentId: 'BTC-USDT',
      side: 'BUY',
      orderType: 'MARKET',
      quantity,
      referencePrice,
      limitPrice: null,
      estimatedNotional: quantity * referencePrice,
      maximumNotional: input.maximumNotional ?? 200,
      createdAt: input.generatedAt - 1,
      reasons: ['deterministic CLI test'],
      dryRunOnly: true,
      transportDispatchAllowed: false,
      testnetExecutionAuthorized: false,
      orderExecutionAuthorized: false,
    },
  };
};

describe('runCompareTestnetOrderIntentsCli', () => {
  it('prints an improved comparison and returns zero', async () => {
    const baseline = document({ generatedAt: 1_000, quantity: 1, maximumNotional: 200 });
    const candidate = document({ generatedAt: 2_000, quantity: 0.5, maximumNotional: 150 });
    const log = vi.fn();

    const exitCode = await runCompareTestnetOrderIntentsCli(
      ['--baseline', 'before.json', '--candidate', 'after.json'],
      {
        readDocument: vi.fn(async (path: string) =>
          path === 'before.json' ? baseline : candidate,
        ),
        log,
      },
    );

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith('Outcome: IMPROVED');
    expect(log).toHaveBeenCalledWith('Transport dispatch allowed: false');
    expect(log).toHaveBeenCalledWith('Testnet execution authorized: false');
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
  });

  it('returns one for a worsened comparison', async () => {
    const baseline = document({ generatedAt: 1_000, status: 'REJECTED', quantity: 0.5 });
    const candidate = document({ generatedAt: 2_000, quantity: 1 });

    const exitCode = await runCompareTestnetOrderIntentsCli(
      ['--baseline', 'before.json', '--candidate', 'after.json'],
      {
        readDocument: vi.fn(async (path: string) =>
          path === 'before.json' ? baseline : candidate,
        ),
        log: vi.fn(),
      },
    );

    expect(exitCode).toBe(1);
  });

  it('returns two when arguments are missing', async () => {
    const error = vi.fn();
    const exitCode = await runCompareTestnetOrderIntentsCli([], { error });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Usage: safety:compare-testnet-intents -- --baseline <baseline.json> --candidate <candidate.json>',
    );
  });

  it('returns two when reading fails', async () => {
    const error = vi.fn();

    const exitCode = await runCompareTestnetOrderIntentsCli(
      ['--baseline', 'before.json', '--candidate', 'after.json'],
      {
        readDocument: vi.fn(async () => {
          throw new Error('broken file');
        }),
        error,
      },
    );

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Testnet order intent comparison failed: broken file',
    );
  });
});
