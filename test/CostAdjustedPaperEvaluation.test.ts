import { describe, expect, it } from 'vitest';

import type { AggregateAlertOutcomeStatistics } from '../src/research/aggregateAlertOutcomeStatistics';
import { evaluateCostAdjustedPaperPerformance } from '../src/research/costAdjustedPaperEvaluation';

const statistics = (
  returns: readonly number[],
): AggregateAlertOutcomeStatistics => ({
  schemaVersion: 1,
  evaluationId: 'evaluation-q7',
  bundleCount: 100,
  horizonStatistics: [1, 5, 15, 30, 60].map((horizonMinutes, index) => ({
    horizonMinutes: horizonMinutes as 1 | 5 | 15 | 30 | 60,
    sampleSize: 100,
    wins: 60,
    losses: 40,
    flats: 0,
    winRatePercent: 60,
    averageDirectionAdjustedReturnPercent: returns[index]!,
    averageMaximumFavorableExcursionPercent: 1,
    averageMaximumAdverseExcursionPercent: 0.5,
  })),
  complete: true,
  liveOrderExecutionAllowed: false,
});

describe('evaluateCostAdjustedPaperPerformance', () => {
  it('subtracts fees, slippage, and delay penalty from every horizon', () => {
    const result = evaluateCostAdjustedPaperPerformance({
      statistics: statistics([0.5, 0.4, 0.3, 0.2, 0.1]),
      assumptions: {
        roundTripFeePercent: 0.08,
        slippagePercent: 0.04,
        executionDelayPenaltyPercent: 0.03,
      },
    });

    expect(result.horizonEvaluations[0]!.totalCostPercent).toBeCloseTo(0.15);
    expect(result.horizonEvaluations[0]!.netAverageReturnPercent).toBeCloseTo(0.35);
    expect(result.profitableHorizons).toBe(4);
    expect(result.unprofitableHorizons).toBe(1);
    expect(result.paperOnly).toBe(true);
    expect(result.orderExecutionAuthorized).toBe(false);
    expect(result.liveOrderExecutionAllowed).toBe(false);
  });

  it('marks a horizon unprofitable when costs exceed gross return', () => {
    const result = evaluateCostAdjustedPaperPerformance({
      statistics: statistics([0.1, 0.1, 0.1, 0.1, 0.1]),
      assumptions: {
        roundTripFeePercent: 0.08,
        slippagePercent: 0.04,
        executionDelayPenaltyPercent: 0.03,
      },
    });

    expect(result.profitableHorizons).toBe(0);
    expect(result.horizonEvaluations.every((item) => !item.profitableAfterCosts)).toBe(
      true,
    );
  });

  it('rejects negative cost assumptions', () => {
    expect(() =>
      evaluateCostAdjustedPaperPerformance({
        statistics: statistics([0.2, 0.2, 0.2, 0.2, 0.2]),
        assumptions: {
          roundTripFeePercent: -0.01,
          slippagePercent: 0.04,
          executionDelayPenaltyPercent: 0.03,
        },
      }),
    ).toThrow('roundTripFeePercent must be a non-negative finite number');
  });
});
