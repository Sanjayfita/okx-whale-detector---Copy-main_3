export type DirectionalMarketRegime =
  | 'TRENDING_BULL'
  | 'TRENDING_BEAR'
  | 'SIDEWAYS';

export type MarketRegimeOverlay =
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'FUNDING_SQUEEZE'
  | 'LIQUIDATION_CASCADE'
  | 'COMPRESSION'
  | 'EXPANSION';

export type StrategyFamily =
  | 'TREND_FOLLOWING'
  | 'MEAN_REVERSION'
  | 'BREAKOUT'
  | 'ORDER_FLOW'
  | 'DERIVATIVES_FLOW';

export interface RegimeObservation {
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly directionalReturnPercent: number;
  readonly trendEfficiency: number;
  readonly realizedVolatilityPercent: number;
  readonly volatilityPercentile: number;
  readonly atrCompressionRatio: number;
  readonly fundingRate: number;
  readonly fundingAccelerationPerHour: number;
  readonly liquidationNotionalZScore: number;
  readonly liquidationDirection: 'LONGS' | 'SHORTS' | 'BALANCED';
  readonly openInterestMomentumPercent: number;
}

export interface ExplainableRegimePolicy {
  readonly minimumTrendEfficiency: number;
  readonly minimumDirectionalReturnPercent: number;
  readonly highVolatilityPercentile: number;
  readonly lowVolatilityPercentile: number;
  readonly fundingExtremeAbsoluteRate: number;
  readonly fundingAccelerationAbsolutePerHour: number;
  readonly liquidationCascadeZScore: number;
  readonly compressionRatio: number;
  readonly expansionRatio: number;
}

export const DEFAULT_EXPLAINABLE_REGIME_POLICY: ExplainableRegimePolicy = {
  minimumTrendEfficiency: 0.35,
  minimumDirectionalReturnPercent: 0.5,
  highVolatilityPercentile: 0.75,
  lowVolatilityPercentile: 0.25,
  fundingExtremeAbsoluteRate: 0.0005,
  fundingAccelerationAbsolutePerHour: 0.00005,
  liquidationCascadeZScore: 3,
  compressionRatio: 0.7,
  expansionRatio: 1.3,
};

export interface ExplainableRegimeDecision {
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly directionalRegime: DirectionalMarketRegime;
  readonly overlays: readonly MarketRegimeOverlay[];
  readonly confidence: number;
  readonly explanations: readonly string[];
  readonly evidence: Readonly<Record<string, number | string>>;
  readonly activeStrategyFamilies: readonly StrategyFamily[];
  readonly blockedStrategyFamilies: readonly StrategyFamily[];
  readonly liveExecutionAllowed: false;
}

const requireFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const validate = (
  observation: RegimeObservation,
  policy: ExplainableRegimePolicy,
): void => {
  if (observation.instrumentId.trim().length === 0) {
    throw new Error('instrumentId must not be empty');
  }
  if (!Number.isSafeInteger(observation.observedAt) || observation.observedAt < 0) {
    throw new Error('observedAt must be a non-negative safe integer');
  }
  for (const [name, value] of Object.entries(observation)) {
    if (typeof value === 'number') {
      requireFinite(value, name);
    }
  }
  if (observation.trendEfficiency < 0 || observation.trendEfficiency > 1) {
    throw new Error('trendEfficiency must be in [0, 1]');
  }
  if (
    observation.volatilityPercentile < 0 ||
    observation.volatilityPercentile > 1
  ) {
    throw new Error('volatilityPercentile must be in [0, 1]');
  }
  if (policy.lowVolatilityPercentile >= policy.highVolatilityPercentile) {
    throw new Error('lowVolatilityPercentile must be below highVolatilityPercentile');
  }
}

const determineDirection = (input: {
  readonly observation: RegimeObservation;
  readonly policy: ExplainableRegimePolicy;
  readonly explanations: string[];
}): DirectionalMarketRegime => {
  const trending =
    input.observation.trendEfficiency >= input.policy.minimumTrendEfficiency;
  const directional =
    Math.abs(input.observation.directionalReturnPercent) >=
    input.policy.minimumDirectionalReturnPercent;
  if (!trending || !directional) {
    input.explanations.push(
      `SIDEWAYS because trend efficiency ${input.observation.trendEfficiency.toFixed(3)} and directional return ${input.observation.directionalReturnPercent.toFixed(3)}% did not jointly exceed trend thresholds`,
    );
    return 'SIDEWAYS';
  }
  if (input.observation.directionalReturnPercent > 0) {
    input.explanations.push(
      `TRENDING_BULL because return was positive at ${input.observation.directionalReturnPercent.toFixed(3)}% with trend efficiency ${input.observation.trendEfficiency.toFixed(3)}`,
    );
    return 'TRENDING_BULL';
  }
  input.explanations.push(
    `TRENDING_BEAR because return was negative at ${input.observation.directionalReturnPercent.toFixed(3)}% with trend efficiency ${input.observation.trendEfficiency.toFixed(3)}`,
  );
  return 'TRENDING_BEAR';
};

export const classifyMarketRegime = (input: {
  readonly observation: RegimeObservation;
  readonly policy?: ExplainableRegimePolicy;
}): ExplainableRegimeDecision => {
  const policy = input.policy ?? DEFAULT_EXPLAINABLE_REGIME_POLICY;
  validate(input.observation, policy);
  const explanations: string[] = [];
  const overlays: MarketRegimeOverlay[] = [];
  const directionalRegime = determineDirection({
    observation: input.observation,
    policy,
    explanations,
  });

  if (
    input.observation.volatilityPercentile >= policy.highVolatilityPercentile
  ) {
    overlays.push('HIGH_VOLATILITY');
    explanations.push(
      `HIGH_VOLATILITY because volatility percentile ${input.observation.volatilityPercentile.toFixed(3)} exceeded ${policy.highVolatilityPercentile.toFixed(3)}`,
    );
  } else if (
    input.observation.volatilityPercentile <= policy.lowVolatilityPercentile
  ) {
    overlays.push('LOW_VOLATILITY');
    explanations.push(
      `LOW_VOLATILITY because volatility percentile ${input.observation.volatilityPercentile.toFixed(3)} was below ${policy.lowVolatilityPercentile.toFixed(3)}`,
    );
  }

  const fundingDirectionAligned =
    Math.sign(input.observation.fundingRate) ===
      Math.sign(input.observation.fundingAccelerationPerHour) &&
    Math.sign(input.observation.fundingRate) !== 0;
  if (
    Math.abs(input.observation.fundingRate) >=
      policy.fundingExtremeAbsoluteRate &&
    Math.abs(input.observation.fundingAccelerationPerHour) >=
      policy.fundingAccelerationAbsolutePerHour &&
    fundingDirectionAligned
  ) {
    overlays.push('FUNDING_SQUEEZE');
    explanations.push(
      `FUNDING_SQUEEZE because funding ${input.observation.fundingRate.toExponential(3)} was extreme and accelerating in the same direction`,
    );
  }

  if (
    input.observation.liquidationNotionalZScore >=
      policy.liquidationCascadeZScore &&
    input.observation.liquidationDirection !== 'BALANCED'
  ) {
    overlays.push('LIQUIDATION_CASCADE');
    explanations.push(
      `LIQUIDATION_CASCADE because ${input.observation.liquidationDirection.toLowerCase()} liquidation notional reached z=${input.observation.liquidationNotionalZScore.toFixed(2)}`,
    );
  }

  if (input.observation.atrCompressionRatio <= policy.compressionRatio) {
    overlays.push('COMPRESSION');
    explanations.push(
      `COMPRESSION because ATR ratio ${input.observation.atrCompressionRatio.toFixed(3)} was at or below ${policy.compressionRatio.toFixed(3)}`,
    );
  } else if (input.observation.atrCompressionRatio >= policy.expansionRatio) {
    overlays.push('EXPANSION');
    explanations.push(
      `EXPANSION because ATR ratio ${input.observation.atrCompressionRatio.toFixed(3)} was at or above ${policy.expansionRatio.toFixed(3)}`,
    );
  }

  const active = new Set<StrategyFamily>(['ORDER_FLOW']);
  const blocked = new Set<StrategyFamily>();
  if (directionalRegime === 'SIDEWAYS') {
    active.add('MEAN_REVERSION');
    blocked.add('TREND_FOLLOWING');
  } else {
    active.add('TREND_FOLLOWING');
    blocked.add('MEAN_REVERSION');
  }
  if (overlays.includes('COMPRESSION')) {
    active.add('BREAKOUT');
  }
  if (
    overlays.includes('FUNDING_SQUEEZE') ||
    overlays.includes('LIQUIDATION_CASCADE')
  ) {
    active.add('DERIVATIVES_FLOW');
  }
  if (overlays.includes('LIQUIDATION_CASCADE')) {
    blocked.add('MEAN_REVERSION');
  }

  const directionStrength = clamp01(
    Math.min(
      input.observation.trendEfficiency /
        Math.max(policy.minimumTrendEfficiency, Number.EPSILON),
      Math.abs(input.observation.directionalReturnPercent) /
        Math.max(policy.minimumDirectionalReturnPercent, Number.EPSILON),
    ),
  );
  const overlayStrength = clamp01(overlays.length / 3);
  const confidence = clamp01(0.6 * directionStrength + 0.4 * overlayStrength);

  return {
    instrumentId: input.observation.instrumentId,
    observedAt: input.observation.observedAt,
    directionalRegime,
    overlays,
    confidence,
    explanations,
    evidence: {
      directionalReturnPercent: input.observation.directionalReturnPercent,
      trendEfficiency: input.observation.trendEfficiency,
      realizedVolatilityPercent: input.observation.realizedVolatilityPercent,
      volatilityPercentile: input.observation.volatilityPercentile,
      atrCompressionRatio: input.observation.atrCompressionRatio,
      fundingRate: input.observation.fundingRate,
      fundingAccelerationPerHour:
        input.observation.fundingAccelerationPerHour,
      liquidationNotionalZScore:
        input.observation.liquidationNotionalZScore,
      liquidationDirection: input.observation.liquidationDirection,
      openInterestMomentumPercent:
        input.observation.openInterestMomentumPercent,
    },
    activeStrategyFamilies: [...active].sort(),
    blockedStrategyFamilies: [...blocked].sort(),
    liveExecutionAllowed: false,
  };
};
