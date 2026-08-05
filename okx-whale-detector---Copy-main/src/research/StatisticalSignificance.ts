export interface PairedOutcome {
  readonly pairId: string;
  readonly baselineValue: number;
  readonly candidateValue: number;
}

export interface PairedSignificancePolicy {
  readonly bootstrapIterations: number;
  readonly randomizationIterations: number;
  readonly confidenceLevel: number;
  readonly minimumPairs: number;
  readonly minimumMeanImprovement: number;
  readonly seed: number;
}

export const DEFAULT_PAIRED_SIGNIFICANCE_POLICY: PairedSignificancePolicy = {
  bootstrapIterations: 5_000,
  randomizationIterations: 5_000,
  confidenceLevel: 0.95,
  minimumPairs: 50,
  minimumMeanImprovement: 0,
  seed: 42,
};

export interface PairedSignificanceResult {
  readonly pairCount: number;
  readonly meanDifference: number | null;
  readonly medianDifference: number | null;
  readonly positivePairFraction: number | null;
  readonly standardizedEffect: number | null;
  readonly confidenceInterval: Readonly<{
    lower: number;
    upper: number;
    level: number;
  }> | null;
  readonly probabilityOfImprovement: number | null;
  readonly randomizationPValue: number | null;
  readonly status: 'PASSED' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
}

export interface MultipleTestingResult<T> {
  readonly id: string;
  readonly value: T;
  readonly rawPValue: number | null;
  readonly adjustedPValue: number | null;
  readonly rejectedAtAlpha: boolean;
}

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x9e3779b9;
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: readonly number[]): number => {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1
    ? upper
    : ((sorted[middle - 1] ?? upper) + upper) / 2;
};

const sampleStandardDeviation = (values: readonly number[]): number | null => {
  if (values.length < 2) {
    return null;
  }
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return variance > 0 ? Math.sqrt(variance) : null;
};

const quantile = (values: readonly number[], probability: number): number => {
  const sorted = values.slice().sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
};

const validatePolicy = (policy: PairedSignificancePolicy): void => {
  if (
    !Number.isSafeInteger(policy.bootstrapIterations) ||
    policy.bootstrapIterations < 1_000 ||
    !Number.isSafeInteger(policy.randomizationIterations) ||
    policy.randomizationIterations < 1_000 ||
    !Number.isSafeInteger(policy.minimumPairs) ||
    policy.minimumPairs <= 0 ||
    !Number.isSafeInteger(policy.seed)
  ) {
    throw new Error('invalid paired significance integer policy');
  }
  if (
    !Number.isFinite(policy.confidenceLevel) ||
    policy.confidenceLevel <= 0.5 ||
    policy.confidenceLevel >= 1 ||
    !Number.isFinite(policy.minimumMeanImprovement)
  ) {
    throw new Error('invalid paired significance threshold policy');
  }
};

const differences = (outcomes: readonly PairedOutcome[]): readonly number[] => {
  const ids = new Set<string>();
  return outcomes.map((outcome) => {
    if (outcome.pairId.trim().length === 0) {
      throw new Error('pairId must not be empty');
    }
    if (ids.has(outcome.pairId)) {
      throw new Error(`duplicate pairId ${outcome.pairId}`);
    }
    ids.add(outcome.pairId);
    if (
      !Number.isFinite(outcome.baselineValue) ||
      !Number.isFinite(outcome.candidateValue)
    ) {
      throw new Error(`non-finite paired value for ${outcome.pairId}`);
    }
    return outcome.candidateValue - outcome.baselineValue;
  });
};

export const evaluatePairedSignificance = (input: {
  readonly outcomes: readonly PairedOutcome[];
  readonly policy?: Partial<PairedSignificancePolicy>;
}): PairedSignificanceResult => {
  const policy: PairedSignificancePolicy = {
    ...DEFAULT_PAIRED_SIGNIFICANCE_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  const values = differences(input.outcomes);
  if (values.length < policy.minimumPairs) {
    return {
      pairCount: values.length,
      meanDifference: values.length === 0 ? null : mean(values),
      medianDifference: values.length === 0 ? null : median(values),
      positivePairFraction:
        values.length === 0
          ? null
          : values.filter((value) => value > policy.minimumMeanImprovement).length /
            values.length,
      standardizedEffect: null,
      confidenceInterval: null,
      probabilityOfImprovement: null,
      randomizationPValue: null,
      status: 'REJECTED',
      rejectionReasons: ['INSUFFICIENT_INDEPENDENT_PAIRS'],
    };
  }

  const observedMean = mean(values);
  const deviation = sampleStandardDeviation(values);
  const random = createRandom(policy.seed);
  const bootstrapMeans: number[] = [];
  let improvementCount = 0;
  for (let iteration = 0; iteration < policy.bootstrapIterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)] ?? 0;
    }
    const bootstrapMean = sum / values.length;
    bootstrapMeans.push(bootstrapMean);
    if (bootstrapMean > policy.minimumMeanImprovement) {
      improvementCount += 1;
    }
  }

  let atLeastObservedCount = 0;
  for (
    let iteration = 0;
    iteration < policy.randomizationIterations;
    iteration += 1
  ) {
    let randomizedSum = 0;
    for (const value of values) {
      randomizedSum += (random() < 0.5 ? -1 : 1) * value;
    }
    if (randomizedSum / values.length >= observedMean) {
      atLeastObservedCount += 1;
    }
  }

  const alpha = 1 - policy.confidenceLevel;
  const lower = quantile(bootstrapMeans, alpha / 2);
  const upper = quantile(bootstrapMeans, 1 - alpha / 2);
  const probabilityOfImprovement =
    improvementCount / policy.bootstrapIterations;
  const randomizationPValue =
    (atLeastObservedCount + 1) / (policy.randomizationIterations + 1);
  const rejectionReasons: string[] = [];
  if (observedMean <= policy.minimumMeanImprovement) {
    rejectionReasons.push('MEAN_IMPROVEMENT_NOT_POSITIVE');
  }
  if (lower <= policy.minimumMeanImprovement) {
    rejectionReasons.push('CONFIDENCE_INTERVAL_INCLUDES_NO_IMPROVEMENT');
  }
  if (randomizationPValue > alpha) {
    rejectionReasons.push('RANDOMIZATION_TEST_NOT_SIGNIFICANT');
  }

  return {
    pairCount: values.length,
    meanDifference: observedMean,
    medianDifference: median(values),
    positivePairFraction:
      values.filter((value) => value > policy.minimumMeanImprovement).length /
      values.length,
    standardizedEffect:
      deviation === null ? null : observedMean / deviation,
    confidenceInterval: { lower, upper, level: policy.confidenceLevel },
    probabilityOfImprovement,
    randomizationPValue,
    status: rejectionReasons.length === 0 ? 'PASSED' : 'REJECTED',
    rejectionReasons,
  };
};

export const adjustHolmBonferroni = <T>(input: {
  readonly hypotheses: readonly {
    readonly id: string;
    readonly rawPValue: number | null;
    readonly value: T;
  }[];
  readonly alpha: number;
}): readonly MultipleTestingResult<T>[] => {
  if (!Number.isFinite(input.alpha) || input.alpha <= 0 || input.alpha >= 1) {
    throw new Error('alpha must be in (0, 1)');
  }
  const ids = new Set<string>();
  for (const hypothesis of input.hypotheses) {
    if (hypothesis.id.trim().length === 0 || ids.has(hypothesis.id)) {
      throw new Error('multiple-testing hypothesis ids must be unique and non-empty');
    }
    ids.add(hypothesis.id);
    if (
      hypothesis.rawPValue !== null &&
      (!Number.isFinite(hypothesis.rawPValue) ||
        hypothesis.rawPValue < 0 ||
        hypothesis.rawPValue > 1)
    ) {
      throw new Error(`invalid p-value for ${hypothesis.id}`);
    }
  }

  const testable = input.hypotheses
    .filter(
      (hypothesis): hypothesis is typeof hypothesis & { rawPValue: number } =>
        hypothesis.rawPValue !== null,
    )
    .slice()
    .sort(
      (left, right) =>
        left.rawPValue - right.rawPValue || left.id.localeCompare(right.id),
    );
  const adjusted = new Map<string, number>();
  let runningMaximum = 0;
  for (let index = 0; index < testable.length; index += 1) {
    const hypothesis = testable[index];
    if (hypothesis === undefined) {
      continue;
    }
    const multiplier = testable.length - index;
    runningMaximum = Math.max(
      runningMaximum,
      Math.min(1, hypothesis.rawPValue * multiplier),
    );
    adjusted.set(hypothesis.id, runningMaximum);
  }

  return input.hypotheses.map((hypothesis) => {
    const adjustedPValue = adjusted.get(hypothesis.id) ?? null;
    return {
      id: hypothesis.id,
      value: hypothesis.value,
      rawPValue: hypothesis.rawPValue,
      adjustedPValue,
      rejectedAtAlpha:
        adjustedPValue !== null && adjustedPValue <= input.alpha,
    };
  });
};
