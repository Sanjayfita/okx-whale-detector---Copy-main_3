import type { LiveTradingReadinessStatus } from './liveTradingReadiness';
import type { LiveTradingReadinessDocument } from './liveTradingReadinessPersistence';

export type LiveTradingReadinessComparisonOutcome =
  | 'IMPROVED'
  | 'UNCHANGED'
  | 'WORSENED';

export interface LiveTradingReadinessComparison {
  baselineGeneratedAt: number;
  candidateGeneratedAt: number;
  outcome: LiveTradingReadinessComparisonOutcome;
  baselineStatus: LiveTradingReadinessStatus;
  candidateStatus: LiveTradingReadinessStatus;
  completedChecksDelta: number;
  newlyCompletedChecks: readonly string[];
  regressedChecks: readonly string[];
  unchangedCompletedChecks: readonly string[];
  reasons: readonly string[];
  orderExecutionAuthorized: false;
}

const STATUS_RANK: Readonly<Record<LiveTradingReadinessStatus, number>> = Object.freeze({
  NOT_READY: 0,
  REVIEW_REQUIRED: 1,
  READY_FOR_MANUAL_REVIEW: 2,
});

export const compareLiveTradingReadinessDocuments = (input: {
  baseline: LiveTradingReadinessDocument;
  candidate: LiveTradingReadinessDocument;
}): LiveTradingReadinessComparison => {
  const { baseline, candidate } = input;
  if (candidate.generatedAt < baseline.generatedAt) {
    throw new Error('Candidate readiness document cannot be older than baseline');
  }

  const checklistKeys = Object.keys(baseline.checklist).sort() as Array<
    keyof typeof baseline.checklist
  >;
  const candidateKeys = Object.keys(candidate.checklist).sort();
  if (
    checklistKeys.length !== candidateKeys.length ||
    checklistKeys.some((key, index) => key !== candidateKeys[index])
  ) {
    throw new Error('Readiness documents must use the same checklist');
  }

  const newlyCompletedChecks: string[] = [];
  const regressedChecks: string[] = [];
  const unchangedCompletedChecks: string[] = [];

  for (const key of checklistKeys) {
    const before = baseline.checklist[key];
    const after = candidate.checklist[key];
    if (!before && after) newlyCompletedChecks.push(key);
    else if (before && !after) regressedChecks.push(key);
    else if (before && after) unchangedCompletedChecks.push(key);
  }

  const baselineRank = STATUS_RANK[baseline.assessment.status];
  const candidateRank = STATUS_RANK[candidate.assessment.status];
  const reasons: string[] = [];
  let outcome: LiveTradingReadinessComparisonOutcome;

  if (candidateRank > baselineRank || (newlyCompletedChecks.length > 0 && regressedChecks.length === 0)) {
    outcome = 'IMPROVED';
    reasons.push('Safety readiness improved without any checklist regression');
  } else if (candidateRank < baselineRank || regressedChecks.length > 0) {
    outcome = 'WORSENED';
    reasons.push('One or more safety controls regressed');
  } else {
    outcome = 'UNCHANGED';
    reasons.push('Safety readiness did not change');
  }

  reasons.push('Comparison never authorizes real-order execution');

  return Object.freeze({
    baselineGeneratedAt: baseline.generatedAt,
    candidateGeneratedAt: candidate.generatedAt,
    outcome,
    baselineStatus: baseline.assessment.status,
    candidateStatus: candidate.assessment.status,
    completedChecksDelta:
      candidate.assessment.completedChecks - baseline.assessment.completedChecks,
    newlyCompletedChecks: Object.freeze(newlyCompletedChecks),
    regressedChecks: Object.freeze(regressedChecks),
    unchangedCompletedChecks: Object.freeze(unchangedCompletedChecks),
    reasons: Object.freeze(reasons),
    orderExecutionAuthorized: false,
  });
};
