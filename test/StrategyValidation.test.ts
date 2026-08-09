import { describe, expect, it } from 'vitest';

import type { BacktestStatistics } from '../src/backtest/BacktestStatistics';
import {
  evaluateStrategyValidation,
  type CandidateFoldEvaluation,
} from '../src/research/StrategyValidation';

const statistics = (
  override: Partial<BacktestStatistics> = {},
): BacktestStatistics => ({
  tradeCount: 60,
  winningTrades: 33,
  losingTrades: 27,
  breakevenTrades: 0,
  winRate: 0.55,
  grossProfit: 180,
  grossLoss: 120,
  netProfit: 60,
  profitFactor: 1.5,
  expectancy: 1,
  averageR: 0.1,
  sharpeRatio: 1,
  sortinoRatio: 1.2,
  maximumDrawdown: 50,
  maximumDrawdownPercent: 0.1,
  recoveryFactor: 1.2,
  averageHoldingTimeMs: 60_000,
  totalFees: 20,
  totalFundingPnl: -2,
  equityCurve: [],
  ...override,
});

const folds = (): CandidateFoldEvaluation[] =>
  [1, 2, 3].map((fold) => ({
    fold,
    train: statistics({ sharpeRatio: 1.2 }),
    test: statistics({ sharpeRatio: 0.9 + fold * 0.05 }),
  }));

describe('evaluateStrategyValidation', () => {
  it('requires the untouched holdout after discovery gates pass', () => {
    const decision = evaluateStrategyValidation({
      candidateId: 'flow-v1',
      folds: folds(),
      holdout: null,
      higherCostStress: statistics({ expectancy: 0.25 }),
      parameterNeighbors: [statistics(), statistics({ expectancy: 0.5 })],
    });

    expect(decision.status).toBe('DISCOVERY_PASSED_HOLDOUT_REQUIRED');
    expect(decision.rejectionReasons).toEqual(['HOLDOUT_REQUIRED']);
    expect(decision.positiveFoldFraction).toBe(1);
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('rejects a large train-to-test collapse and unstable OOS results', () => {
    const decision = evaluateStrategyValidation({
      candidateId: 'overfit-candidate',
      folds: [1, 2, 3].map((fold) => ({
        fold,
        train: statistics({ sharpeRatio: 5, expectancy: 5 }),
        test: statistics({
          expectancy: -1,
          profitFactor: 0.8,
          sharpeRatio: -0.5,
        }),
      })),
      holdout: null,
      higherCostStress: statistics({ expectancy: -1 }),
      parameterNeighbors: [
        statistics({ expectancy: -0.5, profitFactor: 0.9, sharpeRatio: -0.2 }),
      ],
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.rejectionReasons).toContain(
      'UNSTABLE_OUT_OF_SAMPLE_EXPECTANCY',
    );
    expect(decision.rejectionReasons).toContain(
      'TRAIN_TEST_PERFORMANCE_GAP_TOO_LARGE',
    );
    expect(decision.rejectionReasons).toContain('HIGHER_COST_STRESS_FAILED');
    expect(decision.rejectionReasons).toContain(
      'PARAMETER_NEIGHBORHOOD_UNSTABLE',
    );
  });

  it('promotes only to paper research after a passing final holdout', () => {
    const decision = evaluateStrategyValidation({
      candidateId: 'flow-v1',
      folds: folds(),
      holdout: statistics({ tradeCount: 80, expectancy: 0.4 }),
      higherCostStress: statistics({ expectancy: 0.2 }),
      parameterNeighbors: [statistics(), statistics({ expectancy: 0.2 })],
    });

    expect(decision.status).toBe('VALIDATED_FOR_PAPER_RESEARCH');
    expect(decision.rejectionReasons).toEqual([]);
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('rejects a holdout with too few independent trades', () => {
    const decision = evaluateStrategyValidation({
      candidateId: 'small-holdout',
      folds: folds(),
      holdout: statistics({ tradeCount: 10 }),
      higherCostStress: statistics({ expectancy: 0.2 }),
      parameterNeighbors: [statistics(), statistics()],
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.rejectionReasons).toContain(
      'HOLDOUT_INSUFFICIENT_TRADES',
    );
  });
});
