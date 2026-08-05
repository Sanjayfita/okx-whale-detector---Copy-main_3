import type { TradeDirection } from '../strategy/DerivativesFlowStrategy';

export interface ProfessionalRiskPolicy {
  readonly riskPerTradeFraction: number;
  readonly maximumTradeRiskFraction: number;
  readonly maximumDailyLossFraction: number;
  readonly maximumDrawdownFraction: number;
  readonly maximumConsecutiveLosses: number;
  readonly maximumConcurrentPortfolioRiskFraction: number;
  readonly maximumConcurrentCorrelationRiskFraction: number;
  readonly maximumPositionNotionalToEquity: number;
  readonly maximumLeverage: number;
  readonly volatilityTargetPercent: number;
  readonly minimumVolatilityPercent: number;
  readonly maximumVolatilityPercent: number;
  readonly maximumSpreadBps: number;
  readonly minimumExpectedMoveCostMultiple: number;
  readonly maximumSnapshotAgeMs: number;
  readonly minimumLiquidationBufferMultiple: number;
}

export interface PortfolioRiskState {
  readonly equity: number;
  readonly peakEquity: number;
  readonly sessionStartingEquity: number;
  readonly sessionRealizedPnl: number;
  readonly consecutiveLosses: number;
  readonly activePortfolioRiskFraction: number;
  readonly activeCorrelationRiskFraction: number;
}

export interface ProposedDerivativeTrade {
  readonly instrumentId: string;
  readonly correlationGroup: string;
  readonly direction: TradeDirection;
  readonly observedAt: number;
  readonly evaluatedAt: number;
  readonly entryPrice: number;
  readonly stopPrice: number;
  readonly atrPercent: number;
  readonly spreadBps: number;
  readonly expectedMovePercent: number;
  readonly estimatedRoundTripCostPercent: number;
  readonly estimatedLiquidationDistancePercent: number;
  readonly baseUnitsPerContract: number;
  readonly lotSizeContracts: number;
  readonly minimumContracts: number;
}

export type RiskRejectionReason =
  | 'STALE_MARKET_DATA'
  | 'DAILY_LOSS_CIRCUIT_BREAKER'
  | 'MAXIMUM_DRAWDOWN_CIRCUIT_BREAKER'
  | 'CONSECUTIVE_LOSS_CIRCUIT_BREAKER'
  | 'PORTFOLIO_RISK_LIMIT'
  | 'CORRELATION_RISK_LIMIT'
  | 'VOLATILITY_OUTSIDE_POLICY'
  | 'SPREAD_TOO_WIDE'
  | 'EXPECTED_MOVE_BELOW_COST_THRESHOLD'
  | 'STOP_BEYOND_SAFE_LIQUIDATION_BUFFER'
  | 'POSITION_BELOW_EXCHANGE_MINIMUM';

export interface ProfessionalRiskDecision {
  readonly status: 'REJECTED' | 'APPROVED_FOR_PAPER_RESEARCH';
  readonly instrumentId: string;
  readonly direction: TradeDirection;
  readonly rejectionReasons: readonly RiskRejectionReason[];
  readonly requestedRiskAmount: number;
  readonly effectiveRiskAmount: number;
  readonly effectiveRiskFraction: number;
  readonly positionNotional: number;
  readonly contracts: number;
  readonly impliedLeverage: number;
  readonly stopDistancePercent: number;
  readonly volatilityScale: number;
  readonly dailyLossFraction: number;
  readonly drawdownFraction: number;
  readonly liveExecutionAllowed: false;
}

export const DEFAULT_PROFESSIONAL_RISK_POLICY: ProfessionalRiskPolicy =
  Object.freeze({
    riskPerTradeFraction: 0.005,
    maximumTradeRiskFraction: 0.01,
    maximumDailyLossFraction: 0.02,
    maximumDrawdownFraction: 0.1,
    maximumConsecutiveLosses: 3,
    maximumConcurrentPortfolioRiskFraction: 0.025,
    maximumConcurrentCorrelationRiskFraction: 0.01,
    maximumPositionNotionalToEquity: 1.5,
    maximumLeverage: 3,
    volatilityTargetPercent: 1,
    minimumVolatilityPercent: 0.15,
    maximumVolatilityPercent: 5,
    maximumSpreadBps: 8,
    minimumExpectedMoveCostMultiple: 2.5,
    maximumSnapshotAgeMs: 3_000,
    minimumLiquidationBufferMultiple: 2,
  });

const requirePositive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
};

const requireNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
};

const requireFraction = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be greater than 0 and at most 1`);
  }
};

const validatePolicy = (policy: ProfessionalRiskPolicy): void => {
  requireFraction(policy.riskPerTradeFraction, 'riskPerTradeFraction');
  requireFraction(
    policy.maximumTradeRiskFraction,
    'maximumTradeRiskFraction',
  );
  requireFraction(policy.maximumDailyLossFraction, 'maximumDailyLossFraction');
  requireFraction(policy.maximumDrawdownFraction, 'maximumDrawdownFraction');
  if (
    !Number.isSafeInteger(policy.maximumConsecutiveLosses) ||
    policy.maximumConsecutiveLosses <= 0
  ) {
    throw new Error('maximumConsecutiveLosses must be a positive safe integer');
  }
  requireFraction(
    policy.maximumConcurrentPortfolioRiskFraction,
    'maximumConcurrentPortfolioRiskFraction',
  );
  requireFraction(
    policy.maximumConcurrentCorrelationRiskFraction,
    'maximumConcurrentCorrelationRiskFraction',
  );
  requirePositive(
    policy.maximumPositionNotionalToEquity,
    'maximumPositionNotionalToEquity',
  );
  requirePositive(policy.maximumLeverage, 'maximumLeverage');
  requirePositive(policy.volatilityTargetPercent, 'volatilityTargetPercent');
  requirePositive(
    policy.minimumVolatilityPercent,
    'minimumVolatilityPercent',
  );
  requirePositive(
    policy.maximumVolatilityPercent,
    'maximumVolatilityPercent',
  );
  if (policy.minimumVolatilityPercent >= policy.maximumVolatilityPercent) {
    throw new Error(
      'minimumVolatilityPercent must be below maximumVolatilityPercent',
    );
  }
  requirePositive(policy.maximumSpreadBps, 'maximumSpreadBps');
  requirePositive(
    policy.minimumExpectedMoveCostMultiple,
    'minimumExpectedMoveCostMultiple',
  );
  if (
    !Number.isSafeInteger(policy.maximumSnapshotAgeMs) ||
    policy.maximumSnapshotAgeMs <= 0
  ) {
    throw new Error('maximumSnapshotAgeMs must be a positive safe integer');
  }
  requirePositive(
    policy.minimumLiquidationBufferMultiple,
    'minimumLiquidationBufferMultiple',
  );
  if (policy.riskPerTradeFraction > policy.maximumTradeRiskFraction) {
    throw new Error(
      'riskPerTradeFraction cannot exceed maximumTradeRiskFraction',
    );
  }
  if (
    policy.maximumConcurrentCorrelationRiskFraction >
    policy.maximumConcurrentPortfolioRiskFraction
  ) {
    throw new Error(
      'maximumConcurrentCorrelationRiskFraction cannot exceed the portfolio limit',
    );
  }
};

const validateState = (state: PortfolioRiskState): void => {
  requirePositive(state.equity, 'equity');
  requirePositive(state.peakEquity, 'peakEquity');
  requirePositive(state.sessionStartingEquity, 'sessionStartingEquity');
  if (state.peakEquity < state.equity) {
    throw new Error('peakEquity cannot be below current equity');
  }
  if (!Number.isFinite(state.sessionRealizedPnl)) {
    throw new Error('sessionRealizedPnl must be finite');
  }
  if (
    !Number.isSafeInteger(state.consecutiveLosses) ||
    state.consecutiveLosses < 0
  ) {
    throw new Error('consecutiveLosses must be a non-negative safe integer');
  }
  requireNonNegative(
    state.activePortfolioRiskFraction,
    'activePortfolioRiskFraction',
  );
  requireNonNegative(
    state.activeCorrelationRiskFraction,
    'activeCorrelationRiskFraction',
  );
  if (
    state.activeCorrelationRiskFraction > state.activePortfolioRiskFraction
  ) {
    throw new Error(
      'activeCorrelationRiskFraction cannot exceed activePortfolioRiskFraction',
    );
  }
};

const validateTrade = (trade: ProposedDerivativeTrade): void => {
  if (trade.instrumentId.trim().length === 0) {
    throw new Error('instrumentId must not be empty');
  }
  if (trade.correlationGroup.trim().length === 0) {
    throw new Error('correlationGroup must not be empty');
  }
  if (
    !Number.isSafeInteger(trade.observedAt) ||
    !Number.isSafeInteger(trade.evaluatedAt) ||
    trade.observedAt < 0 ||
    trade.evaluatedAt < trade.observedAt
  ) {
    throw new Error('Trade timestamps are invalid');
  }
  requirePositive(trade.entryPrice, 'entryPrice');
  requirePositive(trade.stopPrice, 'stopPrice');
  if (
    (trade.direction === 'LONG' && trade.stopPrice >= trade.entryPrice) ||
    (trade.direction === 'SHORT' && trade.stopPrice <= trade.entryPrice)
  ) {
    throw new Error('stopPrice must invalidate the proposed trade direction');
  }
  requirePositive(trade.atrPercent, 'atrPercent');
  requireNonNegative(trade.spreadBps, 'spreadBps');
  requirePositive(trade.expectedMovePercent, 'expectedMovePercent');
  requireNonNegative(
    trade.estimatedRoundTripCostPercent,
    'estimatedRoundTripCostPercent',
  );
  requirePositive(
    trade.estimatedLiquidationDistancePercent,
    'estimatedLiquidationDistancePercent',
  );
  requirePositive(trade.baseUnitsPerContract, 'baseUnitsPerContract');
  requirePositive(trade.lotSizeContracts, 'lotSizeContracts');
  requirePositive(trade.minimumContracts, 'minimumContracts');
};

const roundDownToLot = (quantity: number, lot: number): number => {
  const lots = Math.floor((quantity + Number.EPSILON) / lot);
  return lots * lot;
};

const emptyDecision = (input: {
  trade: ProposedDerivativeTrade;
  reasons: readonly RiskRejectionReason[];
  stopDistancePercent: number;
  volatilityScale: number;
  dailyLossFraction: number;
  drawdownFraction: number;
}): ProfessionalRiskDecision => ({
  status: 'REJECTED',
  instrumentId: input.trade.instrumentId,
  direction: input.trade.direction,
  rejectionReasons: [...new Set(input.reasons)],
  requestedRiskAmount: 0,
  effectiveRiskAmount: 0,
  effectiveRiskFraction: 0,
  positionNotional: 0,
  contracts: 0,
  impliedLeverage: 0,
  stopDistancePercent: input.stopDistancePercent,
  volatilityScale: input.volatilityScale,
  dailyLossFraction: input.dailyLossFraction,
  drawdownFraction: input.drawdownFraction,
  liveExecutionAllowed: false,
});

export const evaluateProfessionalRisk = (input: {
  readonly trade: ProposedDerivativeTrade;
  readonly state: PortfolioRiskState;
  readonly policy?: ProfessionalRiskPolicy;
}): ProfessionalRiskDecision => {
  const policy = input.policy ?? DEFAULT_PROFESSIONAL_RISK_POLICY;
  validatePolicy(policy);
  validateState(input.state);
  validateTrade(input.trade);

  const { trade, state } = input;
  const stopDistancePercent =
    (Math.abs(trade.entryPrice - trade.stopPrice) / trade.entryPrice) * 100;
  const dailyLossFraction = Math.max(
    0,
    -state.sessionRealizedPnl / state.sessionStartingEquity,
  );
  const drawdownFraction =
    (state.peakEquity - state.equity) / state.peakEquity;
  const volatilityScale = Math.min(
    1,
    policy.volatilityTargetPercent / trade.atrPercent,
  );
  const reasons: RiskRejectionReason[] = [];

  if (trade.evaluatedAt - trade.observedAt > policy.maximumSnapshotAgeMs) {
    reasons.push('STALE_MARKET_DATA');
  }
  if (dailyLossFraction >= policy.maximumDailyLossFraction) {
    reasons.push('DAILY_LOSS_CIRCUIT_BREAKER');
  }
  if (drawdownFraction >= policy.maximumDrawdownFraction) {
    reasons.push('MAXIMUM_DRAWDOWN_CIRCUIT_BREAKER');
  }
  if (state.consecutiveLosses >= policy.maximumConsecutiveLosses) {
    reasons.push('CONSECUTIVE_LOSS_CIRCUIT_BREAKER');
  }
  if (
    trade.atrPercent < policy.minimumVolatilityPercent ||
    trade.atrPercent > policy.maximumVolatilityPercent
  ) {
    reasons.push('VOLATILITY_OUTSIDE_POLICY');
  }
  if (trade.spreadBps > policy.maximumSpreadBps) {
    reasons.push('SPREAD_TOO_WIDE');
  }
  if (
    trade.expectedMovePercent <
    trade.estimatedRoundTripCostPercent *
      policy.minimumExpectedMoveCostMultiple
  ) {
    reasons.push('EXPECTED_MOVE_BELOW_COST_THRESHOLD');
  }
  if (
    trade.estimatedLiquidationDistancePercent <
    stopDistancePercent * policy.minimumLiquidationBufferMultiple
  ) {
    reasons.push('STOP_BEYOND_SAFE_LIQUIDATION_BUFFER');
  }

  if (reasons.length > 0) {
    return emptyDecision({
      trade,
      reasons,
      stopDistancePercent,
      volatilityScale,
      dailyLossFraction,
      drawdownFraction,
    });
  }

  const requestedRiskFraction = Math.min(
    policy.maximumTradeRiskFraction,
    policy.riskPerTradeFraction * volatilityScale,
  );
  const requestedRiskAmount = state.equity * requestedRiskFraction;
  const unconstrainedNotional =
    requestedRiskAmount / (stopDistancePercent / 100);
  const maximumNotional =
    state.equity *
    Math.min(
      policy.maximumPositionNotionalToEquity,
      policy.maximumLeverage,
    );
  const targetNotional = Math.min(unconstrainedNotional, maximumNotional);
  const contractNotional = trade.entryPrice * trade.baseUnitsPerContract;
  const contracts = roundDownToLot(
    targetNotional / contractNotional,
    trade.lotSizeContracts,
  );

  if (contracts < trade.minimumContracts) {
    return emptyDecision({
      trade,
      reasons: ['POSITION_BELOW_EXCHANGE_MINIMUM'],
      stopDistancePercent,
      volatilityScale,
      dailyLossFraction,
      drawdownFraction,
    });
  }

  const positionNotional = contracts * contractNotional;
  const effectiveRiskAmount =
    positionNotional * (stopDistancePercent / 100);
  const effectiveRiskFraction = effectiveRiskAmount / state.equity;
  const impliedLeverage = positionNotional / state.equity;

  if (
    state.activePortfolioRiskFraction + effectiveRiskFraction >
    policy.maximumConcurrentPortfolioRiskFraction
  ) {
    reasons.push('PORTFOLIO_RISK_LIMIT');
  }
  if (
    state.activeCorrelationRiskFraction + effectiveRiskFraction >
    policy.maximumConcurrentCorrelationRiskFraction
  ) {
    reasons.push('CORRELATION_RISK_LIMIT');
  }

  if (reasons.length > 0) {
    return {
      ...emptyDecision({
        trade,
        reasons,
        stopDistancePercent,
        volatilityScale,
        dailyLossFraction,
        drawdownFraction,
      }),
      requestedRiskAmount,
      effectiveRiskAmount,
      effectiveRiskFraction,
      positionNotional,
      contracts,
      impliedLeverage,
    };
  }

  return {
    status: 'APPROVED_FOR_PAPER_RESEARCH',
    instrumentId: trade.instrumentId,
    direction: trade.direction,
    rejectionReasons: [],
    requestedRiskAmount,
    effectiveRiskAmount,
    effectiveRiskFraction,
    positionNotional,
    contracts,
    impliedLeverage,
    stopDistancePercent,
    volatilityScale,
    dailyLossFraction,
    drawdownFraction,
    liveExecutionAllowed: false,
  };
};
