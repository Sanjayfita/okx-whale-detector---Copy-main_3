import { describe, expect, it } from 'vitest';

import { calculateBacktestStatistics } from '../src/backtest/BacktestStatistics';
import type { PurgedWalkForwardPlan } from '../src/research/PurgedWalkForward';
import {
  evaluateFrozenHoldout,
  optimizePurgedWalkForward,
} from '../src/research/WalkForwardOptimizer';

interface Observation {
  readonly id: string;
  readonly observedAt: number;
  readonly episodeId: string;
}

const observations = Array.from({ length: 80 }, (_, index): Observation => ({
  id: `observation-${index}`,
  observedAt: 1_700_000_000_000 + index * 60_000,
  episodeId: `episode-${index}`,
}));

const plan: PurgedWalkForwardPlan<Observation> = {
  discovery: observations.slice(0, 60),
  holdout: observations.slice(60),
  folds: [
    {
      fold: 1,
      train: observations.slice(0, 20),
      test: observations.slice(20, 40),
      purgedObservationCount: 0,
      embargoedObservationCount: 0,
      overlappingEpisodeCount: 0,
    },
    {
      fold: 2,
      train: observations.slice(10, 30),
      test: observations.slice(40, 60),
      purgedObservationCount: 0,
      embargoedObservationCount: 0,
      overlappingEpisodeCount: 0,
    },
  ],
};

const statistics = (edge: number, count: number) =>
  calculateBacktestStatistics({
    initialEquity: 10_000,
    trades: Array.from({ length: count }, (_, index) => {
      const grossPnl = edge + (index % 2 === 0 ? 0.2 : -0.2);
      return {
        id: `trade-${index}`,
        openedAt: 1_700_000_000_000 + index * 60_000,
        closedAt: 1_700_000_030_000 + index * 60_000,
        grossPnl,
        feeCost: 0,
        fundingPnl: 0,
        netPnl: grossPnl,
        initialRisk: 1,
      };
    }),
  });

describe('WalkForwardOptimizer', () => {
  it('selects parameters only from discovery folds', async () => {
    const phases: string[] = [];
    const result = await optimizePurgedWalkForward({
      plan,
      parameterSpace: { threshold: [1, 2, 3] },
      policy: {
        minimumTestTradesPerFold: 20,
        minimumPositiveFoldFraction: 1,
      },
      evaluator: ({ parameters, observations: rows, phase }) => {
        phases.push(phase);
        const threshold = parameters.threshold ?? 0;
        const edge = 1 - Math.abs(threshold - 2) * 0.4;
        return statistics(phase === 'TRAIN' ? edge + 0.05 : edge, rows.length);
      },
    });

    expect(result.selectedTrial?.parameters).toEqual({ threshold: 2 });
    expect(result.trials).toHaveLength(3);
    expect(phases).not.toContain('HOLDOUT');
    expect(result.holdoutEvaluated).toBe(false);
    expect(result.liveExecutionAllowed).toBe(false);
  });

  it('evaluates the untouched holdout only after parameters are frozen', async () => {
    const phases: string[] = [];
    const result = await evaluateFrozenHoldout({
      plan,
      frozenParameters: { threshold: 2 },
      evaluator: ({ observations: rows, phase }) => {
        phases.push(phase);
        return statistics(1, rows.length);
      },
    });

    expect(phases).toEqual(['HOLDOUT']);
    expect(result.metrics.tradeCount).toBe(20);
    expect(result.holdoutEvaluated).toBe(true);
    expect(result.liveExecutionAllowed).toBe(false);
  });

  it('rejects search spaces larger than the frozen trial budget', async () => {
    await expect(
      optimizePurgedWalkForward({
        plan,
        parameterSpace: { first: [1, 2, 3], second: [1, 2, 3] },
        policy: { maximumTrials: 5 },
        evaluator: () => statistics(1, 20),
      }),
    ).rejects.toThrow('parameter grid exceeds maximumTrials=5');
  });
});
