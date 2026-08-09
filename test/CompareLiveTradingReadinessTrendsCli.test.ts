import { describe, expect, it, vi } from 'vitest';

import type { LiveTradingReadinessTrendDocument } from '../src/safety/liveTradingReadinessTrendPersistence';
import { runCompareLiveTradingReadinessTrendsCli } from '../src/tools/compareLiveTradingReadinessTrends';

const createDocument = (input: {
  generatedAt: number;
  direction: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
  completedChecksChange: number;
  readinessEscalations: number;
  readinessRegressions: number;
  bestCompletedChecks: number;
  worstCompletedChecks: number;
}): LiveTradingReadinessTrendDocument => ({
  schemaVersion: 1,
  generatorVersion: 'live-trading-readiness-trend-v1',
  generatedAt: input.generatedAt,
  trend: {
    direction: input.direction,
    points: [
      {
        generatedAt: input.generatedAt - 100,
        status: 'NOT_READY',
        completedChecks: input.worstCompletedChecks,
        missingChecks: 11 - input.worstCompletedChecks,
      },
      {
        generatedAt: input.generatedAt - 50,
        status:
          input.direction === 'DETERIORATING'
            ? 'NOT_READY'
            : 'READY_FOR_MANUAL_REVIEW',
        completedChecks: input.bestCompletedChecks,
        missingChecks: 11 - input.bestCompletedChecks,
      },
    ],
    completedChecksChange: input.completedChecksChange,
    readinessEscalations: input.readinessEscalations,
    readinessRegressions: input.readinessRegressions,
    bestCompletedChecks: input.bestCompletedChecks,
    worstCompletedChecks: input.worstCompletedChecks,
    reasons: ['test'],
    orderExecutionAuthorized: false,
  },
});

describe('runCompareLiveTradingReadinessTrendsCli', () => {
  it('prints an improved comparison and returns zero', async () => {
    const baseline = createDocument({
      generatedAt: 1_000,
      direction: 'STABLE',
      completedChecksChange: 1,
      readinessEscalations: 1,
      readinessRegressions: 1,
      bestCompletedChecks: 8,
      worstCompletedChecks: 5,
    });
    const candidate = createDocument({
      generatedAt: 2_000,
      direction: 'IMPROVING',
      completedChecksChange: 2,
      readinessEscalations: 2,
      readinessRegressions: 0,
      bestCompletedChecks: 10,
      worstCompletedChecks: 7,
    });
    const log = vi.fn();
    const readDocument = vi.fn(async (path: string) =>
      path === 'before.json' ? baseline : candidate,
    );

    const exitCode = await runCompareLiveTradingReadinessTrendsCli(
      ['--baseline', 'before.json', '--candidate', 'after.json'],
      { readDocument, log },
    );

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith('Outcome: IMPROVED');
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
  });

  it('returns one when the candidate trend worsens', async () => {
    const baseline = createDocument({
      generatedAt: 1_000,
      direction: 'IMPROVING',
      completedChecksChange: 2,
      readinessEscalations: 2,
      readinessRegressions: 0,
      bestCompletedChecks: 10,
      worstCompletedChecks: 7,
    });
    const candidate = createDocument({
      generatedAt: 2_000,
      direction: 'DETERIORATING',
      completedChecksChange: -1,
      readinessEscalations: 0,
      readinessRegressions: 2,
      bestCompletedChecks: 8,
      worstCompletedChecks: 4,
    });

    const exitCode = await runCompareLiveTradingReadinessTrendsCli(
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

    const exitCode = await runCompareLiveTradingReadinessTrendsCli([], {
      error,
    });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Usage: safety:compare-readiness-trends -- --baseline <baseline.json> --candidate <candidate.json>',
    );
  });

  it('returns two when document loading fails', async () => {
    const error = vi.fn();

    const exitCode = await runCompareLiveTradingReadinessTrendsCli(
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
      'Readiness trend comparison failed: broken file',
    );
  });
});
