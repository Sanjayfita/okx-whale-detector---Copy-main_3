import type { BacktestStatistics } from '../backtest/BacktestStatistics';

export interface CandidateFoldEvaluation {
  readonly fold: number;
  readonly train: BacktestStatistics;
  readonly test: BacktestStatistics;
}

export interface StrategyValidationPolicy {
  readonly minimumFoldCount: number;
  readonly minimumTestTradesPerFold: number;
  readonly minimumHoldoutTrades: number;
  readonly minimumPositiveFoldFraction: number;
  readonly minimumProfitFactor: number;
  readonly minimumExpectancy: number;
  readonly minimumSharpeRatio: number;
  readonly maximumDrawdownPercent: number;
  readonly maximumTrainTestSharpeGap: number;
  readonly minimumCostStressExpectancy: number;
  readonly minimumNeighborPassFraction: number;
}

export const DEFAULT_STRATEGY_VALIDATION_POLICY: StrategyValidationPolicy = {
  minimumFoldCount: 3,
  minimumTestTradesPerFold: 20,
  minimumHoldoutTrades: 50,
  minimumPositiveFoldFraction: 0.6,
  minimumProfitFactor: 1.05,
  minimumExpectancy: 0,
  minimumSharpeRatio: 0,
  maximumDrawdownPercent: 0.25,
  maximumTrainTestSharpeGap: 2,
  minimumCostStressExpectancy: 0,
  minimumNeighborPassFraction: 0.5,
};

export type StrategyValidationRejectionReason =
  | 'INSUFFICIENT_FOLDS'
  | 'INSUFFICIENT_TEST_TRADES'
  | 'UNSTABLE_OUT_OF_SAMPLE_EXPECTANCY'
  | 'OUT_OF_SAMPLE_PROFIT_FACTOR_TOO_LOW'
  | 'OUT_OF_SAMPLE_SHARPE_TOO_LOW'
  | 'OUT_OF_SAMPLE_DRAWDOWN_TOO_HIGH'
  | 'TRAIN_TEST_PERFORMANCE_GAP_TOO_LARGE'
  | 'HIGHER_COST_STRESS_FAILED'
  | 'PARAMETER_NEIGHBORHOOD_UNSTABLE'
  | 'HOLDOUT_REQUIRED'
  | 'HOLDOUT_INSUFFICIENT_TRADES'
  | 'HOLDOUT_EXPECTANCY_FAILED'
  | 'HOLDOUT_PROFIT_FACTOR_FAILED'
  | 'HOLDOUT_SHARPE_FAILED'
  | 'HOLDOUT_DRAWDOWN_FAILED';

export interface StrategyValidationDecision {
  readonly candidateId: string;
  readonly status:
    | 'REJECTED'
    | 'DISCOVERY_PASSED_HOLDOUT_REQUIRED'
    | 'VALIDATED_FOR_PAPER_RESEARCH';
  readonly rejectionReasons: readonly StrategyValidationRejectionReason[];
  readonly positiveFoldFraction: number;
  readonly medianTestExpectancy: number | null;
  readonly medianTestProfitFactor: number | null;
  readonly medianTestSharpeRatio: number | null;
  readonly maximumObservedTestDrawdownPercent: number | null;
  readonly liveExecutionAllowed: false;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue === undefined) {
    return null;
  }
  if (sorted.length % 2 === 1) {
    return middleValue;
  }
  const lower = sorted[middle - 1];
  return lower === undefined ? null : (lower + middleValue) / 2;
};

const uniqueReasons = (
  reasons: readonly StrategyValidationRejectionReason[],
): readonly StrategyValidationRejectionReason[] => [...new Set(reasons)];

const passesCoreMetrics = (
  metrics: BacktestStatistics,
  policy: StrategyValidationPolicy,
): boolean =>
  metrics.expectancy > policy.minimumExpectancy &&
  metrics.profitFactor !== null &&
  metrics.profitFactor >= policy.minimumProfitFactor &&
  metrics.sharpeRatio !== null &&
  metrics.sharpeRatio >= policy.minimumSharpeRatio &&
  metrics.maximumDrawdownPercent <= policy.maximumDrawdownPercent;

export const evaluateStrategyValidation = (input: {
  readonly candidateId: string;
  readonly folds: readonly CandidateFoldEvaluation[];
  readonly holdout: BacktestStatistics | null;
  readonly higherCostStress: BacktestStatistics | null;
  readonly parameterNeighbors: readonly BacktestStatistics[];
  readonly policy?: StrategyValidationPolicy;
}): StrategyValidationDecision => {
  const policy = input.policy ?? DEFAULT_STRATEGY_VALIDATION_POLICY;
  if (input.candidateId.trim().length === 0) {
    throw new Error('candidateId must not be empty');
  }

  const reasons: StrategyValidationRejectionReason[] = [];
  if (input.folds.length < policy.minimumFoldCount) {
    reasons.push('INSUFFICIENT_FOLDS');
  }
  if (
    input.folds.some(
      (fold) => fold.test.tradeCount < policy.minimumTestTradesPerFold,
    )
  ) {
    reasons.push('INSUFFICIENT_TEST_TRADES');
  }

  const testExpectancies = input.folds.map((fold) => fold.test.expectancy);
  const testProfitFactors = input.folds.flatMap((fold) =>
    fold.test.profitFactor === null ? [] : [fold.test.profitFactor],
  );
  const testSharpes = input.folds.flatMap((fold) =>
    fold.test.sharpeRatio === null ? [] : [fold.test.sharpeRatio],
  );
  const positiveFoldCount = input.folds.filter((fold) =>
    passesCoreMetrics(fold.test, policy),
  ).length;
  const positiveFoldFraction =
    input.folds.length === 0 ? 0 : positiveFoldCount / input.folds.length;
  const medianTestExpectancy = median(testExpectancies);
  const medianTestProfitFactor = median(testProfitFactors);
  const medianTestSharpeRatio = median(testSharpes);
  const maximumObservedTestDrawdownPercent =
    input.folds.length === 0
      ? null
      : Math.max(
          ...input.folds.map((fold) => fold.test.maximumDrawdownPercent),
        );

  if (positiveFoldFraction < policy.minimumPositiveFoldFraction) {
    reasons.push('UNSTABLE_OUT_OF_SAMPLE_EXPECTANCY');
  }
  if (
    medianTestProfitFactor === null ||
    medianTestProfitFactor < policy.minimumProfitFactor
  ) {
    reasons.push('OUT_OF_SAMPLE_PROFIT_FACTOR_TOO_LOW');
  }
  if (
    medianTestSharpeRatio === null ||
    medianTestSharpeRatio < policy.minimumSharpeRatio
  ) {
    reasons.push('OUT_OF_SAMPLE_SHARPE_TOO_LOW');
  }
  if (
    maximumObservedTestDrawdownPercent !== null &&
    maximumObservedTestDrawdownPercent > policy.maximumDrawdownPercent
  ) {
    reasons.push('OUT_OF_SAMPLE_DRAWDOWN_TOO_HIGH');
  }

  for (const fold of input.folds) {
    if (fold.train.sharpeRatio === null || fold.test.sharpeRatio === null) {
      continue;
    }
    if (
      fold.train.sharpeRatio - fold.test.sharpeRatio >
      policy.maximumTrainTestSharpeGap
    ) {
      reasons.push('TRAIN_TEST_PERFORMANCE_GAP_TOO_LARGE');
      break;
    }
  }

  if (
    input.higherCostStress === null ||
    input.higherCostStress.expectancy <= policy.minimumCostStressExpectancy
  ) {
    reasons.push('HIGHER_COST_STRESS_FAILED');
  }

  const neighborPassFraction =
    input.parameterNeighbors.length === 0
      ? 0
      : input.parameterNeighbors.filter((metrics) =>
          passesCoreMetrics(metrics, policy),
        ).length / input.parameterNeighbors.length;
  if (neighborPassFraction < policy.minimumNeighborPassFraction) {
    reasons.push('PARAMETER_NEIGHBORHOOD_UNSTABLE');
  }

  const discoveryReasons = uniqueReasons(reasons);
  if (discoveryReasons.length > 0) {
    return {
      candidateId: input.candidateId,
      status: 'REJECTED',
      rejectionReasons: discoveryReasons,
      positiveFoldFraction,
      medianTestExpectancy,
      medianTestProfitFactor,
      medianTestSharpeRatio,
      maximumObservedTestDrawdownPercent,
      liveExecutionAllowed: false,
    };
  }

  if (input.holdout === null) {
    return {
      candidateId: input.candidateId,
      status: 'DISCOVERY_PASSED_HOLDOUT_REQUIRED',
      rejectionReasons: ['HOLDOUT_REQUIRED'],
      positiveFoldFraction,
      medianTestExpectancy,
      medianTestProfitFactor,
      medianTestSharpeRatio,
      maximumObservedTestDrawdownPercent,
      liveExecutionAllowed: false,
    };
  }

  const holdoutReasons: StrategyValidationRejectionReason[] = [];
  if (input.holdout.tradeCount < policy.minimumHoldoutTrades) {
    holdoutReasons.push('HOLDOUT_INSUFFICIENT_TRADES');
  }
  if (input.holdout.expectancy <= policy.minimumExpectancy) {
    holdoutReasons.push('HOLDOUT_EXPECTANCY_FAILED');
  }
  if (
    input.holdout.profitFactor === null ||
    input.holdout.profitFactor < policy.minimumProfitFactor
  ) {
    holdoutReasons.push('HOLDOUT_PROFIT_FACTOR_FAILED');
  }
  if (
    input.holdout.sharpeRatio === null ||
    input.holdout.sharpeRatio < policy.minimumSharpeRatio
  ) {
    holdoutReasons.push('HOLDOUT_SHARPE_FAILED');
  }
  if (
    input.holdout.maximumDrawdownPercent > policy.maximumDrawdownPercent
  ) {
    holdoutReasons.push('HOLDOUT_DRAWDOWN_FAILED');
  }

  return {
    candidateId: input.candidateId,
    status:
      holdoutReasons.length === 0
        ? 'VALIDATED_FOR_PAPER_RESEARCH'
        : 'REJECTED',
    rejectionReasons: uniqueReasons(holdoutReasons),
    positiveFoldFraction,
    medianTestExpectancy,
    medianTestProfitFactor,
    medianTestSharpeRatio,
    maximumObservedTestDrawdownPercent,
    liveExecutionAllowed: false,
  };
};
