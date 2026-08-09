import { describe, expect, it } from 'vitest';

import {
  evaluateFeatureAblation,
  evaluateFeatureAblationFamily,
  type PairedStrategyOutcome,
} from '../src/research/FeatureAblation';

const outcomes = (
  difference: (index: number) => number,
): PairedStrategyOutcome[] =>
  Array.from({ length: 40 }, (_, index) => ({
    episodeId: `episode-${index}`,
    baselineNetPnl: 0,
    candidateNetPnl: difference(index),
  }));

const policy = {
  bootstrapIterations: 1_000,
  randomizationIterations: 1_000,
  confidenceLevel: 0.95,
  minimumIndependentEpisodes: 30,
  minimumMeanImprovement: 0,
  minimumProbabilityOfImprovement: 0.95,
  familywiseAlpha: 0.05,
  seed: 42,
};

describe('evaluateFeatureAblation', () => {
  it('justifies a feature only with positive and significant paired evidence', () => {
    const decision = evaluateFeatureAblation({
      outcomes: outcomes((index) => 1 + (index % 3) * 0.1),
      policy,
    });

    expect(decision.status).toBe(
      'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE',
    );
    expect(decision.confidenceInterval?.lower).toBeGreaterThan(0);
    expect(decision.probabilityOfImprovement).toBe(1);
    expect(decision.adjustedPValue).toBeLessThanOrEqual(0.05);
    expect(decision.multiplicityMethod).toBe('HOLM_BONFERRONI');
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('rejects noisy or negative incremental performance', () => {
    const decision = evaluateFeatureAblation({
      outcomes: outcomes((index) => (index % 2 === 0 ? 1 : -1.2)),
      policy,
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.rejectionReasons).toContain(
      'MEAN_IMPROVEMENT_NOT_POSITIVE',
    );
  });

  it('aggregates repeated alerts into independent episode units', () => {
    const repeated = Array.from({ length: 20 }, (_, index) => [
      {
        episodeId: `episode-${index}`,
        baselineNetPnl: 0,
        candidateNetPnl: 0.5,
      },
      {
        episodeId: `episode-${index}`,
        baselineNetPnl: 0,
        candidateNetPnl: 0.5,
      },
    ]).flat();

    const decision = evaluateFeatureAblation({ outcomes: repeated, policy });

    expect(decision.status).toBe('REJECTED');
    expect(decision.independentEpisodeCount).toBe(20);
    expect(decision.rejectionReasons).toContain(
      'INSUFFICIENT_INDEPENDENT_PAIRS',
    );
  });

  it('adjusts significance across the full feature family', () => {
    const decisions = evaluateFeatureAblationFamily({
      policy,
      hypotheses: [
        {
          featureName: 'strong',
          outcomes: outcomes(() => 1),
        },
        {
          featureName: 'noise',
          outcomes: outcomes((index) => (index % 2 === 0 ? 1 : -1)),
        },
      ],
    });

    expect(decisions).toHaveLength(2);
    expect(decisions[0]?.decision.hypothesisFamilySize).toBe(2);
    expect(decisions[0]?.decision.adjustedPValue ?? 0).toBeGreaterThanOrEqual(
      decisions[0]?.decision.rawPValue ?? 0,
    );
  });
});
