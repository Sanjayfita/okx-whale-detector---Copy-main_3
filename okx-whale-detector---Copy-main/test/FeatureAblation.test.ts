import { describe, expect, it } from 'vitest';

import {
  evaluateFeatureAblation,
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

describe('evaluateFeatureAblation', () => {
  it('justifies a feature only when the paired confidence interval is positive', () => {
    const decision = evaluateFeatureAblation({
      outcomes: outcomes((index) => 1 + (index % 3) * 0.1),
      policy: {
        bootstrapIterations: 1_000,
        confidenceLevel: 0.95,
        minimumIndependentEpisodes: 30,
        minimumMeanImprovement: 0,
        minimumProbabilityOfImprovement: 0.95,
        seed: 42,
      },
    });

    expect(decision.status).toBe(
      'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE',
    );
    expect(decision.confidenceInterval?.lower).toBeGreaterThan(0);
    expect(decision.probabilityOfImprovement).toBe(1);
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('rejects noisy or negative incremental performance', () => {
    const decision = evaluateFeatureAblation({
      outcomes: outcomes((index) => (index % 2 === 0 ? 1 : -1.2)),
      policy: {
        bootstrapIterations: 1_000,
        confidenceLevel: 0.95,
        minimumIndependentEpisodes: 30,
        minimumMeanImprovement: 0,
        minimumProbabilityOfImprovement: 0.95,
        seed: 42,
      },
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

    const decision = evaluateFeatureAblation({
      outcomes: repeated,
      policy: {
        bootstrapIterations: 1_000,
        confidenceLevel: 0.95,
        minimumIndependentEpisodes: 30,
        minimumMeanImprovement: 0,
        minimumProbabilityOfImprovement: 0.95,
        seed: 42,
      },
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.independentEpisodeCount).toBe(20);
    expect(decision.rejectionReasons).toEqual([
      'INSUFFICIENT_INDEPENDENT_EPISODES',
    ]);
  });
});
