import type { FeatureSelectionReport } from './FeatureSelection';
import type { RobustnessValidationDecision } from './RobustnessValidation';
import type { StrategyComparisonRow } from './StrategyComparison';
import type { StrategyValidationDecision } from './StrategyValidation';

export interface ValidatedLeaderboardCandidate {
  readonly strategyId: string;
  readonly label: string;
  readonly comparison: StrategyComparisonRow;
  readonly validation: StrategyValidationDecision;
  readonly robustness: RobustnessValidationDecision;
  readonly featureSelection: FeatureSelectionReport;
}

export interface ValidatedLeaderboardRow {
  readonly rank: number | null;
  readonly strategyId: string;
  readonly label: string;
  readonly status: 'VALIDATED_METRICS' | 'EXCLUDED';
  readonly tradeCount: number;
  readonly expectancy: number | null;
  readonly profitFactor: number | null;
  readonly sharpeRatio: number | null;
  readonly sortinoRatio: number | null;
  readonly maximumDrawdownPercent: number | null;
  readonly recoveryFactor: number | null;
  readonly positiveRegimeFraction: number | null;
  readonly robustScore: number | null;
  readonly baselineImprovementSignificant: boolean | null;
  readonly exclusionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

export interface ValidatedLeaderboardReport {
  readonly rows: readonly ValidatedLeaderboardRow[];
  readonly rankedStrategyCount: number;
  readonly excludedStrategyCount: number;
  readonly liveExecutionAllowed: false;
}

const validateCandidateIdentity = (
  candidate: ValidatedLeaderboardCandidate,
): void => {
  if (candidate.strategyId.trim().length === 0) {
    throw new Error('strategyId must not be empty');
  }
  if (candidate.label.trim().length === 0) {
    throw new Error(`label must not be empty for ${candidate.strategyId}`);
  }
  if (
    candidate.comparison.strategyId !== candidate.strategyId ||
    candidate.validation.candidateId !== candidate.strategyId ||
    candidate.robustness.strategyId !== candidate.strategyId
  ) {
    throw new Error(`strategy evidence mismatch for ${candidate.strategyId}`);
  }
};

const exclusionReasons = (
  candidate: ValidatedLeaderboardCandidate,
): readonly string[] => {
  const reasons: string[] = [];
  if (candidate.validation.status !== 'VALIDATED_FOR_PAPER_RESEARCH') {
    reasons.push('STRATEGY_VALIDATION_NOT_PASSED');
  }
  if (candidate.robustness.status !== 'ROBUSTNESS_PASSED') {
    reasons.push('ROBUSTNESS_VALIDATION_NOT_PASSED');
  }
  if (candidate.featureSelection.status !== 'SELECTION_PASSED') {
    reasons.push('FEATURE_SELECTION_NOT_PASSED');
  }
  if (candidate.comparison.statistics.tradeCount === 0) {
    reasons.push('NO_COMPARABLE_TRADES');
  }
  if (candidate.comparison.statistics.profitFactor === null) {
    reasons.push('PROFIT_FACTOR_UNDEFINED');
  }
  if (candidate.comparison.statistics.sharpeRatio === null) {
    reasons.push('SHARPE_UNDEFINED');
  }
  if (candidate.comparison.statistics.sortinoRatio === null) {
    reasons.push('SORTINO_UNDEFINED');
  }
  if (candidate.comparison.statistics.recoveryFactor === null) {
    reasons.push('RECOVERY_FACTOR_UNDEFINED');
  }
  if (candidate.comparison.robustScore === null) {
    reasons.push('ROBUST_SCORE_UNDEFINED');
  }
  return reasons;
};

export const buildValidatedLeaderboard = (input: {
  readonly candidates: readonly ValidatedLeaderboardCandidate[];
}): ValidatedLeaderboardReport => {
  if (input.candidates.length === 0) {
    throw new Error('validated leaderboard requires candidates');
  }
  const ids = new Set<string>();
  for (const candidate of input.candidates) {
    validateCandidateIdentity(candidate);
    if (ids.has(candidate.strategyId)) {
      throw new Error(`duplicate strategyId ${candidate.strategyId}`);
    }
    ids.add(candidate.strategyId);
  }

  const unranked = input.candidates.map((candidate) => {
    const reasons = exclusionReasons(candidate);
    return {
      candidate,
      reasons,
      eligible: reasons.length === 0,
    };
  });
  const rankedIds = new Map<string, number>();
  unranked
    .filter((entry) => entry.eligible)
    .sort(
      (left, right) =>
        (right.candidate.comparison.robustScore ?? Number.NEGATIVE_INFINITY) -
          (left.candidate.comparison.robustScore ?? Number.NEGATIVE_INFINITY) ||
        (right.candidate.comparison.statistics.profitFactor ??
          Number.NEGATIVE_INFINITY) -
          (left.candidate.comparison.statistics.profitFactor ??
            Number.NEGATIVE_INFINITY) ||
        left.candidate.strategyId.localeCompare(right.candidate.strategyId),
    )
    .forEach((entry, index) => {
      rankedIds.set(entry.candidate.strategyId, index + 1);
    });

  const rows = unranked
    .map((entry): ValidatedLeaderboardRow => {
      const statistics = entry.candidate.comparison.statistics;
      const rank = rankedIds.get(entry.candidate.strategyId) ?? null;
      return {
        rank,
        strategyId: entry.candidate.strategyId,
        label: entry.candidate.label,
        status: rank === null ? 'EXCLUDED' : 'VALIDATED_METRICS',
        tradeCount: statistics.tradeCount,
        expectancy: rank === null ? null : statistics.expectancy,
        profitFactor: rank === null ? null : statistics.profitFactor,
        sharpeRatio: rank === null ? null : statistics.sharpeRatio,
        sortinoRatio: rank === null ? null : statistics.sortinoRatio,
        maximumDrawdownPercent:
          rank === null ? null : statistics.maximumDrawdownPercent,
        recoveryFactor: rank === null ? null : statistics.recoveryFactor,
        positiveRegimeFraction:
          rank === null
            ? null
            : entry.candidate.comparison.positiveRegimeFraction,
        robustScore:
          rank === null ? null : entry.candidate.comparison.robustScore,
        baselineImprovementSignificant:
          entry.candidate.comparison.pairedImprovement === null
            ? null
            : entry.candidate.comparison.pairedImprovement
                .statisticallySignificant,
        exclusionReasons: entry.reasons,
        liveExecutionAllowed: false,
      };
    })
    .sort((left, right) => {
      if (left.rank !== null && right.rank !== null) {
        return left.rank - right.rank;
      }
      if (left.rank !== null) {
        return -1;
      }
      if (right.rank !== null) {
        return 1;
      }
      return left.strategyId.localeCompare(right.strategyId);
    });

  return {
    rows,
    rankedStrategyCount: rankedIds.size,
    excludedStrategyCount: rows.length - rankedIds.size,
    liveExecutionAllowed: false,
  };
};
