import { describe, expect, it } from 'vitest';

import type { BacktestStatistics } from '../src/backtest/BacktestStatistics';
import type { FeatureSelectionReport } from '../src/research/FeatureSelection';
import type { RobustnessValidationDecision } from '../src/research/RobustnessValidation';
import type { StrategyComparisonRow } from '../src/research/StrategyComparison';
import type { StrategyValidationDecision } from '../src/research/StrategyValidation';
import {
  buildValidatedLeaderboard,
  type ValidatedLeaderboardCandidate,
} from '../src/research/ValidatedLeaderboard';

const statistics = (
  overrides: Partial<BacktestStatistics> = {},
): BacktestStatistics => ({
  tradeCount: 120,
  winningTrades: 70,
  losingTrades: 50,
  breakevenTrades: 0,
  winRate: 70 / 120,
  grossProfit: 180,
  grossLoss: 120,
  netProfit: 60,
  profitFactor: 1.5,
  expectancy: 0.5,
  averageR: 0.05,
  sharpeRatio: 1,
  sortinoRatio: 1.2,
  maximumDrawdown: 100,
  maximumDrawdownPercent: 0.1,
  recoveryFactor: 0.6,
  averageHoldingTimeMs: 60_000,
  totalFees: 20,
  totalFundingPnl: -5,
  equityCurve: [],
  ...overrides,
});

const featureSelection = (passed: boolean): FeatureSelectionReport => ({
  status: passed ? 'SELECTION_PASSED' : 'REJECTED',
  selectedFeatures: passed ? ['cvd'] : [],
  retainedResearchFeatures: passed ? ['cvd'] : [],
  retainedSafetyFeatures: [],
  decisions: [],
  rejectionReasons: passed ? [] : ['NO_RESEARCH_FEATURE_RETAINED'],
  liveExecutionAllowed: false,
});

const validation = (
  strategyId: string,
  passed: boolean,
): StrategyValidationDecision => ({
  candidateId: strategyId,
  status: passed ? 'VALIDATED_FOR_PAPER_RESEARCH' : 'REJECTED',
  rejectionReasons: passed ? [] : ['INSUFFICIENT_FOLDS'],
  positiveFoldFraction: passed ? 0.8 : 0,
  medianTestExpectancy: passed ? 0.4 : null,
  medianTestProfitFactor: passed ? 1.3 : null,
  medianTestSharpeRatio: passed ? 0.8 : null,
  maximumObservedTestDrawdownPercent: passed ? 0.15 : null,
  liveExecutionAllowed: false,
});

const robustness = (
  strategyId: string,
  passed: boolean,
): RobustnessValidationDecision => ({
  strategyId,
  status: passed ? 'ROBUSTNESS_PASSED' : 'REJECTED',
  datasetFingerprint: passed ? 'fingerprint' : null,
  scenarioCount: passed ? 25 : 0,
  positiveRegimeFraction: passed ? 1 : 0,
  totalBaselineTrades: passed ? 250 : 0,
  minimumObservedStressExpectancy: passed ? 0.1 : null,
  maximumObservedDrawdownPercent: passed ? 0.18 : null,
  rejectionReasons: passed ? [] : ['MISSING_BASELINE_REGIME:BULL_TREND'],
  liveExecutionAllowed: false,
});

const comparison = (input: {
  readonly strategyId: string;
  readonly robustScore: number;
  readonly expectancy: number;
}): StrategyComparisonRow => ({
  rank: 1,
  strategyId: input.strategyId,
  label: input.strategyId,
  statistics: statistics({ expectancy: input.expectancy }),
  regimePerformance: [],
  positiveRegimeFraction: 1,
  robustScore: input.robustScore,
  pairedImprovement: {
    baselineStrategyId: 'original-whale-baseline',
    pairedEpisodeCount: 150,
    meanPnlImprovement: 0.2,
    confidenceLower: 0.05,
    confidenceUpper: 0.35,
    probabilityOfImprovement: 0.99,
    statisticallySignificant: true,
  },
  promotionStatus: 'ELIGIBLE_FOR_PAPER_COMPARISON',
  liveExecutionAllowed: false,
});

const candidate = (input: {
  readonly strategyId: string;
  readonly robustScore: number;
  readonly passed: boolean;
}): ValidatedLeaderboardCandidate => ({
  strategyId: input.strategyId,
  label: input.strategyId,
  comparison: comparison({
    strategyId: input.strategyId,
    robustScore: input.robustScore,
    expectancy: input.robustScore,
  }),
  validation: validation(input.strategyId, input.passed),
  robustness: robustness(input.strategyId, input.passed),
  featureSelection: featureSelection(input.passed),
});

describe('buildValidatedLeaderboard', () => {
  it('ranks only candidates whose independent validation gates passed', () => {
    const report = buildValidatedLeaderboard({
      candidates: [
        candidate({
          strategyId: 'trend-following-v1',
          robustScore: 1,
          passed: true,
        }),
        candidate({
          strategyId: 'derivatives-flow-v1',
          robustScore: 2,
          passed: true,
        }),
        candidate({
          strategyId: 'mean-reversion-v1',
          robustScore: 10,
          passed: false,
        }),
      ],
    });

    expect(report.rankedStrategyCount).toBe(2);
    expect(report.excludedStrategyCount).toBe(1);
    expect(report.rows[0]?.strategyId).toBe('derivatives-flow-v1');
    expect(report.rows[0]?.rank).toBe(1);
    expect(report.rows[1]?.strategyId).toBe('trend-following-v1');
    expect(report.rows[1]?.rank).toBe(2);
    expect(report.rows[2]?.strategyId).toBe('mean-reversion-v1');
    expect(report.rows[2]?.rank).toBeNull();
    expect(report.rows[2]?.expectancy).toBeNull();
    expect(report.rows[2]?.profitFactor).toBeNull();
    expect(report.rows[2]?.exclusionReasons).toContain(
      'STRATEGY_VALIDATION_NOT_PASSED',
    );
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('rejects mismatched strategy evidence', () => {
    const valid = candidate({
      strategyId: 'derivatives-flow-v1',
      robustScore: 2,
      passed: true,
    });

    expect(() =>
      buildValidatedLeaderboard({
        candidates: [
          {
            ...valid,
            validation: validation('different-strategy', true),
          },
        ],
      }),
    ).toThrow(/strategy evidence mismatch/);
  });
});
