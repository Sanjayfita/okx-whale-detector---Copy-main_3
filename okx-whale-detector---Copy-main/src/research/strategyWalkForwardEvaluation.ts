import {
  compareStrategyCandidates,
  type StrategyCandidateComparison,
  type StrategyCandidateMetricInput,
} from './strategyCandidateComparison';

export interface StrategyWalkForwardWindow {
  windowId: string;
  startedAt: number;
  endedAt: number;
  metrics: readonly StrategyCandidateMetricInput[];
}

export interface StrategyWalkForwardWindowResult {
  windowId: string;
  startedAt: number;
  endedAt: number;
  comparison: StrategyCandidateComparison;
}

export interface StrategyWalkForwardEvaluation {
  baselineCandidateId: string;
  candidateCandidateId: string;
  windows: readonly StrategyWalkForwardWindowResult[];
  betterCount: number;
  worseCount: number;
  equivalentCount: number;
  insufficientDataCount: number;
  cumulativeWeightedScore: number;
  verdict: 'ROBUSTLY_BETTER' | 'ROBUSTLY_WORSE' | 'MIXED' | 'INSUFFICIENT_DATA';
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export const evaluateStrategyWalkForward = (input: {
  baselineCandidateId: string;
  candidateCandidateId: string;
  windows: readonly StrategyWalkForwardWindow[];
}): StrategyWalkForwardEvaluation => {
  if (!IDENTIFIER_PATTERN.test(input.baselineCandidateId)) {
    throw new Error('baselineCandidateId must be a valid durable identifier');
  }
  if (!IDENTIFIER_PATTERN.test(input.candidateCandidateId)) {
    throw new Error('candidateCandidateId must be a valid durable identifier');
  }
  if (input.baselineCandidateId === input.candidateCandidateId) {
    throw new Error('Walk-forward evaluation requires two different candidate IDs');
  }
  if (input.windows.length < 2) {
    throw new Error('Walk-forward evaluation requires at least two windows');
  }

  const ids = new Set<string>();
  const sorted = [...input.windows].sort(
    (left, right) => left.startedAt - right.startedAt || left.windowId.localeCompare(right.windowId),
  );

  sorted.forEach((window, index) => {
    if (!IDENTIFIER_PATTERN.test(window.windowId)) {
      throw new Error(`windows[${index}].windowId must be a valid durable identifier`);
    }
    if (ids.has(window.windowId)) throw new Error(`Duplicate window ID: ${window.windowId}`);
    ids.add(window.windowId);
    if (!Number.isSafeInteger(window.startedAt) || !Number.isSafeInteger(window.endedAt)) {
      throw new Error(`Window ${window.windowId} timestamps must be safe integers`);
    }
    if (window.startedAt < 0 || window.endedAt <= window.startedAt) {
      throw new Error(`Window ${window.windowId} must have a valid positive time range`);
    }
    if (index > 0 && sorted[index - 1]!.endedAt > window.startedAt) {
      throw new Error(`Walk-forward windows must not overlap: ${window.windowId}`);
    }
  });

  const windows = sorted.map((window) =>
    Object.freeze({
      windowId: window.windowId,
      startedAt: window.startedAt,
      endedAt: window.endedAt,
      comparison: compareStrategyCandidates({
        baselineCandidateId: input.baselineCandidateId,
        candidateCandidateId: input.candidateCandidateId,
        metrics: window.metrics,
      }),
    }),
  );

  const betterCount = windows.filter((window) => window.comparison.verdict === 'BETTER').length;
  const worseCount = windows.filter((window) => window.comparison.verdict === 'WORSE').length;
  const equivalentCount = windows.filter(
    (window) => window.comparison.verdict === 'EQUIVALENT',
  ).length;
  const insufficientDataCount = windows.filter(
    (window) => window.comparison.verdict === 'INSUFFICIENT_DATA',
  ).length;
  const availableCount = windows.length - insufficientDataCount;
  const cumulativeWeightedScore = windows.reduce(
    (sum, window) => sum + window.comparison.totalWeightedScore,
    0,
  );

  const verdict =
    availableCount === 0
      ? 'INSUFFICIENT_DATA'
      : betterCount === availableCount
        ? 'ROBUSTLY_BETTER'
        : worseCount === availableCount
          ? 'ROBUSTLY_WORSE'
          : 'MIXED';

  return Object.freeze({
    baselineCandidateId: input.baselineCandidateId,
    candidateCandidateId: input.candidateCandidateId,
    windows: Object.freeze(windows),
    betterCount,
    worseCount,
    equivalentCount,
    insufficientDataCount,
    cumulativeWeightedScore,
    verdict,
  });
};
