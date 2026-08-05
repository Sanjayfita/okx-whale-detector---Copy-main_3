import {
  calculateBacktestStatistics,
  type BacktestStatistics,
  type BacktestTradeRecord,
} from '../backtest/BacktestStatistics';

export interface StrategyComparisonTrade extends BacktestTradeRecord {
  readonly episodeId: string;
  readonly regime: string;
}

export interface StrategyComparisonCandidate {
  readonly strategyId: string;
  readonly label: string;
  readonly trades: readonly StrategyComparisonTrade[];
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
  readonly pairedEpisodeCount: number;
  readonly meanPnlImprovement: number | null;
  readonly confidenceLower: number | null;
  readonly confidenceUpper: number | null;
  readonly probabilityOfImprovement: number | null;
  readonly statisticallySignificant: boolean;
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
    | 'NO_SIGNIFICANT_IMPROVEMENT'
    | 'ELIGIBLE_FOR_PAPER_COMPARISON';
  readonly liveExecutionAllowed: false;
}

export interface StrategyComparisonReport {
  readonly baselineStrategyId: string;
  readonly rows: readonly StrategyComparisonRow[];
  readonly liveExecutionAllowed: false;
}

export interface StrategyComparisonPolicy {
  readonly initialEquity: number;
  readonly bootstrapIterations: number;
  readonly confidenceLevel: number;
  readonly minimumPairedEpisodes: number;
  readonly minimumPositiveRegimeFraction: number;
  readonly seed: number;
}

export const DEFAULT_STRATEGY_COMPARISON_POLICY: StrategyComparisonPolicy = {
  initialEquity: 10_000,
  bootstrapIterations: 5_000,
  confidenceLevel: 0.95,
  minimumPairedEpisodes: 50,
  minimumPositiveRegimeFraction: 0.6,
  seed: 42,
};

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const quantile = (values: readonly number[], probability: number): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) {
    return null;
  }
  return lower + (upper - lower) * (position - lowerIndex);
};

const episodePnl = (
  trades: readonly StrategyComparisonTrade[],
): ReadonlyMap<string, number> => {
  const totals = new Map<string, number>();
  for (const trade of trades) {
    if (trade.episodeId.trim().length === 0) {
      throw new Error('episodeId must not be empty');
    }
    totals.set(trade.episodeId, (totals.get(trade.episodeId) ?? 0) + trade.netPnl);
  }
  return totals;
};

const pairedEvidence = (input: {
  readonly baseline: StrategyComparisonCandidate;
  readonly candidate: StrategyComparisonCandidate;
  readonly policy: StrategyComparisonPolicy;
  readonly seedOffset: number;
}): PairedImprovementEvidence => {
  const baseline = episodePnl(input.baseline.trades);
  const candidate = episodePnl(input.candidate.trades);
  const episodeIds = [...candidate.keys()]
    .filter((episodeId) => baseline.has(episodeId))
    .sort();
  const differences = episodeIds.map(
    (episodeId) =>
      (candidate.get(episodeId) ?? 0) - (baseline.get(episodeId) ?? 0),
  );
  if (differences.length < input.policy.minimumPairedEpisodes) {
    return {
      baselineStrategyId: input.baseline.strategyId,
      pairedEpisodeCount: differences.length,
      meanPnlImprovement:
        differences.length === 0
          ? null
          : differences.reduce((sum, value) => sum + value, 0) /
            differences.length,
      confidenceLower: null,
      confidenceUpper: null,
      probabilityOfImprovement: null,
      statisticallySignificant: false,
    };
  }

  const random = createRandom(input.policy.seed + input.seedOffset);
  const bootstrapMeans: number[] = [];
  for (
    let iteration = 0;
    iteration < input.policy.bootstrapIterations;
    iteration += 1
  ) {
    let sum = 0;
    for (let index = 0; index < differences.length; index += 1) {
      const sampled = differences[Math.floor(random() * differences.length)];
      sum += sampled ?? 0;
    }
    bootstrapMeans.push(sum / differences.length);
  }
  const alpha = 1 - input.policy.confidenceLevel;
  const confidenceLower = quantile(bootstrapMeans, alpha / 2);
  const confidenceUpper = quantile(bootstrapMeans, 1 - alpha / 2);
  const probabilityOfImprovement =
    bootstrapMeans.filter((value) => value > 0).length / bootstrapMeans.length;
  return {
    baselineStrategyId: input.baseline.strategyId,
    pairedEpisodeCount: differences.length,
    meanPnlImprovement:
      differences.reduce((sum, value) => sum + value, 0) / differences.length,
    confidenceLower,
    confidenceUpper,
    probabilityOfImprovement,
    statisticallySignificant:
      confidenceLower !== null && confidenceLower > 0,
  };
};

const regimePerformance = (input: {
  readonly trades: readonly StrategyComparisonTrade[];
  readonly initialEquity: number;
}): readonly RegimePerformance[] => {
  const groups = new Map<string, StrategyComparisonTrade[]>();
  for (const trade of input.trades) {
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
  if (input.candidates.length === 0) {
    throw new Error('strategy comparison requires candidates');
  }
  const ids = new Set<string>();
  for (const candidate of input.candidates) {
    if (candidate.strategyId.trim().length === 0) {
      throw new Error('strategyId must not be empty');
    }
    if (ids.has(candidate.strategyId)) {
      throw new Error(`duplicate strategyId ${candidate.strategyId}`);
    }
    ids.add(candidate.strategyId);
  }
  const baseline = input.candidates.find(
    (candidate) => candidate.strategyId === input.baselineStrategyId,
  );
  if (baseline === undefined) {
    throw new Error(`baseline ${input.baselineStrategyId} is missing`);
  }

  const unsortedRows = input.candidates.map((candidate, index) => {
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
    const pairedImprovement =
      candidate.strategyId === baseline.strategyId
        ? null
        : pairedEvidence({
            baseline,
            candidate,
            policy,
            seedOffset: index + 1,
          });
    const score = robustScore({ statistics, positiveRegimeFraction });
    let promotionStatus: StrategyComparisonRow['promotionStatus'];
    if (candidate.strategyId === baseline.strategyId) {
      promotionStatus = 'BASELINE';
    } else if (
      candidate.validationStatus !== 'VALIDATED_FOR_PAPER_RESEARCH' ||
      positiveRegimeFraction < policy.minimumPositiveRegimeFraction
    ) {
      promotionStatus = 'NOT_VALIDATED';
    } else if (!pairedImprovement?.statisticallySignificant) {
      promotionStatus = 'NO_SIGNIFICANT_IMPROVEMENT';
    } else {
      promotionStatus = 'ELIGIBLE_FOR_PAPER_COMPARISON';
    }
    return {
      rank: 0,
      strategyId: candidate.strategyId,
      label: candidate.label,
      statistics,
      regimePerformance: regimes,
      positiveRegimeFraction,
      robustScore: score,
      pairedImprovement,
      promotionStatus,
      liveExecutionAllowed: false as const,
    };
  });

  const rows = unsortedRows
    .slice()
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
    rows,
    liveExecutionAllowed: false,
  };
};
