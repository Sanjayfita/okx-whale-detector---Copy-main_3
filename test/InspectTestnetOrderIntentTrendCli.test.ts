import { describe, expect, it, vi } from 'vitest';

import type { TestnetOrderIntentTrendDocument } from '../src/safety/testnetOrderIntentTrendPersistence';
import { runInspectTestnetOrderIntentTrendCli } from '../src/tools/inspectTestnetOrderIntentTrend';

const createDocument = (
  direction: 'DECREASING_RISK' | 'STABLE' | 'INCREASING_RISK',
): TestnetOrderIntentTrendDocument => ({
  schemaVersion: 1,
  generatorVersion: 'testnet-order-intent-trend-v1',
  generatedAt: 3_000,
  trend: {
    instrumentId: 'BTC-USDT',
    side: 'BUY',
    orderType: 'LIMIT',
    direction,
    points: [
      {
        generatedAt: 1_000,
        status: 'PREPARED_FOR_DRY_RUN',
        estimatedNotional: 100,
        maximumNotional: 150,
        quantity: 1,
        referencePrice: 100,
      },
      {
        generatedAt: 2_000,
        status: 'REJECTED',
        estimatedNotional: direction === 'INCREASING_RISK' ? 200 : 100,
        maximumNotional: direction === 'INCREASING_RISK' ? 250 : 150,
        quantity: direction === 'INCREASING_RISK' ? 2 : 1,
        referencePrice: 100,
      },
    ],
    estimatedNotionalChange: direction === 'INCREASING_RISK' ? 100 : 0,
    maximumNotionalChange: direction === 'INCREASING_RISK' ? 100 : 0,
    riskIncreases: direction === 'INCREASING_RISK' ? 1 : 0,
    riskReductions: direction === 'DECREASING_RISK' ? 1 : 0,
    highestEstimatedNotional: direction === 'INCREASING_RISK' ? 200 : 100,
    lowestEstimatedNotional: 100,
    reasons: ['deterministic trend'],
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  },
});

describe('runInspectTestnetOrderIntentTrendCli', () => {
  it('prints a stable trend and returns zero', async () => {
    const log = vi.fn();

    const exitCode = await runInspectTestnetOrderIntentTrendCli(
      ['--file', 'trend.json'],
      {
        readDocument: vi.fn(async () => createDocument('STABLE')),
        log,
      },
    );

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith('Direction: STABLE');
    expect(log).toHaveBeenCalledWith('Transport dispatch allowed: false');
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
  });

  it('returns one when risk is increasing', async () => {
    const exitCode = await runInspectTestnetOrderIntentTrendCli(
      ['--file', 'trend.json'],
      {
        readDocument: vi.fn(async () => createDocument('INCREASING_RISK')),
        log: vi.fn(),
      },
    );

    expect(exitCode).toBe(1);
  });

  it('returns two when the file argument is missing', async () => {
    const error = vi.fn();

    const exitCode = await runInspectTestnetOrderIntentTrendCli([], { error });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Usage: safety:inspect-testnet-intent-trend -- --file <trend.json>',
    );
  });

  it('returns two when document loading fails', async () => {
    const error = vi.fn();

    const exitCode = await runInspectTestnetOrderIntentTrendCli(
      ['--file', 'broken.json'],
      {
        readDocument: vi.fn(async () => {
          throw new Error('broken file');
        }),
        error,
      },
    );

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Testnet order intent trend inspection failed: broken file',
    );
  });
});
