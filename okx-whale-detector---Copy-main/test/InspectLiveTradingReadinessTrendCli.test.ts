import { describe, expect, it, vi } from 'vitest';

import type { LiveTradingReadinessTrendDocument } from '../src/safety/liveTradingReadinessTrendPersistence';
import { runInspectLiveTradingReadinessTrendCli } from '../src/tools/inspectLiveTradingReadinessTrend';

const createDocument = (
  direction: LiveTradingReadinessTrendDocument['trend']['direction'],
): LiveTradingReadinessTrendDocument => ({
  schemaVersion: 1,
  generatorVersion: 'live-trading-readiness-trend-v1',
  generatedAt: 300,
  trend: {
    direction,
    points: [
      {
        generatedAt: 100,
        status: 'NOT_READY',
        completedChecks: 5,
        missingChecks: 6,
      },
      {
        generatedAt: 200,
        status: direction === 'DETERIORATING' ? 'NOT_READY' : 'REVIEW_REQUIRED',
        completedChecks: direction === 'DETERIORATING' ? 4 : 9,
        missingChecks: direction === 'DETERIORATING' ? 7 : 2,
      },
    ],
    completedChecksChange: direction === 'DETERIORATING' ? -1 : 4,
    readinessEscalations: direction === 'DETERIORATING' ? 0 : 1,
    readinessRegressions: direction === 'DETERIORATING' ? 1 : 0,
    bestCompletedChecks: direction === 'DETERIORATING' ? 5 : 9,
    worstCompletedChecks: direction === 'DETERIORATING' ? 4 : 5,
    reasons: ['Trend reason', 'Trend analysis never authorizes real-order execution'],
    orderExecutionAuthorized: false,
  },
});

describe('runInspectLiveTradingReadinessTrendCli', () => {
  it('prints a trend document and returns zero for an improving trend', async () => {
    const log = vi.fn();
    const exitCode = await runInspectLiveTradingReadinessTrendCli(
      ['--file', 'trend.json'],
      {
        readDocument: vi.fn(async () => createDocument('IMPROVING')),
        log,
      },
    );

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith('Direction: IMPROVING');
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
    expect(log).toHaveBeenCalledWith(
      'POINT | 100 | NOT_READY | completed=5 | missing=6',
    );
  });

  it('returns one for a deteriorating trend', async () => {
    const exitCode = await runInspectLiveTradingReadinessTrendCli(
      ['--file', 'trend.json'],
      {
        readDocument: vi.fn(async () => createDocument('DETERIORATING')),
        log: vi.fn(),
      },
    );

    expect(exitCode).toBe(1);
  });

  it('returns two when the file argument is missing', async () => {
    const error = vi.fn();
    const exitCode = await runInspectLiveTradingReadinessTrendCli([], { error });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Usage: safety:inspect-readiness-trend -- --file <trend.json>',
    );
  });

  it('returns two when reading fails', async () => {
    const error = vi.fn();
    const exitCode = await runInspectLiveTradingReadinessTrendCli(
      ['--file', 'broken.json'],
      {
        readDocument: vi.fn(async () => {
          throw new Error('invalid document');
        }),
        error,
      },
    );

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Readiness trend inspection failed: invalid document',
    );
  });
});
