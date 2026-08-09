import type { BacktestStatistics } from '../backtest/BacktestStatistics';
import type {
  PurgedWalkForwardPlan,
  WalkForwardObservation,
} from './PurgedWalkForward';

export type NumericParameterSpace = Readonly<Record<string, readonly number[]>>;
export type NumericParameters = Readonly<Record<string, number>>;

export interface OptimizerFoldResult {
  readonly fold: number;
  readonly train: BacktestStatistics;
  readonly test: BacktestStatistics;
}

export interface OptimizationTrialResult {
  readonly trialIndex: number;
  readonly parameters: NumericParameters;
  readonly folds: readonly OptimizerFoldResult[];
  readonly objectiveValue: number | null;
  readonly status: 'COMPLETED' | 'REJECTED' | 'FAILED';
  readonly rejectionReasons: readonly string[];
}

export interface WalkForwardOptimizationResult {
  readonly optimizer: 'DETERMINISTIC_GRID';
  readonly trials: readonly OptimizationTrialResult[];
  readonly selectedTrial: OptimizationTrialResult | null;
  readonly holdoutEvaluated: false;
  readonly liveExecutionAllowed: false;
}

export interface FrozenHoldoutResult {
  readonly parameters: NumericParameters;
  readonly metrics: BacktestStatistics;
  readonly holdoutEvaluated: true;
  readonly liveExecutionAllowed: false;
}

export interface WalkForwardOptimizerPolicy {
  readonly maximumTrials: number;
  readonly minimumTestTradesPerFold: number;
  readonly minimumPositiveFoldFraction: number;
  readonly drawdownPenalty: number;
  readonly trainTestGapPenalty: number;
}

export const DEFAULT_WALK_FORWARD_OPTIMIZER_POLICY: WalkForwardOptimizerPolicy = {
  maximumTrials: 500,
  minimumTestTradesPerFold: 20,
  minimumPositiveFoldFraction: 0.6,
  drawdownPenalty: 2,
  trainTestGapPenalty: 0.25,
};

export type BacktestEvaluator<T extends WalkForwardObservation> = (input: {
  readonly parameters: NumericParameters;
  readonly observations: readonly T[];
  readonly phase: 'TRAIN' | 'TEST' | 'HOLDOUT';
  readonly fold: number | null;
}) => Promise<BacktestStatistics> | BacktestStatistics;

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) {
    return null;
  }
  if (sorted.length % 2 === 1) {
    return upper;
  }
  const lower = sorted[middle - 1];
  return lower === undefined ? null : (lower + upper) / 2;
};

const enumerateParameterGrid = (
  space: NumericParameterSpace,
  maximumTrials: number,
): readonly NumericParameters[] => {
  if (!Number.isSafeInteger(maximumTrials) || maximumTrials <= 0) {
    throw new Error('maximumTrials must be a positive safe integer');
  }
  const entries = Object.entries(space).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) {
    throw new Error('parameter space must not be empty');
  }
  for (const [name, values] of entries) {
    if (values.length === 0) {
      throw new Error(`parameter ${name} has no candidate values`);
    }
    for (const value of values) {
      if (!Number.isFinite(value)) {
        throw new Error(`parameter ${name} contains a non-finite value`);
      }
    }
  }

  let grid: NumericParameters[] = [{}];
  for (const [name, values] of entries) {
    const expanded: NumericParameters[] = [];
    for (const parameters of grid) {
      for (const value of values) {
        expanded.push({ ...parameters, [name]: value });
        if (expanded.length > maximumTrials) {
          throw new Error(
            `parameter grid exceeds maximumTrials=${maximumTrials}; narrow the frozen search space`,
          );
        }
      }
    }
    grid = expanded;
  }
  return grid;
};

const validateStatistics = (statistics: BacktestStatistics): void => {
  const numericValues = [
    statistics.winRate,
    statistics.netProfit,
    statistics.expectancy,
    statistics.maximumDrawdown,
    statistics.maximumDrawdownPercent,
    statistics.averageHoldingTimeMs,
    statistics.totalFees,
    statistics.totalFundingPnl,
  ];
  if (numericValues.some((value) => !Number.isFinite(value))) {
    throw new Error('backtest evaluator returned non-finite statistics');
  }
};

const calculateObjective = (
  folds: readonly OptimizerFoldResult[],
  policy: WalkForwardOptimizerPolicy,
): { readonly value: number | null; readonly rejectionReasons: readonly string[] } => {
  const reasons: string[] = [];
  if (folds.length === 0) {
    return { value: null, rejectionReasons: ['NO_WALK_FORWARD_FOLDS'] };
  }
  if (
    folds.some(
      (fold) => fold.test.tradeCount < policy.minimumTestTradesPerFold,
    )
  ) {
    reasons.push('INSUFFICIENT_TEST_TRADES');
  }
  const positiveFraction =
    folds.filter((fold) => fold.test.expectancy > 0).length / folds.length;
  if (positiveFraction < policy.minimumPositiveFoldFraction) {
    reasons.push('UNSTABLE_OUT_OF_SAMPLE_EXPECTANCY');
  }

  const medianExpectancy = median(folds.map((fold) => fold.test.expectancy));
  const medianSharpe = median(
    folds.flatMap((fold) =>
      fold.test.sharpeRatio === null ? [] : [fold.test.sharpeRatio],
    ),
  );
  if (medianExpectancy === null || medianSharpe === null) {
    reasons.push('UNDEFINED_OUT_OF_SAMPLE_OBJECTIVE');
  }
  const maximumDrawdown = Math.max(
    ...folds.map((fold) => fold.test.maximumDrawdownPercent),
  );
  const averageTrainTestGap =
    folds.reduce((sum, fold) => {
      const trainSharpe = fold.train.sharpeRatio ?? 0;
      const testSharpe = fold.test.sharpeRatio ?? 0;
      return sum + Math.max(0, trainSharpe - testSharpe);
    }, 0) / folds.length;

  if (reasons.length > 0 || medianExpectancy === null || medianSharpe === null) {
    return { value: null, rejectionReasons: [...new Set(reasons)] };
  }
  return {
    value:
      medianExpectancy +
      medianSharpe -
      maximumDrawdown * policy.drawdownPenalty -
      averageTrainTestGap * policy.trainTestGapPenalty,
    rejectionReasons: [],
  };
};

export const optimizePurgedWalkForward = async <T extends WalkForwardObservation>(
  input: {
    readonly plan: PurgedWalkForwardPlan<T>;
    readonly parameterSpace: NumericParameterSpace;
    readonly evaluator: BacktestEvaluator<T>;
    readonly policy?: Partial<WalkForwardOptimizerPolicy>;
  },
): Promise<WalkForwardOptimizationResult> => {
  const policy: WalkForwardOptimizerPolicy = {
    ...DEFAULT_WALK_FORWARD_OPTIMIZER_POLICY,
    ...input.policy,
  };
  const parameterGrid = enumerateParameterGrid(
    input.parameterSpace,
    policy.maximumTrials,
  );
  const trials: OptimizationTrialResult[] = [];

  for (let trialIndex = 0; trialIndex < parameterGrid.length; trialIndex += 1) {
    const parameters = parameterGrid[trialIndex];
    if (parameters === undefined) {
      continue;
    }
    try {
      const folds: OptimizerFoldResult[] = [];
      for (const fold of input.plan.folds) {
        const train = await input.evaluator({
          parameters,
          observations: fold.train,
          phase: 'TRAIN',
          fold: fold.fold,
        });
        const test = await input.evaluator({
          parameters,
          observations: fold.test,
          phase: 'TEST',
          fold: fold.fold,
        });
        validateStatistics(train);
        validateStatistics(test);
        folds.push({ fold: fold.fold, train, test });
      }
      const objective = calculateObjective(folds, policy);
      trials.push({
        trialIndex,
        parameters,
        folds,
        objectiveValue: objective.value,
        status: objective.value === null ? 'REJECTED' : 'COMPLETED',
        rejectionReasons: objective.rejectionReasons,
      });
    } catch (error: unknown) {
      trials.push({
        trialIndex,
        parameters,
        folds: [],
        objectiveValue: null,
        status: 'FAILED',
        rejectionReasons: [
          error instanceof Error ? error.message : 'UNKNOWN_OPTIMIZER_FAILURE',
        ],
      });
    }
  }

  const selectedTrial =
    trials
      .filter(
        (trial): trial is OptimizationTrialResult & { objectiveValue: number } =>
          trial.status === 'COMPLETED' && trial.objectiveValue !== null,
      )
      .sort(
        (left, right) =>
          right.objectiveValue - left.objectiveValue ||
          left.trialIndex - right.trialIndex,
      )[0] ?? null;

  return {
    optimizer: 'DETERMINISTIC_GRID',
    trials,
    selectedTrial,
    holdoutEvaluated: false,
    liveExecutionAllowed: false,
  };
};

export const evaluateFrozenHoldout = async <T extends WalkForwardObservation>(
  input: {
    readonly plan: PurgedWalkForwardPlan<T>;
    readonly frozenParameters: NumericParameters;
    readonly evaluator: BacktestEvaluator<T>;
  },
): Promise<FrozenHoldoutResult> => {
  if (input.plan.holdout.length === 0) {
    throw new Error('untouched holdout is empty');
  }
  const metrics = await input.evaluator({
    parameters: input.frozenParameters,
    observations: input.plan.holdout,
    phase: 'HOLDOUT',
    fold: null,
  });
  validateStatistics(metrics);
  return {
    parameters: input.frozenParameters,
    metrics,
    holdoutEvaluated: true,
    liveExecutionAllowed: false,
  };
};
