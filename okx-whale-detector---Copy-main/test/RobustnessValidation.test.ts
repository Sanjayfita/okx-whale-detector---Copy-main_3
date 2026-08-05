import { describe, expect, it } from 'vitest';

import type { BacktestStatistics } from '../src/backtest/BacktestStatistics';
import {
  evaluateRobustnessValidation,
  type ExecutionStressAssumptions,
  type RequiredMarketRegime,
  type RobustnessScenarioKind,
  type RobustnessScenarioResult,
} from '../src/research/RobustnessValidation';

const statistics = (
  overrides: Partial<BacktestStatistics> = {},
): BacktestStatistics => ({
  tradeCount: 50,
  winningTrades: 30,
  losingTrades: 20,
  breakevenTrades: 0,
  winRate: 0.6,
  grossProfit: 120,
  grossLoss: 80,
  netProfit: 40,
  profitFactor: 1.5,
  expectancy: 0.8,
  averageR: 0.08,
  sharpeRatio: 1,
  sortinoRatio: 1.2,
  maximumDrawdown: 100,
  maximumDrawdownPercent: 0.1,
  recoveryFactor: 0.4,
  averageHoldingTimeMs: 60_000,
  totalFees: 10,
  totalFundingPnl: -2,
  equityCurve: [],
  ...overrides,
});

const regimes: readonly RequiredMarketRegime[] = [
  'BULL_TREND',
  'BEAR_TREND',
  'SIDEWAYS',
  'HIGH_VOLATILITY',
  'LOW_VOLATILITY',
];

const stressKinds: readonly Exclude<
  RobustnessScenarioKind,
  'BASELINE'
>[] = ['HIGH_FEES', 'HIGH_SLIPPAGE', 'HIGH_FUNDING', 'COMBINED_ADVERSE'];

const assumptions = (
  scenarioKind: RobustnessScenarioKind,
): ExecutionStressAssumptions => {
  switch (scenarioKind) {
    case 'BASELINE':
      return {
        feeMultiplier: 1,
        slippageMultiplier: 1,
        fundingMultiplier: 1,
        availableDepthFraction: 1,
      };
    case 'HIGH_FEES':
      return {
        feeMultiplier: 2,
        slippageMultiplier: 1,
        fundingMultiplier: 1,
        availableDepthFraction: 1,
      };
    case 'HIGH_SLIPPAGE':
      return {
        feeMultiplier: 1,
        slippageMultiplier: 2.5,
        fundingMultiplier: 1,
        availableDepthFraction: 1,
      };
    case 'HIGH_FUNDING':
      return {
        feeMultiplier: 1,
        slippageMultiplier: 1,
        fundingMultiplier: 2.5,
        availableDepthFraction: 1,
      };
    case 'COMBINED_ADVERSE':
      return {
        feeMultiplier: 1.5,
        slippageMultiplier: 2,
        fundingMultiplier: 2,
        availableDepthFraction: 0.5,
      };
  }
};

const completeMatrix = (): readonly RobustnessScenarioResult[] =>
  regimes.flatMap((regime) => [
    {
      scenarioId: `${regime}:BASELINE`,
      strategyId: 'derivatives-flow-v1',
      regime,
      scenarioKind: 'BASELINE' as const,
      datasetFingerprint: 'discovery-fingerprint',
      sourceKind: 'REAL_MARKET' as const,
      independentEpisodeCount: 50,
      assumptions: assumptions('BASELINE'),
      statistics: statistics(),
    },
    ...stressKinds.map((scenarioKind) => ({
      scenarioId: `${regime}:${scenarioKind}`,
      strategyId: 'derivatives-flow-v1',
      regime,
      scenarioKind,
      datasetFingerprint: 'discovery-fingerprint',
      sourceKind: 'REAL_MARKET' as const,
      independentEpisodeCount: 50,
      assumptions: assumptions(scenarioKind),
      statistics: statistics({
        netProfit: 20,
        profitFactor: 1.15,
        expectancy: 0.3,
        sharpeRatio: 0.6,
        maximumDrawdownPercent: 0.15,
      }),
    })),
  ]);

describe('evaluateRobustnessValidation', () => {
  it('passes only a complete real-market regime and stress matrix', () => {
    const decision = evaluateRobustnessValidation({
      strategyId: 'derivatives-flow-v1',
      scenarios: completeMatrix(),
    });

    expect(decision.status).toBe('ROBUSTNESS_PASSED');
    expect(decision.scenarioCount).toBe(25);
    expect(decision.positiveRegimeFraction).toBe(1);
    expect(decision.totalBaselineTrades).toBe(250);
    expect(decision.datasetFingerprint).toBe('discovery-fingerprint');
    expect(decision.rejectionReasons).toEqual([]);
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('rejects a missing high-funding scenario instead of averaging it away', () => {
    const scenarios = completeMatrix().filter(
      (scenario) =>
        !(
          scenario.regime === 'BEAR_TREND' &&
          scenario.scenarioKind === 'HIGH_FUNDING'
        ),
    );
    const decision = evaluateRobustnessValidation({
      strategyId: 'derivatives-flow-v1',
      scenarios,
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.rejectionReasons).toContain(
      'MISSING_STRESS_SCENARIO:BEAR_TREND:HIGH_FUNDING',
    );
  });

  it('rejects synthetic evidence even when its metrics look profitable', () => {
    const scenarios = completeMatrix().map((scenario) => ({
      ...scenario,
      sourceKind: 'SYNTHETIC' as const,
    }));
    const decision = evaluateRobustnessValidation({
      strategyId: 'derivatives-flow-v1',
      scenarios,
    });

    expect(decision.status).toBe('REJECTED');
    expect(
      decision.rejectionReasons.some((reason) =>
        reason.startsWith('NON_REAL_MARKET_SOURCE:'),
      ),
    ).toBe(true);
  });

  it('rejects a mislabeled stress scenario', () => {
    const scenarios = completeMatrix().map((scenario) =>
      scenario.scenarioKind === 'HIGH_SLIPPAGE'
        ? {
            ...scenario,
            assumptions: {
              ...scenario.assumptions,
              slippageMultiplier: 1.1,
            },
          }
        : scenario,
    );

    expect(() =>
      evaluateRobustnessValidation({
        strategyId: 'derivatives-flow-v1',
        scenarios,
      }),
    ).toThrow(/mislabeled or insufficiently stressed/);
  });
});
