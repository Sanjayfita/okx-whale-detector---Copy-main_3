import { describe, expect, it, vi } from 'vitest';

import type { TestnetOrderIntentDocument } from '../src/safety/testnetOrderIntentPersistence';
import { runInspectTestnetOrderIntentCli } from '../src/tools/inspectTestnetOrderIntent';

const createDocument = (
  status: TestnetOrderIntentDocument['intent']['status'],
): TestnetOrderIntentDocument => ({
  schemaVersion: 1,
  generatorVersion: 'testnet-order-intent-v1',
  generatedAt: 2_000,
  intent: {
    status,
    environment: 'TESTNET',
    instrumentId: 'BTC-USDT-SWAP',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: 0.001,
    referencePrice: 100_000,
    limitPrice: 99_500,
    estimatedNotional: 99.5,
    maximumNotional: 100,
    createdAt: 1_900,
    reasons: ['deterministic test intent'],
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  },
});

describe('runInspectTestnetOrderIntentCli', () => {
  it('prints a prepared dry-run intent and returns zero', async () => {
    const log = vi.fn();

    const exitCode = await runInspectTestnetOrderIntentCli(
      ['--file', 'intent.json'],
      {
        readDocument: vi.fn(async () => createDocument('PREPARED_FOR_DRY_RUN')),
        log,
      },
    );

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith('Status: PREPARED_FOR_DRY_RUN');
    expect(log).toHaveBeenCalledWith('Environment: TESTNET');
    expect(log).toHaveBeenCalledWith('Transport dispatch allowed: false');
    expect(log).toHaveBeenCalledWith('Testnet execution authorized: false');
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
  });

  it('returns one when the intent is rejected', async () => {
    const exitCode = await runInspectTestnetOrderIntentCli(
      ['--file', 'intent.json'],
      {
        readDocument: vi.fn(async () => createDocument('REJECTED')),
        log: vi.fn(),
      },
    );

    expect(exitCode).toBe(1);
  });

  it('returns two when the file argument is missing', async () => {
    const error = vi.fn();

    const exitCode = await runInspectTestnetOrderIntentCli([], { error });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Usage: safety:inspect-testnet-intent -- --file <intent.json>',
    );
  });

  it('returns two when document loading fails', async () => {
    const error = vi.fn();

    const exitCode = await runInspectTestnetOrderIntentCli(
      ['--file', 'intent.json'],
      {
        readDocument: vi.fn(async () => {
          throw new Error('broken intent');
        }),
        error,
      },
    );

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Testnet order intent inspection failed: broken intent',
    );
  });
});
