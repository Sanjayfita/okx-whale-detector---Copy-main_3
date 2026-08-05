import {
  calculateBasisBps,
  calculateSpreadBps,
  type DerivativeMarketSnapshot,
  validateDerivativeMarketSnapshot,
} from '../derivatives/DerivativeMarketSnapshot';

export type TradeDirection = 'LONG' | 'SHORT';

export type StrategyRejectionReason =
  | 'RANGE_OR_NO_STRUCTURE_TRIGGER'
  | 'SPREAD_TOO_WIDE'
  | 'BASIS_DISLOCATION_TOO_LARGE'
  | 'VOLATILITY_OUTSIDE_POLICY'
  | 'TREND_TOO_WEAK'
  | 'VOLUME_TOO_LOW'
  | 'ADVERSE_FUNDING'
  | 'AGGRESSIVE_FLOW_NOT_CONFIRMED'
  | 'OPEN_INTEREST_NOT_CONFIRMED'
  | 'INSUFFICIENT_CONFIRMATIONS'
  | 'WHALE_AUTHENTICITY_REQUIRED';

export type ConfirmationName =
  | 'STRUCTURE'
  | 'TREND_ALIGNMENT'
  | 'RELATIVE_VOLUME'
  | 'AGGRESSIVE_DELTA'
  | 'CVD_SLOPE'
  | 'OPEN_INTEREST_EXPANSION'
  | 'ORDER_BOOK_IMBALANCE'
  | 'LIQUIDATION_IMBALANCE'
  | 'VWAP_LOCATION'
  | 'WHALE_AUTHENTICITY';

export interface StrategyConfirmation {
  readonly name: ConfirmationName;
  readonly passed: boolean;
  readonly applicable: boolean;
  readonly weight: number;
  readonly observedValue: number | null;
  readonly requiredValue: number | null;
}

export interface DerivativesFlowStrategyPolicy {
  readonly maximumSpreadBps: number;
  readonly maximumAbsoluteBasisBps: number;
  readonly minimumAtrPercent: number;
  readonly maximumAtrPercent: number;
  readonly minimumTrendEfficiency: number;
  readonly minimumTrendAlignment: number;
  readonly minimumVolumeRatio: number;
  readonly minimumAggressiveDelta: number;
  readonly minimumCvdSlope: number;
  readonly minimumOpenInterestChangePercent: number;
  readonly minimumDirectionalPriceChangePercent: number;
  readonly minimumOrderBookImbalance: number;
  readonly minimumLiquidationImbalance: number;
  readonly maximumAdverseFundingRatePercent: number;
  readonly maximumAbsoluteVwapDeviationAtr: number;
  readonly minimumWhaleAuthenticity: number;
  readonly requireWhaleAuthenticity: boolean;
  readonly minimumPassedConfirmations: number;
  readonly minimumWeightedScore: number;
  readonly initialStopAtrMultiple: number;
  readonly trailingStopAtrMultiple: number;
  readonly partialTakeProfitR: number;
  readonly minimumRewardRiskRatio: number;
}

export interface DerivativesFlowStrategyDecision {
  readonly status: 'REJECTED' | 'QUALIFIED_FOR_RESEARCH';
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly direction: TradeDirection | null;
  readonly weightedScore: number;
  readonly passedConfirmations: number;
  readonly applicableConfirmations: number;
  readonly spreadBps: number;
  readonly basisBps: number;
  readonly confirmations: readonly StrategyConfirmation[];
  readonly rejectionReasons: readonly StrategyRejectionReason[];
  readonly tradeManagement:
    | {
        readonly initialStopAtrMultiple: number;
        readonly trailingStopAtrMultiple: number;
        readonly partialTakeProfitR: number;
        readonly minimumRewardRiskRatio: number;
      }
    | null;
  readonly liveExecutionAllowed: false;
}

export const DEFAULT_DERIVATIVES_FLOW_STRATEGY_POLICY: DerivativesFlowStrategyPolicy =
  Object.freeze({
    maximumSpreadBps: 8,
    maximumAbsoluteBasisBps: 40,
    minimumAtrPercent: 0.15,
    maximumAtrPercent: 5,
    minimumTrendEfficiency: 0.35,
    minimumTrendAlignment: 0.3,
    minimumVolumeRatio: 1.1,
    minimumAggressiveDelta: 0.15,
    minimumCvdSlope: 0.08,
    minimumOpenInterestChangePercent: 0.08,
    minimumDirectionalPriceChangePercent: 0.05,
    minimumOrderBookImbalance: 0.08,
    minimumLiquidationImbalance: 0.08,
    maximumAdverseFundingRatePercent: 0.08,
    maximumAbsoluteVwapDeviationAtr: 2.5,
    minimumWhaleAuthenticity: 0.65,
    requireWhaleAuthenticity: false,
    minimumPassedConfirmations: 7,
    minimumWeightedScore: 0.68,
    initialStopAtrMultiple: 1.5,
    trailingStopAtrMultiple: 2,
    partialTakeProfitR: 1.25,
    minimumRewardRiskRatio: 1.8,
  });

const requirePositive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
};

const requireUnitInterval = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
};

const validatePolicy = (policy: DerivativesFlowStrategyPolicy): void => {
  requirePositive(policy.maximumSpreadBps, 'maximumSpreadBps');
  requirePositive(policy.maximumAbsoluteBasisBps, 'maximumAbsoluteBasisBps');
  requirePositive(policy.minimumAtrPercent, 'minimumAtrPercent');
  requirePositive(policy.maximumAtrPercent, 'maximumAtrPercent');
  if (policy.minimumAtrPercent >= policy.maximumAtrPercent) {
    throw new Error('minimumAtrPercent must be below maximumAtrPercent');
  }
  requireUnitInterval(policy.minimumTrendEfficiency, 'minimumTrendEfficiency');
  requireUnitInterval(policy.minimumTrendAlignment, 'minimumTrendAlignment');
  requirePositive(policy.minimumVolumeRatio, 'minimumVolumeRatio');
  requireUnitInterval(policy.minimumAggressiveDelta, 'minimumAggressiveDelta');
  requireUnitInterval(policy.minimumCvdSlope, 'minimumCvdSlope');
  requirePositive(
    policy.minimumOpenInterestChangePercent,
    'minimumOpenInterestChangePercent',
  );
  requirePositive(
    policy.minimumDirectionalPriceChangePercent,
    'minimumDirectionalPriceChangePercent',
  );
  requireUnitInterval(
    policy.minimumOrderBookImbalance,
    'minimumOrderBookImbalance',
  );
  requireUnitInterval(
    policy.minimumLiquidationImbalance,
    'minimumLiquidationImbalance',
  );
  requirePositive(
    policy.maximumAdverseFundingRatePercent,
    'maximumAdverseFundingRatePercent',
  );
  requirePositive(
    policy.maximumAbsoluteVwapDeviationAtr,
    'maximumAbsoluteVwapDeviationAtr',
  );
  requireUnitInterval(
    policy.minimumWhaleAuthenticity,
    'minimumWhaleAuthenticity',
  );
  if (
    !Number.isSafeInteger(policy.minimumPassedConfirmations) ||
    policy.minimumPassedConfirmations <= 0 ||
    policy.minimumPassedConfirmations > 10
  ) {
    throw new Error(
      'minimumPassedConfirmations must be an integer between 1 and 10',
    );
  }
  requireUnitInterval(policy.minimumWeightedScore, 'minimumWeightedScore');
  requirePositive(policy.initialStopAtrMultiple, 'initialStopAtrMultiple');
  requirePositive(policy.trailingStopAtrMultiple, 'trailingStopAtrMultiple');
  requirePositive(policy.partialTakeProfitR, 'partialTakeProfitR');
  requirePositive(policy.minimumRewardRiskRatio, 'minimumRewardRiskRatio');
};

const structureDirection = (
  snapshot: DerivativeMarketSnapshot,
): TradeDirection | null => {
  switch (snapshot.marketStructure) {
    case 'BULLISH_BREAK':
    case 'BULLISH_SWEEP_RECLAIM':
      return 'LONG';
    case 'BEARISH_BREAK':
    case 'BEARISH_SWEEP_RECLAIM':
      return 'SHORT';
    case 'RANGE':
      return null;
  }
};

const confirmation = (input: {
  name: ConfirmationName;
  passed: boolean;
  applicable?: boolean;
  weight: number;
  observedValue: number | null;
  requiredValue: number | null;
}): StrategyConfirmation =>
  Object.freeze({
    name: input.name,
    passed: input.passed,
    applicable: input.applicable ?? true,
    weight: input.weight,
    observedValue: input.observedValue,
    requiredValue: input.requiredValue,
  });

const rejection = (input: {
  snapshot: DerivativeMarketSnapshot;
  direction: TradeDirection | null;
  spreadBps: number;
  basisBps: number;
  confirmations?: readonly StrategyConfirmation[];
  reasons: readonly StrategyRejectionReason[];
}): DerivativesFlowStrategyDecision => ({
  status: 'REJECTED',
  instrumentId: input.snapshot.instrumentId,
  observedAt: input.snapshot.observedAt,
  direction: input.direction,
  weightedScore: 0,
  passedConfirmations: 0,
  applicableConfirmations: input.confirmations?.filter(
    (candidate) => candidate.applicable,
  ).length ?? 0,
  spreadBps: input.spreadBps,
  basisBps: input.basisBps,
  confirmations: input.confirmations ?? [],
  rejectionReasons: [...new Set(input.reasons)],
  tradeManagement: null,
  liveExecutionAllowed: false,
});

export const evaluateDerivativesFlowStrategy = (input: {
  readonly snapshot: DerivativeMarketSnapshot;
  readonly policy?: DerivativesFlowStrategyPolicy;
}): DerivativesFlowStrategyDecision => {
  const policy = input.policy ?? DEFAULT_DERIVATIVES_FLOW_STRATEGY_POLICY;
  validatePolicy(policy);
  validateDerivativeMarketSnapshot(input.snapshot);

  const snapshot = input.snapshot;
  const direction = structureDirection(snapshot);
  const spreadBps = calculateSpreadBps(snapshot);
  const basisBps = calculateBasisBps(snapshot);

  if (direction === null) {
    return rejection({
      snapshot,
      direction,
      spreadBps,
      basisBps,
      reasons: ['RANGE_OR_NO_STRUCTURE_TRIGGER'],
    });
  }

  const sign = direction === 'LONG' ? 1 : -1;
  const hardRejections: StrategyRejectionReason[] = [];

  if (spreadBps > policy.maximumSpreadBps) {
    hardRejections.push('SPREAD_TOO_WIDE');
  }
  if (Math.abs(basisBps) > policy.maximumAbsoluteBasisBps) {
    hardRejections.push('BASIS_DISLOCATION_TOO_LARGE');
  }
  if (
    snapshot.atrPercent < policy.minimumAtrPercent ||
    snapshot.atrPercent > policy.maximumAtrPercent
  ) {
    hardRejections.push('VOLATILITY_OUTSIDE_POLICY');
  }
  if (snapshot.trendEfficiency < policy.minimumTrendEfficiency) {
    hardRejections.push('TREND_TOO_WEAK');
  }
  if (snapshot.volumeRatio < policy.minimumVolumeRatio) {
    hardRejections.push('VOLUME_TOO_LOW');
  }
  if (
    sign * snapshot.fundingRatePercent >
    policy.maximumAdverseFundingRatePercent
  ) {
    hardRejections.push('ADVERSE_FUNDING');
  }

  const whaleApplicable =
    snapshot.whaleAuthenticity !== null &&
    snapshot.whaleDirectionalBias !== null;
  const directionalWhaleValue = whaleApplicable
    ? sign * (snapshot.whaleDirectionalBias ?? 0)
    : null;
  const whalePassed =
    whaleApplicable &&
    (snapshot.whaleAuthenticity ?? 0) >= policy.minimumWhaleAuthenticity &&
    (directionalWhaleValue ?? 0) > 0;

  const confirmations: readonly StrategyConfirmation[] = [
    confirmation({
      name: 'STRUCTURE',
      passed: true,
      weight: 1.5,
      observedValue: sign,
      requiredValue: sign,
    }),
    confirmation({
      name: 'TREND_ALIGNMENT',
      passed:
        sign * snapshot.trendAlignment >= policy.minimumTrendAlignment &&
        snapshot.trendEfficiency >= policy.minimumTrendEfficiency,
      weight: 1.25,
      observedValue: sign * snapshot.trendAlignment,
      requiredValue: policy.minimumTrendAlignment,
    }),
    confirmation({
      name: 'RELATIVE_VOLUME',
      passed: snapshot.volumeRatio >= policy.minimumVolumeRatio,
      weight: 0.75,
      observedValue: snapshot.volumeRatio,
      requiredValue: policy.minimumVolumeRatio,
    }),
    confirmation({
      name: 'AGGRESSIVE_DELTA',
      passed:
        sign * snapshot.aggressiveDeltaNormalized >=
        policy.minimumAggressiveDelta,
      weight: 1.5,
      observedValue: sign * snapshot.aggressiveDeltaNormalized,
      requiredValue: policy.minimumAggressiveDelta,
    }),
    confirmation({
      name: 'CVD_SLOPE',
      passed: sign * snapshot.cvdSlopeNormalized >= policy.minimumCvdSlope,
      weight: 1.25,
      observedValue: sign * snapshot.cvdSlopeNormalized,
      requiredValue: policy.minimumCvdSlope,
    }),
    confirmation({
      name: 'OPEN_INTEREST_EXPANSION',
      passed:
        snapshot.openInterestChangePercent >=
          policy.minimumOpenInterestChangePercent &&
        sign * snapshot.priceChangePercent >=
          policy.minimumDirectionalPriceChangePercent,
      weight: 1.5,
      observedValue: snapshot.openInterestChangePercent,
      requiredValue: policy.minimumOpenInterestChangePercent,
    }),
    confirmation({
      name: 'ORDER_BOOK_IMBALANCE',
      passed:
        sign * snapshot.orderBookImbalance >=
        policy.minimumOrderBookImbalance,
      weight: 0.75,
      observedValue: sign * snapshot.orderBookImbalance,
      requiredValue: policy.minimumOrderBookImbalance,
    }),
    confirmation({
      name: 'LIQUIDATION_IMBALANCE',
      passed:
        sign * snapshot.liquidationImbalance >=
        policy.minimumLiquidationImbalance,
      weight: 0.75,
      observedValue: sign * snapshot.liquidationImbalance,
      requiredValue: policy.minimumLiquidationImbalance,
    }),
    confirmation({
      name: 'VWAP_LOCATION',
      passed:
        sign * snapshot.vwapDeviationAtr >= 0 &&
        Math.abs(snapshot.vwapDeviationAtr) <=
          policy.maximumAbsoluteVwapDeviationAtr,
      weight: 0.5,
      observedValue: sign * snapshot.vwapDeviationAtr,
      requiredValue: 0,
    }),
    confirmation({
      name: 'WHALE_AUTHENTICITY',
      passed: whalePassed,
      applicable: whaleApplicable,
      weight: 0.5,
      observedValue: snapshot.whaleAuthenticity,
      requiredValue: policy.minimumWhaleAuthenticity,
    }),
  ];

  if (
    !confirmations.find((candidate) => candidate.name === 'AGGRESSIVE_DELTA')
      ?.passed ||
    !confirmations.find((candidate) => candidate.name === 'CVD_SLOPE')?.passed
  ) {
    hardRejections.push('AGGRESSIVE_FLOW_NOT_CONFIRMED');
  }
  if (
    !confirmations.find(
      (candidate) => candidate.name === 'OPEN_INTEREST_EXPANSION',
    )?.passed
  ) {
    hardRejections.push('OPEN_INTEREST_NOT_CONFIRMED');
  }
  if (policy.requireWhaleAuthenticity && !whalePassed) {
    hardRejections.push('WHALE_AUTHENTICITY_REQUIRED');
  }

  const applicable = confirmations.filter((candidate) => candidate.applicable);
  const passed = applicable.filter((candidate) => candidate.passed);
  const totalWeight = applicable.reduce(
    (total, candidate) => total + candidate.weight,
    0,
  );
  const passedWeight = passed.reduce(
    (total, candidate) => total + candidate.weight,
    0,
  );
  const weightedScore = totalWeight === 0 ? 0 : passedWeight / totalWeight;

  if (
    passed.length < policy.minimumPassedConfirmations ||
    weightedScore < policy.minimumWeightedScore
  ) {
    hardRejections.push('INSUFFICIENT_CONFIRMATIONS');
  }

  if (hardRejections.length > 0) {
    const rejected = rejection({
      snapshot,
      direction,
      spreadBps,
      basisBps,
      confirmations,
      reasons: hardRejections,
    });

    return {
      ...rejected,
      weightedScore,
      passedConfirmations: passed.length,
      applicableConfirmations: applicable.length,
    };
  }

  return {
    status: 'QUALIFIED_FOR_RESEARCH',
    instrumentId: snapshot.instrumentId,
    observedAt: snapshot.observedAt,
    direction,
    weightedScore,
    passedConfirmations: passed.length,
    applicableConfirmations: applicable.length,
    spreadBps,
    basisBps,
    confirmations,
    rejectionReasons: [],
    tradeManagement: {
      initialStopAtrMultiple: policy.initialStopAtrMultiple,
      trailingStopAtrMultiple: policy.trailingStopAtrMultiple,
      partialTakeProfitR: policy.partialTakeProfitR,
      minimumRewardRiskRatio: policy.minimumRewardRiskRatio,
    },
    liveExecutionAllowed: false,
  };
};
