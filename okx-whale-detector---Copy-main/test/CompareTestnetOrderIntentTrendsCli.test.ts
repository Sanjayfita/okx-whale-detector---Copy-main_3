import { describe, expect, it, vi } from 'vitest';

import { runCompareTestnetOrderIntentTrendsCli } from '../src/tools/compareTestnetOrderIntentTrends';
import type { TestnetOrderIntentTrendDocument } from '../src/safety/testnetOrderIntentTrendPersistence';

const document = (generatedAt: number): TestnetOrderIntentTrendDocument => ({
  schemaVersion: 1,
  generatorVersion: 'testnet-order-intent-trend-v1',
  generatedAt,
  trend: {
    instrumentId: 'BTC-USDT',
    side: 'BUY',
    orderType: 'MARKET',
    direction: 'STABLE',
    points: [
      {
        generatedAt: generatedAt - 2,
        status: 'PREPARED_FOR_DRY_RUN',
        estimatedNotional: 100,
        maximumNotional: 200,
        quantity: 1,
        referencePrice: 100,
      },
      {
        generatedAt: generatedAt - 1,
        status: 'PREPARED_FOR_DRY_RUN',
        estimatedNotional: 100,
        maximumNotional: 200,
        quantity: 1,
        referencePrice: 100,
      },
    ],
    estimatedNotionalChange: 0,
    maximumNotionalChange: 0,
    riskIncreases: 0,
    riskReductions: 0,
    highestEstimatedNotional: 100,
    lowestEstimatedNotional: 100,
    reasons: ['stable'],
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  },
});

describe('runCompareTestnetOrderIntentTrendsCli', () => {
  it('prints comparison details and returns zero for improved outcomes', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const baseline = document(1_000);
    const candidate = document(2_000);

    const exitCode = await runCompareTestnetOrderIntentTrendsCli(
      [
        '--baseline',
        'baseline.json',
        '--candidate',
        'candidate.json',
      ],
      {
        readDocument: vi
          .fn()
          .mockResolvedValueOnce(baseline)
          .mockResolvedValueOnce(candidate),
        compareDocuments: vi.fn().mockReturnValue({
          baselineGeneratedAt: 1_000,
          candidateGeneratedAt: 2_000,
          outcome: 'IMPROVED',
          baselineDirection: 'STABLE',
          candidateDirection: 'DECREASING_RISK',
          estimatedNotionalChangeDelta: -50,
          maximumNotionalChangeDelta: -50,
          riskIncreasesDelta: -1,
          riskReductionsDelta: 1,
          highestEstimatedNotionalDelta: -50,
          lowestEstimatedNotionalDelta: -50,
          reasons: ['safer'],
          dryRunOnly: true,
          transportDispatchAllowed: false,
          testnetExecutionAuthorized: false,
          orderExecutionAuthorized: false,
        }),
        log,
        error,
      },
    );

    expect(exitCode).toBe(0);
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Outcome: IMPROVED');
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
  });

  it('returns one for worsened outcomes', async () => {
    const baseline = document(1_000);
    const candidate = document(2_000);

    const exitCode = await runCompareTestnetOrderIntentTrendsCli(
      ['--baseline', 'baseline.json', '--candidate', 'candidate.json'],
      {
        readDocument: vi
          .fn()
          .mockResolvedValueOnce(baseline)
          .mockResolvedValueOnce(candidate),
        compareDocuments: vi.fn().mockReturnValue({
          baselineGeneratedAt: 1_000,
          candidateGeneratedAt: 2_000,
          outcome: 'WORSENED',
          baselineDirection: 'STABLE',
          candidateDirection: 'INCREASING_RISK',
          estimatedNotionalChangeDelta: 50,
          maximumNotionalChangeDelta: 50,
          riskIncreasesDelta: 1,
          riskReductionsDelta: 0,
          highestEstimatedNotionalDelta: 50,
          lowestEstimatedNotionalDelta: 50,
          reasons: ['risk increased'],
          dryRunOnly: true,
          transportDispatchAllowed: false,
          testnetExecutionAuthorized: false,
          orderExecutionAuthorized: false,
        }),
        log: vi.fn(),
        error: vi.fn(),
      },
    );

    expect(exitCode).toBe(1);
  });

  it('returns two when required arguments are missing', async () => {
    const error = vi.fn();

    const exitCode = await runCompareTestnetOrderIntentTrendsCli([], {
      log: vi.fn(),
      error,
    });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Usage: safety:compare-testnet-intent-trends -- --baseline <baseline.json> --candidate <candidate.json>',
    );
  });

  it('returns two when reading or comparison fails', async () => {
    const error = vi.fn();

    const exitCode = await runCompareTestnetOrderIntentTrendsCli(
      ['--baseline', 'baseline.json', '--candidate', 'candidate.json'],
      {
        readDocument: vi.fn().mockRejectedValue(new Error('broken file')),
        log: vi.fn(),
        error,
      },
    );

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Testnet order intent trend comparison failed: broken file',
    );
  });
});
