import type { LiveTradingReadinessTrendDirection } from './liveTradingReadinessTrend';
import type { LiveTradingReadinessTrendDocument } from './liveTradingReadinessTrendPersistence';

export type LiveTradingReadinessTrendComparisonOutcome =
  | 'IMPROVED'
  | 'UNCHANGED'
  | 'WORSENED';

export interface LiveTradingReadinessTrendComparison {
  baselineGeneratedAt: number;
  candidateGeneratedAt: number;
  outcome: LiveTradingReadinessTrendComparisonOutcome;
  baselineDirection: LiveTradingReadinessTrendDirection;
  candidateDirection: LiveTradingReadinessTrendDirection;
  completedChecksChangeDelta: number;
  readinessEscalationsDelta: number;
  readinessRegressionsDelta: number;
  bestCompletedChecksDelta: number;
  worstCompletedChecksDelta: number;
  reasons: readonly string[];
  orderExecutionAuthorized: false;
}

const DIRECTION_RANK: Readonly<Record<LiveTradingReadinessTrendDirection, number>> =
  Object.freeze({
    DETERIORATING: 0,
    STABLE: 1,
    IMPROVING: 2,
  });

export const compareLiveTradingReadinessTrendDocuments = (input: {
  baseline: LiveTradingReadinessTrendDocument;
  candidate: LiveTradingReadinessTrendDocument;
}): LiveTradingReadinessTrendComparison => {
  const { baseline, candidate } = input;

  if (candidate.generatedAt < baseline.generatedAt) {
    throw new Error('Candidate readiness trend document cannot be older than baseline');
  }

  const baselineTrend = baseline.trend;
  const candidateTrend = candidate.trend;
  const directionDelta =
    DIRECTION_RANK[candidateTrend.direction] - DIRECTION_RANK[baselineTrend.direction];
  const completedChecksChangeDelta =
    candidateTrend.completedChecksChange - baselineTrend.completedChecksChange;
  const readinessEscalationsDelta =
    candidateTrend.readinessEscalations - baselineTrend.readinessEscalations;
  const readinessRegressionsDelta =
    candidateTrend.readinessRegressions - baselineTrend.readinessRegressions;
  const bestCompletedChecksDelta =
    candidateTrend.bestCompletedChecks - baselineTrend.bestCompletedChecks;
  const worstCompletedChecksDelta =
    candidateTrend.worstCompletedChecks - baselineTrend.worstCompletedChecks;

  const reasons: string[] = [];
  let outcome: LiveTradingReadinessTrendComparisonOutcome;

  const hasPositiveChange =
    directionDelta > 0 ||
    completedChecksChangeDelta > 0 ||
    readinessEscalationsDelta > 0 ||
    readinessRegressionsDelta < 0 ||
    bestCompletedChecksDelta > 0 ||
    worstCompletedChecksDelta > 0;
  const hasNegativeChange =
    directionDelta < 0 ||
    completedChecksChangeDelta < 0 ||
    readinessEscalationsDelta < 0 ||
    readinessRegressionsDelta > 0 ||
    bestCompletedChecksDelta < 0 ||
    worstCompletedChecksDelta < 0;

  if (hasNegativeChange) {
    outcome = 'WORSENED';
    reasons.push('One or more readiness trend indicators regressed');
  } else if (hasPositiveChange) {
    outcome = 'IMPROVED';
    reasons.push('Readiness trend indicators improved without regression');
  } else {
    outcome = 'UNCHANGED';
    reasons.push('Readiness trend indicators did not change');
  }

  reasons.push('Trend comparison never authorizes real-order execution');

  return Object.freeze({
    baselineGeneratedAt: baseline.generatedAt,
    candidateGeneratedAt: candidate.generatedAt,
    outcome,
    baselineDirection: baselineTrend.direction,
    candidateDirection: candidateTrend.direction,
    completedChecksChangeDelta,
    readinessEscalationsDelta,
    readinessRegressionsDelta,
    bestCompletedChecksDelta,
    worstCompletedChecksDelta,
    reasons: Object.freeze(reasons),
    orderExecutionAuthorized: false,
  });
};
