export interface PairedStrategyOutcome {
  readonly episodeId: string;
  readonly baselineNetPnl: number;
  readonly candidateNetPnl: number;
}

export interface FeatureAblationPolicy {
  readonly bootstrapIterations: number;
  readonly confidenceLevel: number;
  readonly minimumIndependentEpisodes: number;
  readonly minimumMeanImprovement: number;
  readonly minimumProbabilityOfImprovement: number;
  readonly seed: number;
}

export const DEFAULT_FEATURE_ABLATION_POLICY: FeatureAblationPolicy = {
  bootstrapIterations: 5_000,
  confidenceLevel: 0.95,
  minimumIndependentEpisodes: 30,
  minimumMeanImprovement: 0,
  minimumProbabilityOfImprovement: 0.95,
  seed: 0x5f3759df,
};

export interface FeatureAblationDecision {
  readonly status: 'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE' | 'REJECTED';
  readonly independentEpisodeCount: number;
  readonly observedMeanImprovement: number;
  readonly confidenceInterval: Readonly<{
    lower: number;
    upper: number;
    level: number;
  }> | null;
  readonly probabilityOfImprovement: number | null;
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const createSeededRandom = (initialSeed: number): (() => number) => {
  let state = initialSeed >>> 0;
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

const percentile = (sorted: readonly number[], probability: number): number => {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(probability * (sorted.length - 1))),
  );
  return sorted[index] ?? 0;
};

const aggregateEpisodeDifferences = (
  outcomes: readonly PairedStrategyOutcome[],
): readonly number[] => {
  const byEpisode = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.episodeId.trim().length === 0) {
      throw new Error('episodeId must not be empty');
    }
    if (
      !Number.isFinite(outcome.baselineNetPnl) ||
      !Number.isFinite(outcome.candidateNetPnl)
    ) {
      throw new Error(`non-finite PnL for episode ${outcome.episodeId}`);
    }
    byEpisode.set(
      outcome.episodeId,
      (byEpisode.get(outcome.episodeId) ?? 0) +
        outcome.candidateNetPnl -
        outcome.baselineNetPnl,
    );
  }
  return [...byEpisode.values()];
};

const validatePolicy = (policy: FeatureAblationPolicy): void => {
  if (
    !Number.isSafeInteger(policy.bootstrapIterations) ||
    policy.bootstrapIterations < 1_000
  ) {
    throw new Error('bootstrapIterations must be a safe integer >= 1000');
  }
  if (
    !Number.isFinite(policy.confidenceLevel) ||
    policy.confidenceLevel <= 0.5 ||
    policy.confidenceLevel >= 1
  ) {
    throw new Error('confidenceLevel must be in (0.5, 1)');
  }
  if (
    !Number.isSafeInteger(policy.minimumIndependentEpisodes) ||
    policy.minimumIndependentEpisodes <= 0
  ) {
    throw new Error('minimumIndependentEpisodes must be positive');
  }
  if (!Number.isFinite(policy.minimumMeanImprovement)) {
    throw new Error('minimumMeanImprovement must be finite');
  }
  if (
    !Number.isFinite(policy.minimumProbabilityOfImprovement) ||
    policy.minimumProbabilityOfImprovement <= 0.5 ||
    policy.minimumProbabilityOfImprovement > 1
  ) {
    throw new Error('minimumProbabilityOfImprovement must be in (0.5, 1]');
  }
  if (!Number.isSafeInteger(policy.seed)) {
    throw new Error('seed must be a safe integer');
  }
};

export const evaluateFeatureAblation = (input: {
  readonly outcomes: readonly PairedStrategyOutcome[];
  readonly policy?: FeatureAblationPolicy;
}): FeatureAblationDecision => {
  const policy = input.policy ?? DEFAULT_FEATURE_ABLATION_POLICY;
  validatePolicy(policy);
  const differences = aggregateEpisodeDifferences(input.outcomes);
  const observedMeanImprovement =
    differences.length === 0 ? 0 : mean(differences);

  if (differences.length < policy.minimumIndependentEpisodes) {
    return {
      status: 'REJECTED',
      independentEpisodeCount: differences.length,
      observedMeanImprovement,
      confidenceInterval: null,
      probabilityOfImprovement: null,
      rejectionReasons: ['INSUFFICIENT_INDEPENDENT_EPISODES'],
      liveExecutionAllowed: false,
    };
  }

  const random = createSeededRandom(policy.seed);
  const bootstrapMeans: number[] = [];
  let improvementCount = 0;
  for (let iteration = 0; iteration < policy.bootstrapIterations; iteration += 1) {
    let sum = 0;
    for (let sample = 0; sample < differences.length; sample += 1) {
      const index = Math.floor(random() * differences.length);
      sum += differences[index] ?? 0;
    }
    const bootstrapMean = sum / differences.length;
    bootstrapMeans.push(bootstrapMean);
    if (bootstrapMean > policy.minimumMeanImprovement) {
      improvementCount += 1;
    }
  }
  bootstrapMeans.sort((left, right) => left - right);

  const tail = (1 - policy.confidenceLevel) / 2;
  const lower = percentile(bootstrapMeans, tail);
  const upper = percentile(bootstrapMeans, 1 - tail);
  const probabilityOfImprovement =
    improvementCount / policy.bootstrapIterations;
  const rejectionReasons: string[] = [];

  if (observedMeanImprovement <= policy.minimumMeanImprovement) {
    rejectionReasons.push('MEAN_IMPROVEMENT_NOT_POSITIVE');
  }
  if (lower <= policy.minimumMeanImprovement) {
    rejectionReasons.push('CONFIDENCE_INTERVAL_INCLUDES_NO_IMPROVEMENT');
  }
  if (
    probabilityOfImprovement < policy.minimumProbabilityOfImprovement
  ) {
    rejectionReasons.push('IMPROVEMENT_PROBABILITY_TOO_LOW');
  }

  return {
    status:
      rejectionReasons.length === 0
        ? 'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE'
        : 'REJECTED',
    independentEpisodeCount: differences.length,
    observedMeanImprovement,
    confidenceInterval: {
      lower,
      upper,
      level: policy.confidenceLevel,
    },
    probabilityOfImprovement,
    rejectionReasons,
    liveExecutionAllowed: false,
  };
};
