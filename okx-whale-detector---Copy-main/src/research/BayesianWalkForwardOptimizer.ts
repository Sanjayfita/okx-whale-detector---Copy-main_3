export type BayesianParameterSpace = Readonly<Record<string, readonly number[]>>;
export type BayesianParameters = Readonly<Record<string, number>>;

export interface BayesianDiscoveryEvaluation {
  readonly scope: 'PURGED_DISCOVERY';
  readonly datasetFingerprint: string;
  readonly foldObjectives: readonly number[];
  readonly foldTradeCounts: readonly number[];
  readonly foldDrawdownFractions: readonly number[];
  readonly holdoutAccessed: false;
}

export type BayesianDiscoveryEvaluator = (input: {
  readonly trialIndex: number;
  readonly parameters: BayesianParameters;
  readonly scope: 'PURGED_DISCOVERY';
}) => Promise<BayesianDiscoveryEvaluation> | BayesianDiscoveryEvaluation;

export interface BayesianOptimizerPolicy {
  readonly maximumTrials: number;
  readonly initialExplorationTrials: number;
  readonly explorationWeight: number;
  readonly minimumFoldCount: number;
  readonly minimumTradesPerFold: number;
  readonly minimumPositiveFoldFraction: number;
  readonly maximumFoldObjectiveStandardDeviation: number;
  readonly maximumFoldDrawdownFraction: number;
  readonly minimumStableNeighborFraction: number;
  readonly maximumNeighborObjectiveDegradationFraction: number;
  readonly seed: number;
}

export const DEFAULT_BAYESIAN_OPTIMIZER_POLICY: BayesianOptimizerPolicy = {
  maximumTrials: 50,
  initialExplorationTrials: 8,
  explorationWeight: 0.25,
  minimumFoldCount: 3,
  minimumTradesPerFold: 20,
  minimumPositiveFoldFraction: 0.6,
  maximumFoldObjectiveStandardDeviation: 2,
  maximumFoldDrawdownFraction: 0.25,
  minimumStableNeighborFraction: 0.5,
  maximumNeighborObjectiveDegradationFraction: 0.25,
  seed: 42,
};

export interface BayesianOptimizationTrial {
  readonly trialIndex: number;
  readonly parameters: BayesianParameters;
  readonly status: 'COMPLETED' | 'REJECTED' | 'FAILED';
  readonly objectiveValue: number | null;
  readonly predictedMean: number | null;
  readonly predictedUncertainty: number | null;
  readonly acquisitionValue: number | null;
  readonly evaluation: BayesianDiscoveryEvaluation | null;
  readonly rejectionReasons: readonly string[];
}

export interface BayesianOptimizationResult {
  readonly optimizer: 'SEQUENTIAL_DISTANCE_SURROGATE';
  readonly datasetFingerprint: string | null;
  readonly trials: readonly BayesianOptimizationTrial[];
  readonly selectedTrial: BayesianOptimizationTrial | null;
  readonly stableNeighborFraction: number;
  readonly status: 'COMPLETED' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
  readonly holdoutEvaluated: false;
  readonly liveExecutionAllowed: false;
}

const median = (values: readonly number[]): number => {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1
    ? upper
    : ((sorted[middle - 1] ?? upper) + upper) / 2;
};

const standardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) {
    return 0;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      (values.length - 1),
  );
};

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const shuffle = <T>(values: readonly T[], random: () => number): T[] => {
  const output = values.slice();
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = output[index];
    const swap = output[swapIndex];
    if (current !== undefined && swap !== undefined) {
      output[index] = swap;
      output[swapIndex] = current;
    }
  }
  return output;
};

const enumerateSpace = (space: BayesianParameterSpace): BayesianParameters[] => {
  const entries = Object.entries(space).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) {
    throw new Error('Bayesian parameter space must not be empty');
  }
  let candidates: BayesianParameters[] = [{}];
  for (const [name, rawValues] of entries) {
    const values = [...new Set(rawValues)].sort((left, right) => left - right);
    if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`invalid Bayesian parameter dimension ${name}`);
    }
    candidates = candidates.flatMap((candidate) =>
      values.map((value) => ({ ...candidate, [name]: value })),
    );
  }
  return candidates;
};

const parameterKey = (parameters: BayesianParameters): string =>
  Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('|');

const normalizedDistance = (input: {
  readonly left: BayesianParameters;
  readonly right: BayesianParameters;
  readonly space: BayesianParameterSpace;
}): number => {
  const names = Object.keys(input.space).sort();
  if (names.length === 0) {
    return 0;
  }
  return Math.sqrt(
    names.reduce((sum, name) => {
      const values = input.space[name];
      if (values === undefined) {
        return sum;
      }
      const sorted = [...new Set(values)].sort((left, right) => left - right);
      const denominator = Math.max(1, sorted.length - 1);
      const leftIndex = sorted.indexOf(input.left[name] ?? Number.NaN);
      const rightIndex = sorted.indexOf(input.right[name] ?? Number.NaN);
      if (leftIndex < 0 || rightIndex < 0) {
        throw new Error(`parameter ${name} is outside the frozen search space`);
      }
      return sum + ((leftIndex - rightIndex) / denominator) ** 2;
    }, 0) / names.length,
  );
};

const surrogate = (input: {
  readonly candidate: BayesianParameters;
  readonly completed: readonly BayesianOptimizationTrial[];
  readonly space: BayesianParameterSpace;
  readonly explorationWeight: number;
}): Readonly<{
  predictedMean: number;
  predictedUncertainty: number;
  acquisitionValue: number;
}> => {
  const neighbors = input.completed.flatMap((trial) =>
    trial.objectiveValue === null
      ? []
      : [
          {
            value: trial.objectiveValue,
            distance: normalizedDistance({
              left: input.candidate,
              right: trial.parameters,
              space: input.space,
            }),
          },
        ],
  );
  if (neighbors.length === 0) {
    return {
      predictedMean: 0,
      predictedUncertainty: 1,
      acquisitionValue: input.explorationWeight,
    };
  }
  let weightedSum = 0;
  let weightTotal = 0;
  for (const neighbor of neighbors) {
    const weight = Math.exp(-4 * neighbor.distance);
    weightedSum += neighbor.value * weight;
    weightTotal += weight;
  }
  const predictedMean = weightTotal === 0 ? 0 : weightedSum / weightTotal;
  const nearestDistance = Math.min(...neighbors.map((neighbor) => neighbor.distance));
  const predictedUncertainty = Math.min(1, nearestDistance);
  return {
    predictedMean,
    predictedUncertainty,
    acquisitionValue:
      predictedMean + input.explorationWeight * predictedUncertainty,
  };
};

const validateEvaluation = (input: {
  readonly evaluation: BayesianDiscoveryEvaluation;
  readonly expectedFingerprint: string | null;
  readonly policy: BayesianOptimizerPolicy;
}): Readonly<{ objective: number | null; reasons: readonly string[] }> => {
  const reasons: string[] = [];
  if (input.evaluation.scope !== 'PURGED_DISCOVERY') {
    reasons.push('INVALID_EVALUATION_SCOPE');
  }
  if (input.evaluation.holdoutAccessed !== false) {
    reasons.push('HOLDOUT_ACCESS_DURING_OPTIMIZATION');
  }
  if (input.evaluation.datasetFingerprint.trim().length === 0) {
    reasons.push('DATASET_FINGERPRINT_REQUIRED');
  }
  if (
    input.expectedFingerprint !== null &&
    input.evaluation.datasetFingerprint !== input.expectedFingerprint
  ) {
    reasons.push('DATASET_FINGERPRINT_CHANGED');
  }
  const foldCount = input.evaluation.foldObjectives.length;
  if (
    foldCount < input.policy.minimumFoldCount ||
    input.evaluation.foldTradeCounts.length !== foldCount ||
    input.evaluation.foldDrawdownFractions.length !== foldCount
  ) {
    reasons.push('INCOMPLETE_PURGED_FOLDS');
  }
  if (
    input.evaluation.foldObjectives.some((value) => !Number.isFinite(value)) ||
    input.evaluation.foldDrawdownFractions.some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  ) {
    reasons.push('NON_FINITE_FOLD_RESULT');
  }
  if (
    input.evaluation.foldTradeCounts.some(
      (count) =>
        !Number.isSafeInteger(count) ||
        count < input.policy.minimumTradesPerFold,
    )
  ) {
    reasons.push('INSUFFICIENT_TRADES_PER_FOLD');
  }
  const positiveFraction =
    foldCount === 0
      ? 0
      : input.evaluation.foldObjectives.filter((value) => value > 0).length /
        foldCount;
  if (positiveFraction < input.policy.minimumPositiveFoldFraction) {
    reasons.push('UNSTABLE_POSITIVE_FOLD_COVERAGE');
  }
  const foldDeviation = standardDeviation(input.evaluation.foldObjectives);
  if (foldDeviation > input.policy.maximumFoldObjectiveStandardDeviation) {
    reasons.push('FOLD_OBJECTIVE_INSTABILITY');
  }
  const maximumDrawdown = Math.max(
    0,
    ...input.evaluation.foldDrawdownFractions,
  );
  if (maximumDrawdown > input.policy.maximumFoldDrawdownFraction) {
    reasons.push('FOLD_DRAWDOWN_LIMIT_EXCEEDED');
  }
  if (reasons.length > 0) {
    return { objective: null, reasons: [...new Set(reasons)] };
  }
  return {
    objective:
      median(input.evaluation.foldObjectives) -
      foldDeviation * 0.25 -
      maximumDrawdown,
    reasons: [],
  };
};

const neighborFraction = (input: {
  readonly selected: BayesianOptimizationTrial;
  readonly trials: readonly BayesianOptimizationTrial[];
  readonly space: BayesianParameterSpace;
  readonly maximumDegradationFraction: number;
}): number => {
  if (input.selected.objectiveValue === null) {
    return 0;
  }
  const neighbors = input.trials.filter((trial) => {
    if (trial.objectiveValue === null || trial.trialIndex === input.selected.trialIndex) {
      return false;
    }
    const distance = normalizedDistance({
      left: input.selected.parameters,
      right: trial.parameters,
      space: input.space,
    });
    const dimensionCount = Math.max(1, Object.keys(input.space).length);
    return distance <= Math.sqrt(1 / dimensionCount) + 1e-12;
  });
  if (neighbors.length === 0) {
    return 0;
  }
  const threshold =
    input.selected.objectiveValue -
    Math.abs(input.selected.objectiveValue) * input.maximumDegradationFraction;
  return (
    neighbors.filter(
      (trial) => (trial.objectiveValue ?? Number.NEGATIVE_INFINITY) >= threshold,
    ).length / neighbors.length
  );
};

export const optimizeBayesianWalkForward = async (input: {
  readonly parameterSpace: BayesianParameterSpace;
  readonly evaluator: BayesianDiscoveryEvaluator;
  readonly policy?: BayesianOptimizerPolicy;
}): Promise<BayesianOptimizationResult> => {
  const policy = input.policy ?? DEFAULT_BAYESIAN_OPTIMIZER_POLICY;
  if (
    !Number.isSafeInteger(policy.maximumTrials) ||
    policy.maximumTrials <= 0 ||
    !Number.isSafeInteger(policy.initialExplorationTrials) ||
    policy.initialExplorationTrials <= 0 ||
    policy.explorationWeight < 0
  ) {
    throw new Error('invalid Bayesian optimizer policy');
  }
  const candidates = enumerateSpace(input.parameterSpace);
  const random = createRandom(policy.seed);
  const initialOrder = shuffle(candidates, random);
  const trials: BayesianOptimizationTrial[] = [];
  const tested = new Set<string>();
  let datasetFingerprint: string | null = null;
  const maximumTrials = Math.min(policy.maximumTrials, candidates.length);

  for (let trialIndex = 0; trialIndex < maximumTrials; trialIndex += 1) {
    const completed = trials.filter((trial) => trial.status === 'COMPLETED');
    let parameters: BayesianParameters | undefined;
    let prediction: ReturnType<typeof surrogate> | null = null;
    if (trialIndex < policy.initialExplorationTrials) {
      parameters = initialOrder.find(
        (candidate) => !tested.has(parameterKey(candidate)),
      );
    } else {
      const ranked = candidates
        .filter((candidate) => !tested.has(parameterKey(candidate)))
        .map((candidate) => ({
          candidate,
          prediction: surrogate({
            candidate,
            completed,
            space: input.parameterSpace,
            explorationWeight: policy.explorationWeight,
          }),
        }))
        .sort(
          (left, right) =>
            right.prediction.acquisitionValue -
              left.prediction.acquisitionValue ||
            parameterKey(left.candidate).localeCompare(parameterKey(right.candidate)),
        );
      parameters = ranked[0]?.candidate;
      prediction = ranked[0]?.prediction ?? null;
    }
    if (parameters === undefined) {
      break;
    }
    tested.add(parameterKey(parameters));

    try {
      const evaluation = await input.evaluator({
        trialIndex,
        parameters,
        scope: 'PURGED_DISCOVERY',
      });
      const validation = validateEvaluation({
        evaluation,
        expectedFingerprint: datasetFingerprint,
        policy,
      });
      datasetFingerprint ??= evaluation.datasetFingerprint;
      trials.push({
        trialIndex,
        parameters,
        status: validation.objective === null ? 'REJECTED' : 'COMPLETED',
        objectiveValue: validation.objective,
        predictedMean: prediction?.predictedMean ?? null,
        predictedUncertainty: prediction?.predictedUncertainty ?? null,
        acquisitionValue: prediction?.acquisitionValue ?? null,
        evaluation,
        rejectionReasons: validation.reasons,
      });
    } catch (error: unknown) {
      trials.push({
        trialIndex,
        parameters,
        status: 'FAILED',
        objectiveValue: null,
        predictedMean: prediction?.predictedMean ?? null,
        predictedUncertainty: prediction?.predictedUncertainty ?? null,
        acquisitionValue: prediction?.acquisitionValue ?? null,
        evaluation: null,
        rejectionReasons: [
          error instanceof Error ? error.message : 'UNKNOWN_OPTIMIZER_FAILURE',
        ],
      });
    }
  }

  const best = trials
    .filter(
      (trial): trial is BayesianOptimizationTrial & { objectiveValue: number } =>
        trial.status === 'COMPLETED' && trial.objectiveValue !== null,
    )
    .sort(
      (left, right) =>
        right.objectiveValue - left.objectiveValue ||
        left.trialIndex - right.trialIndex,
    )[0] ?? null;
  const stableNeighborFraction =
    best === null
      ? 0
      : neighborFraction({
          selected: best,
          trials,
          space: input.parameterSpace,
          maximumDegradationFraction:
            policy.maximumNeighborObjectiveDegradationFraction,
        });
  const rejectionReasons: string[] = [];
  if (best === null) {
    rejectionReasons.push('NO_VALID_BAYESIAN_TRIAL');
  }
  if (best !== null && stableNeighborFraction < policy.minimumStableNeighborFraction) {
    rejectionReasons.push('UNSTABLE_PARAMETER_NEIGHBORHOOD');
  }

  return {
    optimizer: 'SEQUENTIAL_DISTANCE_SURROGATE',
    datasetFingerprint,
    trials,
    selectedTrial: rejectionReasons.length === 0 ? best : null,
    stableNeighborFraction,
    status: rejectionReasons.length === 0 ? 'COMPLETED' : 'REJECTED',
    rejectionReasons,
    holdoutEvaluated: false,
    liveExecutionAllowed: false,
  };
};
