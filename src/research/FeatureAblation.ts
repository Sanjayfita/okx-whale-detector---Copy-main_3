import {
  adjustHolmBonferroni,
  evaluatePairedSignificance,
} from './StatisticalSignificance';

export interface PairedStrategyOutcome {
  readonly episodeId: string;
  readonly baselineNetPnl: number;
  readonly candidateNetPnl: number;
}

export interface FeatureAblationPolicy {
  readonly bootstrapIterations: number;
  readonly randomizationIterations: number;
  readonly confidenceLevel: number;
  readonly minimumIndependentEpisodes: number;
  readonly minimumMeanImprovement: number;
  readonly minimumProbabilityOfImprovement: number;
  readonly familywiseAlpha: number;
  readonly seed: number;
}

export const DEFAULT_FEATURE_ABLATION_POLICY: FeatureAblationPolicy = {
  bootstrapIterations: 5_000,
  randomizationIterations: 5_000,
  confidenceLevel: 0.95,
  minimumIndependentEpisodes: 30,
  minimumMeanImprovement: 0,
  minimumProbabilityOfImprovement: 0.95,
  familywiseAlpha: 0.05,
  seed: 0x5f3759df,
};

export interface FeatureAblationDecision {
  readonly status: 'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE' | 'REJECTED';
  readonly independentEpisodeCount: number;
  readonly observedMeanImprovement: number;
  readonly standardizedEffect: number | null;
  readonly confidenceInterval: Readonly<{
    lower: number;
    upper: number;
    level: number;
  }> | null;
  readonly probabilityOfImprovement: number | null;
  readonly rawPValue: number | null;
  readonly adjustedPValue: number | null;
  readonly hypothesisFamilySize: number;
  readonly multiplicityMethod: 'HOLM_BONFERRONI';
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

export interface FeatureAblationHypothesis {
  readonly featureName: string;
  readonly outcomes: readonly PairedStrategyOutcome[];
}

export interface FeatureAblationFamilyDecision {
  readonly featureName: string;
  readonly decision: FeatureAblationDecision;
}

const validatePolicy = (policy: FeatureAblationPolicy): void => {
  if (
    !Number.isSafeInteger(policy.bootstrapIterations) ||
    policy.bootstrapIterations < 1_000 ||
    !Number.isSafeInteger(policy.randomizationIterations) ||
    policy.randomizationIterations < 1_000 ||
    !Number.isSafeInteger(policy.minimumIndependentEpisodes) ||
    policy.minimumIndependentEpisodes <= 0 ||
    !Number.isSafeInteger(policy.seed)
  ) {
    throw new Error('invalid feature ablation integer policy');
  }
  if (
    policy.confidenceLevel <= 0.5 ||
    policy.confidenceLevel >= 1 ||
    !Number.isFinite(policy.minimumMeanImprovement) ||
    policy.minimumProbabilityOfImprovement <= 0.5 ||
    policy.minimumProbabilityOfImprovement > 1 ||
    policy.familywiseAlpha <= 0 ||
    policy.familywiseAlpha >= 1
  ) {
    throw new Error('invalid feature ablation threshold policy');
  }
};

const aggregateOutcomes = (
  outcomes: readonly PairedStrategyOutcome[],
): readonly {
  readonly pairId: string;
  readonly baselineValue: number;
  readonly candidateValue: number;
}[] => {
  const byEpisode = new Map<
    string,
    { baselineValue: number; candidateValue: number }
  >();
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
    const current = byEpisode.get(outcome.episodeId) ?? {
      baselineValue: 0,
      candidateValue: 0,
    };
    current.baselineValue += outcome.baselineNetPnl;
    current.candidateValue += outcome.candidateNetPnl;
    byEpisode.set(outcome.episodeId, current);
  }
  return [...byEpisode.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pairId, values]) => ({ pairId, ...values }));
};

export const evaluateFeatureAblationFamily = (input: {
  readonly hypotheses: readonly FeatureAblationHypothesis[];
  readonly policy?: Partial<FeatureAblationPolicy>;
}): readonly FeatureAblationFamilyDecision[] => {
  const policy: FeatureAblationPolicy = {
    ...DEFAULT_FEATURE_ABLATION_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  if (input.hypotheses.length === 0) {
    throw new Error('feature ablation family requires hypotheses');
  }
  const names = new Set<string>();
  const preliminary = input.hypotheses.map((hypothesis, index) => {
    if (
      hypothesis.featureName.trim().length === 0 ||
      names.has(hypothesis.featureName)
    ) {
      throw new Error('feature ablation names must be unique and non-empty');
    }
    names.add(hypothesis.featureName);
    const significance = evaluatePairedSignificance({
      outcomes: aggregateOutcomes(hypothesis.outcomes),
      policy: {
        bootstrapIterations: policy.bootstrapIterations,
        randomizationIterations: policy.randomizationIterations,
        confidenceLevel: policy.confidenceLevel,
        minimumPairs: policy.minimumIndependentEpisodes,
        minimumMeanImprovement: policy.minimumMeanImprovement,
        seed: policy.seed + index,
      },
    });
    return { hypothesis, significance };
  });
  const adjusted = adjustHolmBonferroni({
    alpha: policy.familywiseAlpha,
    hypotheses: preliminary.map((item) => ({
      id: item.hypothesis.featureName,
      rawPValue: item.significance.randomizationPValue,
      value: item,
    })),
  });
  const adjustmentByName = new Map(
    adjusted.map((item) => [item.id, item] as const),
  );

  return preliminary.map(({ hypothesis, significance }) => {
    const adjustment = adjustmentByName.get(hypothesis.featureName);
    const rejectionReasons = [...significance.rejectionReasons];
    if (
      significance.probabilityOfImprovement !== null &&
      significance.probabilityOfImprovement <
        policy.minimumProbabilityOfImprovement
    ) {
      rejectionReasons.push('IMPROVEMENT_PROBABILITY_TOO_LOW');
    }
    if (!(adjustment?.rejectedAtAlpha ?? false)) {
      rejectionReasons.push('FAMILYWISE_SIGNIFICANCE_NOT_REACHED');
    }
    return {
      featureName: hypothesis.featureName,
      decision: {
        status:
          rejectionReasons.length === 0
            ? 'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE'
            : 'REJECTED',
        independentEpisodeCount: significance.pairCount,
        observedMeanImprovement: significance.meanDifference ?? 0,
        standardizedEffect: significance.standardizedEffect,
        confidenceInterval: significance.confidenceInterval,
        probabilityOfImprovement: significance.probabilityOfImprovement,
        rawPValue: significance.randomizationPValue,
        adjustedPValue: adjustment?.adjustedPValue ?? null,
        hypothesisFamilySize: input.hypotheses.length,
        multiplicityMethod: 'HOLM_BONFERRONI',
        rejectionReasons: [...new Set(rejectionReasons)],
        liveExecutionAllowed: false,
      },
    };
  });
};

export const evaluateFeatureAblation = (input: {
  readonly outcomes: readonly PairedStrategyOutcome[];
  readonly policy?: Partial<FeatureAblationPolicy>;
}): FeatureAblationDecision => {
  const result = evaluateFeatureAblationFamily({
    hypotheses: [{ featureName: 'single-feature', outcomes: input.outcomes }],
    policy: input.policy,
  })[0];
  if (result === undefined) {
    throw new Error('feature ablation failed to produce a decision');
  }
  return result.decision;
};
