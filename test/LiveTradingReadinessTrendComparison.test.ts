import { describe, expect, it } from 'vitest';

import { compareLiveTradingReadinessTrendDocuments } from '../src/safety/liveTradingReadinessTrendComparison';
import type { LiveTradingReadinessTrendDocument } from '../src/safety/liveTradingReadinessTrendPersistence';

const makeDocument = (input: {
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
        status: input.direction === 'IMPROVING' ? 'REVIEW_REQUIRED' : 'NOT_READY',
        completedChecks: input.bestCompletedChecks,
        missingChecks: 11 - input.bestCompletedChecks,
      },
    ],
    completedChecksChange: input.completedChecksChange,
    readinessEscalations: input.readinessEscalations,
    readinessRegressions: input.readinessRegressions,
    bestCompletedChecks: input.bestCompletedChecks,
    worstCompletedChecks: input.worstCompletedChecks,
    reasons: ['test trend'],
    orderExecutionAuthorized: false,
  },
});

describe('compareLiveTradingReadinessTrendDocuments', () => {
  it('reports an improved candidate without authorizing orders', () => {
    const baseline = makeDocument({
      generatedAt: 1_000,
      direction: 'STABLE',
      completedChecksChange: 0,
      readinessEscalations: 0,
      readinessRegressions: 0,
      bestCompletedChecks: 5,
      worstCompletedChecks: 5,
    });
    const candidate = makeDocument({
      generatedAt: 2_000,
      direction: 'IMPROVING',
      completedChecksChange: 2,
      readinessEscalations: 1,
      readinessRegressions: 0,
      bestCompletedChecks: 7,
      worstCompletedChecks: 6,
    });

    const comparison = compareLiveTradingReadinessTrendDocuments({ baseline, candidate });

    expect(comparison.outcome).toBe('IMPROVED');
    expect(comparison.completedChecksChangeDelta).toBe(2);
    expect(comparison.orderExecutionAuthorized).toBe(false);
  });

  it('reports unchanged trends', () => {
    const baseline = makeDocument({
      generatedAt: 1_000,
      direction: 'STABLE',
      completedChecksChange: 0,
      readinessEscalations: 0,
      readinessRegressions: 0,
      bestCompletedChecks: 5,
      worstCompletedChecks: 5,
    });
    const candidate = makeDocument({
      generatedAt: 2_000,
      direction: 'STABLE',
      completedChecksChange: 0,
      readinessEscalations: 0,
      readinessRegressions: 0,
      bestCompletedChecks: 5,
      worstCompletedChecks: 5,
    });

    expect(
      compareLiveTradingReadinessTrendDocuments({ baseline, candidate }).outcome,
    ).toBe('UNCHANGED');
  });

  it('treats any regression as worsened', () => {
    const baseline = makeDocument({
      generatedAt: 1_000,
      direction: 'IMPROVING',
      completedChecksChange: 2,
      readinessEscalations: 2,
      readinessRegressions: 0,
      bestCompletedChecks: 9,
      worstCompletedChecks: 7,
    });
    const candidate = makeDocument({
      generatedAt: 2_000,
      direction: 'STABLE',
      completedChecksChange: 1,
      readinessEscalations: 1,
      readinessRegressions: 1,
      bestCompletedChecks: 9,
      worstCompletedChecks: 6,
    });

    expect(
      compareLiveTradingReadinessTrendDocuments({ baseline, candidate }).outcome,
    ).toBe('WORSENED');
  });

  it('rejects an older candidate document', () => {
    const baseline = makeDocument({
      generatedAt: 2_000,
      direction: 'STABLE',
      completedChecksChange: 0,
      readinessEscalations: 0,
      readinessRegressions: 0,
      bestCompletedChecks: 5,
      worstCompletedChecks: 5,
    });
    const candidate = makeDocument({
      generatedAt: 1_000,
      direction: 'STABLE',
      completedChecksChange: 0,
      readinessEscalations: 0,
      readinessRegressions: 0,
      bestCompletedChecks: 5,
      worstCompletedChecks: 5,
    });

    expect(() =>
      compareLiveTradingReadinessTrendDocuments({ baseline, candidate }),
    ).toThrow('Candidate readiness trend document cannot be older than baseline');
  });
});
