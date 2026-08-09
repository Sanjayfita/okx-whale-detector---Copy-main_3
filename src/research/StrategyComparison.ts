import {
  calculateBacktestStatistics,
  type BacktestStatistics,
  type BacktestTradeRecord,
} from '../backtest/BacktestStatistics';
import {
  adjustHolmBonferroni,
  evaluatePairedSignificance,
  type PairedSignificanceResult,
} from './StatisticalSignificance';

export interface StrategyComparisonTrade extends BacktestTradeRecord {
  readonly episodeId: string;
  readonly regime: string;
}

export interface StrategyComparisonCandidate {
  readonly strategyId: string;
  readonly label: string;
  readonly trades: readonly StrategyComparisonTrade[];
  readonly evaluatedEpisodeIds?: readonly string[];
  readonly validationStatus:
    | 'UNVALIDATED'
    | 'REJECTED'
    | 'DISCOVERY_PASSED_HOLDOUT_REQUIRED'
    | 'VALIDATED_FOR_PAPER_RESEARCH';
}

export interface RegimePerformance {
  readonly regime: string;
  readonly tradeCount: number;
  readonly expectancy: number;
  readonly profitFactor: number | null;
  readonly sharpeRatio: number | null;
}

export interface PairedImprovementEvidence {
  readonly baselineStrategyId: string;
  readonly evaluationUniverseComplete: boolean;
  readonly evaluationEpisodeCount: number;
  readonly baselineTradeEpisodeCount: number;
  readonly candidateTradeEpisodeCount: number;
  readonly pairedEpisodeCount: number;
  readonly meanPnlImprovement: number | null;
  readonly confidenceLower: number | null;
  readonly confidenceUpper: number | null;
  readonly probabilityOfImprovement: number | null;
  readonly standardizedEffect: number | null;
  readonly rawPValue: number | null;
  readonly adjustedPValue: number | null;
  readonly multiplicityMethod: 'HOLM_BONFERRONI';
  readonly statisticallySignificant: boolean;
  readonly rejectionReasons: readonly string[];
}

export interface StrategyComparisonRow {
  readonly rank: number;
  readonly strategyId: string;
  readonly label: string;
  readonly statistics: BacktestStatistics;
  readonly regimePerformance: readonly RegimePerformance[];
  readonly positiveRegimeFraction: number;
  readonly robustScore: number | null;
  readonly pairedImprovement: PairedImprovementEvidence | null;
  readonly promotionStatus:
    | 'BASELINE'
    | 'NOT_VALIDATED'
    | 'INCOMPLETE_EVALUATION_UNIVERSE'
    | 'NO_SIGNIFICANT_IMPROVEMENT'
    | 'ELIGIBLE_FOR_PAPER_COMPARISON';
  readonly liveExecutionAllowed: false;
}

export interface StrategyComparisonReport {
  readonly baselineStrategyId: string;
  readonly hypothesisFamilySize: number;
  readonly multiplicityMethod: 'HOLM_BONFERRONI';
  readonly rows: readonly StrategyComparisonRow[];
  readonly liveExecutionAllowed: false;
}

export interface StrategyComparisonPolicy {
  readonly initialEquity: number;
  readonly bootstrapIterations: number;
  readonly randomizationIterations: number;
  readonly confidenceLevel: number;
  readonly minimumPairedEpisodes: number;
  readonly minimumPositiveRegimeFraction: number;
  readonly familywiseAlpha: number;
  readonly seed: number;
}

export const DEFAULT_STRATEGY_COMPARISON_POLICY: StrategyComparisonPolicy = {
  initialEquity: 10_000,
  bootstrapIterations: 5_000,
  randomizationIterations: 5_000,
  confidenceLevel: 0.95,
  minimumPairedEpisodes: 50,
  minimumPositiveRegimeFraction: 0.6,
  familywiseAlpha: 0.05,
  seed: 42,
};

const validatePolicy = (policy: StrategyComparisonPolicy): void => {
  if (!Number.isFinite(policy.initialEquity) || policy.initialEquity <= 0) {
    throw new Error('initialEquity must be positive');
  }
  if (
    !Number.isSafeInteger(policy.bootstrapIterations) ||
    policy.bootstrapIterations < 1_000 ||
    !Number.isSafeInteger(policy.randomizationIterations) ||
    policy.randomizationIterations < 1_000 ||
    !Number.isSafeInteger(policy.minimumPairedEpisodes) ||
    policy.minimumPairedEpisodes <= 0 ||
    !Number.isSafeInteger(policy.seed)
  ) {
    throw new Error('invalid strategy comparison integer policy');
  }
  if (
    policy.confidenceLevel <= 0.5 ||
    policy.confidenceLevel >= 1 ||
    policy.minimumPositiveRegimeFraction < 0 ||
    policy.minimumPositiveRegimeFraction > 1 ||
    policy.familywiseAlpha <= 0 ||
    policy.familywiseAlpha >= 1
  ) {
    throw new Error('invalid strategy comparison fraction policy');
  }
};

const episodePnl = (
  trades: readonly StrategyComparisonTrade[],
): ReadonlyMap<string, number> => {
  const totals = new Map<string, number>();
  const tradeIds = new Set<string>();
  for (const trade of trades) {
    if (trade.id.trim().length === 0 || trade.episodeId.trim().length === 0) {
      throw new Error('trade id and episodeId must not be empty');
    }
    if (tradeIds.has(trade.id)) {
      throw new Error(`duplicate trade id ${trade.id}`);
    }
    tradeIds.add(trade.id);
    totals.set(trade.episodeId, (totals.get(trade.episodeId) ?? 0) + trade.netPnl);
  }
  return totals;
};

const evaluationSet = (
  candidate: StrategyComparisonCandidate,
): ReadonlySet<string> | null => {
  if (candidate.evaluatedEpisodeIds === undefined) {
    return null;
  }
  const ids = new Set<string>();
  for (const episodeId of candidate.evaluatedEpisodeIds) {
    if (episodeId.trim().length === 0 || ids.has(episodeId)) {
      throw new Error(
        `evaluatedEpisodeIds for ${candidate.strategyId} must be unique and non-empty`,
      );
    }
    ids.add(episodeId);
  }
  if (ids.size === 0) {
    throw new Error(`evaluatedEpisodeIds for ${candidate.strategyId} must not be empty`);
  }
  const tradeEpisodes = episodePnl(candidate.trades);
  for (const episodeId of tradeEpisodes.keys()) {
    if (!ids.has(episodeId)) {
      throw new Error(
        `trade episode ${episodeId} is outside the evaluation universe for ${candidate.strategyId}`,
      );
    }
  }
  return ids;
};

const equalSets = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value));

const rawPairedEvidence = (input: {
  readonly baseline: StrategyComparisonCandidate;
  readonly candidate: StrategyComparisonCandidate;
  readonly policy: StrategyComparisonPolicy;
  readonly seedOffset: number;
}): Readonly<{
  evidence: Omit<PairedImprovementEvidence, 'adjustedPValue' | 'statisticallySignificant'>;
  significance: PairedSignificanceResult;
}> => {
  const baselinePnl = episodePnl(input.baseline.trades);
  const candidatePnl = episodePnl(input.candidate.trades);
  const baselineUniverse = evaluationSet(input.baseline);
  const candidateUniverse = evaluationSet(input.candidate);
  const evaluationUniverseComplete =
    baselineUniverse !== null &&
    candidateUniverse !== null &&
    equalSets(baselineUniverse, candidateUniverse);
  const fallbackUniverse = new Set([
    ...baselinePnl.keys(),
    ...candidatePnl.keys(),
  ]);
  const universe = [...(evaluationUniverseComplete
    ? baselineUniverse
    : fallbackUniverse)].sort();
  const significance = evaluatePairedSignificance({
    outcomes: universe.map((episodeId) => ({
      pairId: episodeId,
      baselineValue: baselinePnl.get(episodeId) ?? 0,
      candidateValue: candidatePnl.get(episodeId) ?? 0,
    })),
    policy: {
      bootstrapIterations: input.policy.bootstrapIterations,
      randomizationIterations: input.policy.randomizationIterations,
      confidenceLevel: input.policy.confidenceLevel,
      minimumPairs: input.policy.minimumPairedEpisodes,
      seed: input.policy.seed + input.seedOffset,
    },
  });
  const rejectionReasons = [...significance.rejectionReasons];
  if (!evaluationUniverseComplete) {
    rejectionReasons.push('COMPLETE_SHARED_EVALUATION_UNIVERSE_REQUIRED');
  }
  return {
    significance,
    evidence: {
      baselineStrategyId: input.baseline.strategyId,
      evaluationUniverseComplete,
      evaluationEpisodeCount: universe.length,
      baselineTradeEpisodeCount: baselinePnl.size,
      candidateTradeEpisodeCount: candidatePnl.size,
      pairedEpisodeCount: significance.pairCount,
      meanPnlImprovement: significance.meanDifference,
      confidenceLower: significance.confidenceInterval?.lower ?? null,
      confidenceUpper: significance.confidenceInterval?.upper ?? null,
      probabilityOfImprovement: significance.probabilityOfImprovement,
      standardizedEffect: significance.standardizedEffect,
      rawPValue: significance.randomizationPValue,
      multiplicityMethod: 'HOLM_BONFERRONI',
      rejectionReasons: [...new Set(rejectionReasons)],
    },
  };
};

const regimePerformance = (input: {
  readonly trades: readonly StrategyComparisonTrade[];
  readonly initialEquity: number;
}): readonly RegimePerformance[] => {
  const groups = new Map<string, StrategyComparisonTrade[]>();
  for (const trade of input.trades) {
    if (trade.regime.trim().length === 0) {
      throw new Error(`regime is required for trade ${trade.id}`);
    }
    groups.set(trade.regime, [...(groups.get(trade.regime) ?? []), trade]);
  }
  return [...groups.entries()]
    .map(([regime, trades]) => {
      const statistics = calculateBacktestStatistics({
        initialEquity: input.initialEquity,
        trades,
      });
      return {
        regime,
        tradeCount: statistics.tradeCount,
        expectancy: statistics.expectancy,
        profitFactor: statistics.profitFactor,
        sharpeRatio: statistics.sharpeRatio,
      };
    })
    .sort((left, right) => left.regime.localeCompare(right.regime));
};

const robustScore = (input: {
  readonly statistics: BacktestStatistics;
  readonly positiveRegimeFraction: number;
}): number | null => {
  if (
    input.statistics.profitFactor === null ||
    input.statistics.sharpeRatio === null ||
    input.statistics.sortinoRatio === null ||
    input.statistics.recoveryFactor === null
  ) {
    return null;
  }
  return (
    Math.log(Math.max(input.statistics.profitFactor, 1e-9)) +
    input.statistics.sharpeRatio * 0.35 +
    input.statistics.sortinoRatio * 0.15 +
    input.statistics.recoveryFactor * 0.15 +
    input.positiveRegimeFraction -
    input.statistics.maximumDrawdownPercent * 3
  );
};

export const compareStrategies = (input: {
  readonly baselineStrategyId: string;
  readonly candidates: readonly StrategyComparisonCandidate[];
  readonly policy?: Partial<StrategyComparisonPolicy>;
}): StrategyComparisonReport => {
  const policy: StrategyComparisonPolicy = {
    ...DEFAULT_STRATEGY_COMPARISON_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  if (input.candidates.length === 0) {
    throw new Error('strategy comparison requires candidates');
  }
  const ids = new Set<string>();
  for (const candidate of input.candidates) {
    if (candidate.strategyId.trim().length === 0 || ids.has(candidate.strategyId)) {
      throw new Error('strategyIds must be unique and non-empty');
    }
    ids.add(candidate.strategyId);
    evaluationSet(candidate);
  }
  const baseline = input.candidates.find(
    (candidate) => candidate.strategyId === input.baselineStrategyId,
  );
  if (baseline === undefined) {
    throw new Error(`baseline ${input.baselineStrategyId} is missing`);
  }

  const preliminaries = input.candidates.map((candidate, index) => {
    const statistics = calculateBacktestStatistics({
      initialEquity: policy.initialEquity,
      trades: candidate.trades,
    });
    const regimes = regimePerformance({
      trades: candidate.trades,
      initialEquity: policy.initialEquity,
    });
    const positiveRegimeFraction =
      regimes.length === 0
        ? 0
        : regimes.filter((regime) => regime.expectancy > 0).length /
          regimes.length;
    const paired =
      candidate.strategyId === baseline.strategyId
        ? null
        : rawPairedEvidence({
            baseline,
            candidate,
            policy,
            seedOffset: index + 1,
          });
    return {
      candidate,
      statistics,
      regimes,
      positiveRegimeFraction,
      score: robustScore({ statistics, positiveRegimeFraction }),
      paired,
    };
  });

  const adjusted = adjustHolmBonferroni({
    alpha: policy.familywiseAlpha,
    hypotheses: preliminaries.flatMap((item) =>
      item.paired === null
        ? []
        : [
            {
              id: item.candidate.strategyId,
              rawPValue: item.paired.evidence.rawPValue,
              value: item,
            },
          ],
    ),
  });
  const adjustmentById = new Map(
    adjusted.map((item) => [item.id, item] as const),
  );

  const rows = preliminaries
    .map((item): Omit<StrategyComparisonRow, 'rank'> => {
      const adjustment = adjustmentById.get(item.candidate.strategyId);
      const pairedImprovement =
        item.paired === null
          ? null
          : {
              ...item.paired.evidence,
              adjustedPValue: adjustment?.adjustedPValue ?? null,
              statisticallySignificant:
                item.paired.significance.status === 'PASSED' &&
                item.paired.evidence.evaluationUniverseComplete &&
                (adjustment?.rejectedAtAlpha ?? false),
            };
      let promotionStatus: StrategyComparisonRow['promotionStatus'];
      if (item.candidate.strategyId === baseline.strategyId) {
        promotionStatus = 'BASELINE';
      } else if (
        item.candidate.validationStatus !== 'VALIDATED_FOR_PAPER_RESEARCH' ||
        item.positiveRegimeFraction < policy.minimumPositiveRegimeFraction
      ) {
        promotionStatus = 'NOT_VALIDATED';
      } else if (!pairedImprovement?.evaluationUniverseComplete) {
        promotionStatus = 'INCOMPLETE_EVALUATION_UNIVERSE';
      } else if (!pairedImprovement.statisticallySignificant) {
        promotionStatus = 'NO_SIGNIFICANT_IMPROVEMENT';
      } else {
        promotionStatus = 'ELIGIBLE_FOR_PAPER_COMPARISON';
      }
      return {
        strategyId: item.candidate.strategyId,
        label: item.candidate.label,
        statistics: item.statistics,
        regimePerformance: item.regimes,
        positiveRegimeFraction: item.positiveRegimeFraction,
        robustScore: item.score,
        pairedImprovement,
        promotionStatus,
        liveExecutionAllowed: false,
      };
    })
    .sort((left, right) => {
      if (left.robustScore === null && right.robustScore === null) {
        return left.strategyId.localeCompare(right.strategyId);
      }
      if (left.robustScore === null) {
        return 1;
      }
      if (right.robustScore === null) {
        return -1;
      }
      return right.robustScore - left.robustScore ||
        left.strategyId.localeCompare(right.strategyId);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return {
    baselineStrategyId: baseline.strategyId,
    hypothesisFamilySize: adjusted.length,
    multiplicityMethod: 'HOLM_BONFERRONI',
    rows,
    liveExecutionAllowed: false,
  };
};
