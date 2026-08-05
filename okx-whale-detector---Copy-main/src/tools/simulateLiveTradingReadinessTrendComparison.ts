import { compareLiveTradingReadinessTrendDocuments } from '../safety/liveTradingReadinessTrendComparison';
import type { LiveTradingReadinessTrendDirection } from '../safety/liveTradingReadinessTrend';
import type { LiveTradingReadinessTrendDocument } from '../safety/liveTradingReadinessTrendPersistence';

export interface LiveTradingReadinessTrendComparisonSimulationResult {
  outcomes: readonly ['IMPROVED', 'UNCHANGED', 'WORSENED'];
  orderExecutionAuthorized: false;
}

const createDocument = (input: {
  generatedAt: number;
  direction: LiveTradingReadinessTrendDirection;
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
    reasons: ['deterministic simulation'],
    orderExecutionAuthorized: false,
  },
});

export const simulateLiveTradingReadinessTrendComparison = (): LiveTradingReadinessTrendComparisonSimulationResult => {
  const stable = createDocument({
    generatedAt: 1_000,
    direction: 'STABLE',
    completedChecksChange: 1,
    readinessEscalations: 1,
    readinessRegressions: 1,
    bestCompletedChecks: 8,
    worstCompletedChecks: 5,
  });
  const improved = createDocument({
    generatedAt: 2_000,
    direction: 'IMPROVING',
    completedChecksChange: 2,
    readinessEscalations: 2,
    readinessRegressions: 0,
    bestCompletedChecks: 10,
    worstCompletedChecks: 7,
  });
  const unchanged = createDocument({
    generatedAt: 3_000,
    direction: 'IMPROVING',
    completedChecksChange: 2,
    readinessEscalations: 2,
    readinessRegressions: 0,
    bestCompletedChecks: 10,
    worstCompletedChecks: 7,
  });
  const worsened = createDocument({
    generatedAt: 4_000,
    direction: 'DETERIORATING',
    completedChecksChange: -1,
    readinessEscalations: 0,
    readinessRegressions: 2,
    bestCompletedChecks: 8,
    worstCompletedChecks: 4,
  });

  const outcomes = Object.freeze([
    compareLiveTradingReadinessTrendDocuments({ baseline: stable, candidate: improved }).outcome,
    compareLiveTradingReadinessTrendDocuments({ baseline: improved, candidate: unchanged }).outcome,
    compareLiveTradingReadinessTrendDocuments({ baseline: unchanged, candidate: worsened }).outcome,
  ]) as readonly ['IMPROVED', 'UNCHANGED', 'WORSENED'];

  if (outcomes.join(',') !== 'IMPROVED,UNCHANGED,WORSENED') {
    throw new Error(`Unexpected simulation outcomes: ${outcomes.join(',')}`);
  }

  return Object.freeze({ outcomes, orderExecutionAuthorized: false });
};

if (require.main === module) {
  const result = simulateLiveTradingReadinessTrendComparison();
  console.log('LIVE TRADING READINESS TREND COMPARISON SIMULATION');
  console.log(`Outcomes: ${result.outcomes.join(', ')}`);
  console.log(`Order execution authorized: ${result.orderExecutionAuthorized}`);
}
