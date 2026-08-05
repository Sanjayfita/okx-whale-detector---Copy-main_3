import type { BacktestStatistics } from '../backtest/BacktestStatistics';

export type RequiredMarketRegime =
  | 'BULL_TREND'
  | 'BEAR_TREND'
  | 'SIDEWAYS'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY';

export type RobustnessScenarioKind =
  | 'BASELINE'
  | 'HIGH_FEES'
  | 'HIGH_SLIPPAGE'
  | 'HIGH_FUNDING'
  | 'COMBINED_ADVERSE';

export interface ExecutionStressAssumptions {
  readonly feeMultiplier: number;
  readonly slippageMultiplier: number;
  readonly fundingMultiplier: number;
  readonly availableDepthFraction: number;
}

export interface RobustnessScenarioResult {
  readonly scenarioId: string;
  readonly strategyId: string;
  readonly regime: RequiredMarketRegime;
  readonly scenarioKind: RobustnessScenarioKind;
  readonly datasetFingerprint: string;
  readonly sourceKind: 'REAL_MARKET' | 'SYNTHETIC' | 'MIXED';
  readonly independentEpisodeCount: number;
  readonly assumptions: ExecutionStressAssumptions;
  readonly statistics: BacktestStatistics;
}

export interface RobustnessValidationPolicy {
  readonly requiredRegimes: readonly RequiredMarketRegime[];
  readonly requiredStressScenarios: readonly Exclude<
    RobustnessScenarioKind,
    'BASELINE'
  >[];
  readonly minimumTradesPerScenario: number;
  readonly minimumIndependentEpisodesPerScenario: number;
  readonly minimumTotalBaselineTrades: number;
  readonly minimumPositiveRegimeFraction: number;
  readonly minimumBaselineProfitFactor: number;
  readonly minimumBaselineSharpeRatio: number;
  readonly maximumBaselineDrawdownPercent: number;
  readonly minimumStressProfitFactor: number;
  readonly minimumStressExpectancy: number;
  readonly minimumStressExpectancyRatioToBaseline: number;
  readonly maximumStressDrawdownPercent: number;
}

export const DEFAULT_ROBUSTNESS_VALIDATION_POLICY: RobustnessValidationPolicy = {
  requiredRegimes: [
    'BULL_TREND',
    'BEAR_TREND',
    'SIDEWAYS',
    'HIGH_VOLATILITY',
    'LOW_VOLATILITY',
  ],
  requiredStressScenarios: [
    'HIGH_FEES',
    'HIGH_SLIPPAGE',
    'HIGH_FUNDING',
    'COMBINED_ADVERSE',
  ],
  minimumTradesPerScenario: 30,
  minimumIndependentEpisodesPerScenario: 30,
  minimumTotalBaselineTrades: 200,
  minimumPositiveRegimeFraction: 0.8,
  minimumBaselineProfitFactor: 1.1,
  minimumBaselineSharpeRatio: 0.5,
  maximumBaselineDrawdownPercent: 0.2,
  minimumStressProfitFactor: 1,
  minimumStressExpectancy: 0,
  minimumStressExpectancyRatioToBaseline: 0.1,
  maximumStressDrawdownPercent: 0.25,
};

export interface RobustnessValidationDecision {
  readonly strategyId: string;
  readonly status: 'ROBUSTNESS_PASSED' | 'REJECTED';
  readonly datasetFingerprint: string | null;
  readonly scenarioCount: number;
  readonly positiveRegimeFraction: number;
  readonly totalBaselineTrades: number;
  readonly minimumObservedStressExpectancy: number | null;
  readonly maximumObservedDrawdownPercent: number | null;
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

const validatePositiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
};

const validatePolicy = (policy: RobustnessValidationPolicy): void => {
  if (policy.requiredRegimes.length === 0) {
    throw new Error('requiredRegimes must not be empty');
  }
  if (new Set(policy.requiredRegimes).size !== policy.requiredRegimes.length) {
    throw new Error('requiredRegimes must not contain duplicates');
  }
  if (policy.requiredStressScenarios.length === 0) {
    throw new Error('requiredStressScenarios must not be empty');
  }
  if (
    new Set(policy.requiredStressScenarios).size !==
    policy.requiredStressScenarios.length
  ) {
    throw new Error('requiredStressScenarios must not contain duplicates');
  }
  validatePositiveInteger(
    policy.minimumTradesPerScenario,
    'minimumTradesPerScenario',
  );
  validatePositiveInteger(
    policy.minimumIndependentEpisodesPerScenario,
    'minimumIndependentEpisodesPerScenario',
  );
  validatePositiveInteger(
    policy.minimumTotalBaselineTrades,
    'minimumTotalBaselineTrades',
  );
  if (
    !Number.isFinite(policy.minimumPositiveRegimeFraction) ||
    policy.minimumPositiveRegimeFraction <= 0.5 ||
    policy.minimumPositiveRegimeFraction > 1
  ) {
    throw new Error('minimumPositiveRegimeFraction must be in (0.5, 1]');
  }
  const finiteFields = [
    policy.minimumBaselineProfitFactor,
    policy.minimumBaselineSharpeRatio,
    policy.maximumBaselineDrawdownPercent,
    policy.minimumStressProfitFactor,
    policy.minimumStressExpectancy,
    policy.minimumStressExpectancyRatioToBaseline,
    policy.maximumStressDrawdownPercent,
  ];
  if (finiteFields.some((value) => !Number.isFinite(value))) {
    throw new Error('robustness policy numeric thresholds must be finite');
  }
  if (
    policy.minimumBaselineProfitFactor <= 0 ||
    policy.minimumStressProfitFactor <= 0 ||
    policy.maximumBaselineDrawdownPercent < 0 ||
    policy.maximumStressDrawdownPercent < 0 ||
    policy.minimumStressExpectancyRatioToBaseline < 0
  ) {
    throw new Error('robustness policy thresholds are outside valid ranges');
  }
};

const validateStatistics = (
  statistics: BacktestStatistics,
  scenarioId: string,
): void => {
  const requiredFinite = [
    statistics.expectancy,
    statistics.maximumDrawdownPercent,
    statistics.netProfit,
  ];
  if (requiredFinite.some((value) => !Number.isFinite(value))) {
    throw new Error(`non-finite statistics for ${scenarioId}`);
  }
  if (!Number.isSafeInteger(statistics.tradeCount) || statistics.tradeCount < 0) {
    throw new Error(`invalid tradeCount for ${scenarioId}`);
  }
  if (
    statistics.profitFactor !== null &&
    (!Number.isFinite(statistics.profitFactor) || statistics.profitFactor < 0)
  ) {
    throw new Error(`invalid profitFactor for ${scenarioId}`);
  }
  if (
    statistics.sharpeRatio !== null &&
    !Number.isFinite(statistics.sharpeRatio)
  ) {
    throw new Error(`invalid sharpeRatio for ${scenarioId}`);
  }
  if (
    statistics.maximumDrawdownPercent < 0 ||
    statistics.maximumDrawdownPercent > 1
  ) {
    throw new Error(`invalid maximumDrawdownPercent for ${scenarioId}`);
  }
};

const validateAssumptions = (scenario: RobustnessScenarioResult): void => {
  const { assumptions } = scenario;
  if (
    !Number.isFinite(assumptions.feeMultiplier) ||
    !Number.isFinite(assumptions.slippageMultiplier) ||
    !Number.isFinite(assumptions.fundingMultiplier) ||
    !Number.isFinite(assumptions.availableDepthFraction) ||
    assumptions.feeMultiplier <= 0 ||
    assumptions.slippageMultiplier <= 0 ||
    assumptions.fundingMultiplier <= 0 ||
    assumptions.availableDepthFraction <= 0 ||
    assumptions.availableDepthFraction > 1
  ) {
    throw new Error(`invalid stress assumptions for ${scenario.scenarioId}`);
  }

  const strongEnough =
    scenario.scenarioKind === 'BASELINE'
      ? assumptions.feeMultiplier === 1 &&
        assumptions.slippageMultiplier === 1 &&
        assumptions.fundingMultiplier === 1 &&
        assumptions.availableDepthFraction === 1
      : scenario.scenarioKind === 'HIGH_FEES'
        ? assumptions.feeMultiplier >= 1.5
        : scenario.scenarioKind === 'HIGH_SLIPPAGE'
          ? assumptions.slippageMultiplier >= 2
          : scenario.scenarioKind === 'HIGH_FUNDING'
            ? assumptions.fundingMultiplier >= 2
            : assumptions.feeMultiplier >= 1.5 &&
              assumptions.slippageMultiplier >= 1.5 &&
              assumptions.fundingMultiplier >= 1.5 &&
              assumptions.availableDepthFraction <= 0.75;
  if (!strongEnough) {
    throw new Error(
      `scenario ${scenario.scenarioId} is mislabeled or insufficiently stressed`,
    );
  }
};

const scenarioKey = (
  regime: RequiredMarketRegime,
  scenarioKind: RobustnessScenarioKind,
): string => `${regime}\u0000${scenarioKind}`;

const passesBaselineMetrics = (
  result: RobustnessScenarioResult,
  policy: RobustnessValidationPolicy,
): boolean =>
  result.statistics.tradeCount >= policy.minimumTradesPerScenario &&
  result.independentEpisodeCount >=
    policy.minimumIndependentEpisodesPerScenario &&
  result.statistics.expectancy > 0 &&
  result.statistics.profitFactor !== null &&
  result.statistics.profitFactor >= policy.minimumBaselineProfitFactor &&
  result.statistics.sharpeRatio !== null &&
  result.statistics.sharpeRatio >= policy.minimumBaselineSharpeRatio &&
  result.statistics.maximumDrawdownPercent <=
    policy.maximumBaselineDrawdownPercent;

export const evaluateRobustnessValidation = (input: {
  readonly strategyId: string;
  readonly scenarios: readonly RobustnessScenarioResult[];
  readonly policy?: RobustnessValidationPolicy;
}): RobustnessValidationDecision => {
  const policy = input.policy ?? DEFAULT_ROBUSTNESS_VALIDATION_POLICY;
  validatePolicy(policy);
  if (input.strategyId.trim().length === 0) {
    throw new Error('strategyId must not be empty');
  }

  const rejectionReasons: string[] = [];
  const scenarioIds = new Set<string>();
  const scenarioKeys = new Set<string>();
  const fingerprints = new Set<string>();
  for (const scenario of input.scenarios) {
    if (scenario.scenarioId.trim().length === 0) {
      throw new Error('scenarioId must not be empty');
    }
    if (scenarioIds.has(scenario.scenarioId)) {
      throw new Error(`duplicate scenarioId ${scenario.scenarioId}`);
    }
    scenarioIds.add(scenario.scenarioId);
    if (scenario.strategyId !== input.strategyId) {
      throw new Error(`strategy mismatch in ${scenario.scenarioId}`);
    }
    const key = scenarioKey(scenario.regime, scenario.scenarioKind);
    if (scenarioKeys.has(key)) {
      throw new Error(
        `duplicate scenario for ${scenario.regime}/${scenario.scenarioKind}`,
      );
    }
    scenarioKeys.add(key);
    if (scenario.datasetFingerprint.trim().length === 0) {
      throw new Error(`datasetFingerprint is required for ${scenario.scenarioId}`);
    }
    fingerprints.add(scenario.datasetFingerprint);
    validatePositiveInteger(
      scenario.independentEpisodeCount,
      `independentEpisodeCount for ${scenario.scenarioId}`,
    );
    validateAssumptions(scenario);
    validateStatistics(scenario.statistics, scenario.scenarioId);
    if (scenario.sourceKind !== 'REAL_MARKET') {
      rejectionReasons.push(`NON_REAL_MARKET_SOURCE:${scenario.scenarioId}`);
    }
  }

  if (fingerprints.size !== 1) {
    rejectionReasons.push('SCENARIOS_USE_DIFFERENT_DATASET_FINGERPRINTS');
  }
  const byKey = new Map(
    input.scenarios.map((scenario) => [
      scenarioKey(scenario.regime, scenario.scenarioKind),
      scenario,
    ]),
  );
  const baselines = policy.requiredRegimes.flatMap((regime) => {
    const baseline = byKey.get(scenarioKey(regime, 'BASELINE'));
    if (baseline === undefined) {
      rejectionReasons.push(`MISSING_BASELINE_REGIME:${regime}`);
      return [];
    }
    if (baseline.statistics.tradeCount < policy.minimumTradesPerScenario) {
      rejectionReasons.push(`INSUFFICIENT_BASELINE_TRADES:${regime}`);
    }
    if (
      baseline.independentEpisodeCount <
      policy.minimumIndependentEpisodesPerScenario
    ) {
      rejectionReasons.push(`INSUFFICIENT_BASELINE_EPISODES:${regime}`);
    }
    if (baseline.statistics.expectancy <= 0) {
      rejectionReasons.push(`NON_POSITIVE_BASELINE_EXPECTANCY:${regime}`);
    }
    if (
      baseline.statistics.profitFactor === null ||
      baseline.statistics.profitFactor < policy.minimumBaselineProfitFactor
    ) {
      rejectionReasons.push(`BASELINE_PROFIT_FACTOR_FAILED:${regime}`);
    }
    if (
      baseline.statistics.sharpeRatio === null ||
      baseline.statistics.sharpeRatio < policy.minimumBaselineSharpeRatio
    ) {
      rejectionReasons.push(`BASELINE_SHARPE_FAILED:${regime}`);
    }
    if (
      baseline.statistics.maximumDrawdownPercent >
      policy.maximumBaselineDrawdownPercent
    ) {
      rejectionReasons.push(`BASELINE_DRAWDOWN_FAILED:${regime}`);
    }
    return [baseline];
  });

  const totalBaselineTrades = baselines.reduce(
    (sum, baseline) => sum + baseline.statistics.tradeCount,
    0,
  );
  if (totalBaselineTrades < policy.minimumTotalBaselineTrades) {
    rejectionReasons.push('INSUFFICIENT_TOTAL_BASELINE_TRADES');
  }
  const positiveRegimeFraction =
    policy.requiredRegimes.length === 0
      ? 0
      : baselines.filter((baseline) => passesBaselineMetrics(baseline, policy))
          .length / policy.requiredRegimes.length;
  if (positiveRegimeFraction < policy.minimumPositiveRegimeFraction) {
    rejectionReasons.push('INSUFFICIENT_POSITIVE_REGIME_COVERAGE');
  }

  const stressResults: RobustnessScenarioResult[] = [];
  for (const regime of policy.requiredRegimes) {
    const baseline = byKey.get(scenarioKey(regime, 'BASELINE'));
    for (const stressKind of policy.requiredStressScenarios) {
      const stress = byKey.get(scenarioKey(regime, stressKind));
      if (stress === undefined) {
        rejectionReasons.push(`MISSING_STRESS_SCENARIO:${regime}:${stressKind}`);
        continue;
      }
      stressResults.push(stress);
      if (stress.statistics.tradeCount < policy.minimumTradesPerScenario) {
        rejectionReasons.push(`INSUFFICIENT_STRESS_TRADES:${regime}:${stressKind}`);
      }
      if (
        stress.independentEpisodeCount <
        policy.minimumIndependentEpisodesPerScenario
      ) {
        rejectionReasons.push(
          `INSUFFICIENT_STRESS_EPISODES:${regime}:${stressKind}`,
        );
      }
      if (stress.statistics.expectancy <= policy.minimumStressExpectancy) {
        rejectionReasons.push(`STRESS_EXPECTANCY_FAILED:${regime}:${stressKind}`);
      }
      if (
        stress.statistics.profitFactor === null ||
        stress.statistics.profitFactor < policy.minimumStressProfitFactor
      ) {
        rejectionReasons.push(
          `STRESS_PROFIT_FACTOR_FAILED:${regime}:${stressKind}`,
        );
      }
      if (
        stress.statistics.maximumDrawdownPercent >
        policy.maximumStressDrawdownPercent
      ) {
        rejectionReasons.push(`STRESS_DRAWDOWN_FAILED:${regime}:${stressKind}`);
      }
      if (
        baseline !== undefined &&
        baseline.statistics.expectancy > 0 &&
        stress.statistics.expectancy / baseline.statistics.expectancy <
          policy.minimumStressExpectancyRatioToBaseline
      ) {
        rejectionReasons.push(
          `STRESS_EXPECTANCY_COLLAPSE:${regime}:${stressKind}`,
        );
      }
    }
  }

  const allDrawdowns = input.scenarios.map(
    (scenario) => scenario.statistics.maximumDrawdownPercent,
  );
  const stressExpectancies = stressResults.map(
    (scenario) => scenario.statistics.expectancy,
  );

  return {
    strategyId: input.strategyId,
    status:
      new Set(rejectionReasons).size === 0
        ? 'ROBUSTNESS_PASSED'
        : 'REJECTED',
    datasetFingerprint:
      fingerprints.size === 1 ? [...fingerprints][0] ?? null : null,
    scenarioCount: input.scenarios.length,
    positiveRegimeFraction,
    totalBaselineTrades,
    minimumObservedStressExpectancy:
      stressExpectancies.length === 0 ? null : Math.min(...stressExpectancies),
    maximumObservedDrawdownPercent:
      allDrawdowns.length === 0 ? null : Math.max(...allDrawdowns),
    rejectionReasons: [...new Set(rejectionReasons)],
    liveExecutionAllowed: false,
  };
};
