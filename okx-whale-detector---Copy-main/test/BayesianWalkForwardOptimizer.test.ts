import { describe, expect, it } from 'vitest';

import {
  optimizeBayesianWalkForward,
  type BayesianDiscoveryEvaluation,
} from '../src/research/BayesianWalkForwardOptimizer';

const policy = {
  maximumTrials: 6,
  initialExplorationTrials: 2,
  explorationWeight: 0.25,
  minimumFoldCount: 3,
  minimumTradesPerFold: 20,
  minimumPositiveFoldFraction: 0.6,
  maximumFoldObjectiveStandardDeviation: 2,
  maximumFoldDrawdownFraction: 0.25,
  minimumStableNeighborFraction: 0.5,
  maximumNeighborObjectiveDegradationFraction: 0.25,
  seed: 42,
} as const;

describe('optimizeBayesianWalkForward', () => {
  it('selects parameters reproducibly using purged discovery only', async () => {
    const scopes: string[] = [];
    const execute = () =>
      optimizeBayesianWalkForward({
        parameterSpace: {
          atrMultiplier: [1, 2, 3],
          deltaThreshold: [0.1, 0.2],
        },
        policy,
        evaluator: ({ parameters, scope }) => {
          scopes.push(scope);
          const score =
            2 -
            Math.abs((parameters.atrMultiplier ?? 0) - 2) * 0.1 -
            Math.abs((parameters.deltaThreshold ?? 0) - 0.1) * 0.5;
          return {
            scope,
            datasetFingerprint: 'discovery-dataset',
            foldObjectives: [score - 0.05, score, score + 0.05],
            foldTradeCounts: [30, 35, 40],
            foldDrawdownFractions: [0.08, 0.1, 0.09],
            holdoutAccessed: false,
          };
        },
      });

    const first = await execute();
    const second = await execute();

    expect(first).toEqual(second);
    expect(first.status).toBe('COMPLETED');
    expect(first.selectedTrial?.parameters).toEqual({
      atrMultiplier: 2,
      deltaThreshold: 0.1,
    });
    expect(first.stableNeighborFraction).toBeGreaterThanOrEqual(0.5);
    expect(scopes.every((scope) => scope === 'PURGED_DISCOVERY')).toBe(true);
    expect(first.holdoutEvaluated).toBe(false);
    expect(first.liveExecutionAllowed).toBe(false);
  });

  it('rejects an evaluator that reports holdout access', async () => {
    const result = await optimizeBayesianWalkForward({
      parameterSpace: { atrMultiplier: [1, 2] },
      policy: { ...policy, maximumTrials: 2, initialExplorationTrials: 1 },
      evaluator: ({ scope }) =>
        ({
          scope,
          datasetFingerprint: 'dataset',
          foldObjectives: [1, 1, 1],
          foldTradeCounts: [30, 30, 30],
          foldDrawdownFractions: [0.1, 0.1, 0.1],
          holdoutAccessed: true,
        }) as unknown as BayesianDiscoveryEvaluation,
    });

    expect(result.status).toBe('REJECTED');
    expect(result.selectedTrial).toBeNull();
    expect(result.trials.every((trial) => trial.status === 'REJECTED')).toBe(
      true,
    );
    expect(result.trials[0]?.rejectionReasons).toContain(
      'HOLDOUT_ACCESS_DURING_OPTIMIZATION',
    );
  });

  it('rejects a sharp optimum without stable neighboring parameters', async () => {
    const result = await optimizeBayesianWalkForward({
      parameterSpace: { threshold: [1, 2, 3] },
      policy: {
        ...policy,
        maximumTrials: 3,
        initialExplorationTrials: 1,
        maximumNeighborObjectiveDegradationFraction: 0.01,
      },
      evaluator: ({ parameters, scope }) => {
        const score = parameters.threshold === 2 ? 10 : 0.1;
        return {
          scope,
          datasetFingerprint: 'dataset',
          foldObjectives: [score, score, score],
          foldTradeCounts: [30, 30, 30],
          foldDrawdownFractions: [0.05, 0.05, 0.05],
          holdoutAccessed: false,
        };
      },
    });

    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReasons).toContain(
      'UNSTABLE_PARAMETER_NEIGHBORHOOD',
    );
    expect(result.selectedTrial).toBeNull();
  });
});
