import {
  calculateStrategyReturnMetrics,
  type StrategyReturnMetrics,
} from './tradeManagementResearch';

export interface RiskResearchTradeObservation {
  readonly alertId: string;
  readonly instrumentId: string;
  readonly correlationGroup: string;
  readonly detectedAt: number;
  readonly exitedAt: number;
  readonly expectedMovePercent: number;
  readonly estimatedTotalCostPercent: number;
  readonly stopDistancePercent: number;
  readonly volatilityPercent: number;
  readonly realizedNetReturnPercent: number;
}

export interface RiskManagementPolicy {
  readonly initialEquity: number;
  readonly fixedRiskFraction: number;
  readonly maximumTradeRiskFraction: number;
  readonly volatilityTargetPercent: number;
  readonly maximumPositionFraction: number;
  readonly maximumConcurrentPortfolioRiskFraction: number;
  readonly maximumConcurrentCorrelationRiskFraction: number;
  readonly minimumExpectedMoveCostMultiple: number;
}

export type RiskResearchDecisionReason =
  | 'ACCEPTED'
  | 'EXPECTED_MOVE_BELOW_COST_THRESHOLD'
  | 'PORTFOLIO_RISK_LIMIT'
  | 'CORRELATION_RISK_LIMIT';

export interface RiskResearchTradeDecision {
  readonly alertId: string;
  readonly instrumentId: string;
  readonly detectedAt: number;
  readonly decision: RiskResearchDecisionReason;
  readonly riskFraction: number;
  readonly positionFraction: number;
  readonly equityBefore: number;
  readonly equityAfter: number;
  readonly pnl: number;
  readonly portfolioRiskBefore: number;
  readonly correlationRiskBefore: number;
}

export interface RiskManagementResearchReport {
  readonly policy: RiskManagementPolicy;
  readonly inputTradeCount: number;
  readonly acceptedTradeCount: number;
  readonly rejectedTradeCount: number;
  readonly rejectedForCostCount: number;
  readonly rejectedForPortfolioRiskCount: number;
  readonly rejectedForCorrelationRiskCount: number;
  readonly startingEquity: number;
  readonly endingEquity: number;
  readonly totalReturnPercent: number;
  readonly returnMetrics: StrategyReturnMetrics;
  readonly decisions: readonly RiskResearchTradeDecision[];
  readonly liveOrderExecutionAllowed: false;
}

interface ActiveRisk {
  readonly alertId: string;
  readonly exitedAt: number;
  readonly correlationGroup: string;
  readonly riskFraction: number;
  readonly pnl: number;
}

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

const validatePolicy = (policy: RiskManagementPolicy): void => {
  requirePositive(policy.initialEquity, 'initialEquity');
  requireFraction(policy.fixedRiskFraction, 'fixedRiskFraction');
  requireFraction(
    policy.maximumTradeRiskFraction,
    'maximumTradeRiskFraction',
  );
  requirePositive(policy.volatilityTargetPercent, 'volatilityTargetPercent');
  requireFraction(policy.maximumPositionFraction, 'maximumPositionFraction');
  requireFraction(
    policy.maximumConcurrentPortfolioRiskFraction,
    'maximumConcurrentPortfolioRiskFraction',
  );
  requireFraction(
    policy.maximumConcurrentCorrelationRiskFraction,
    'maximumConcurrentCorrelationRiskFraction',
  );
  requirePositive(
    policy.minimumExpectedMoveCostMultiple,
    'minimumExpectedMoveCostMultiple',
  );
  if (policy.fixedRiskFraction > policy.maximumTradeRiskFraction) {
    throw new Error(
      'fixedRiskFraction cannot exceed maximumTradeRiskFraction',
    );
  }
  if (
    policy.maximumConcurrentCorrelationRiskFraction >
    policy.maximumConcurrentPortfolioRiskFraction
  ) {
    throw new Error(
      'Correlation risk limit cannot exceed the portfolio risk limit',
    );
  }
};

const validateTrade = (trade: RiskResearchTradeObservation): void => {
  if (trade.alertId.trim().length === 0) throw new Error('alertId is empty');
  if (trade.instrumentId.trim().length === 0) {
    throw new Error('instrumentId is empty');
  }
  if (trade.correlationGroup.trim().length === 0) {
    throw new Error('correlationGroup is empty');
  }
  if (
    !Number.isSafeInteger(trade.detectedAt) ||
    !Number.isSafeInteger(trade.exitedAt) ||
    trade.detectedAt < 0 ||
    trade.exitedAt < trade.detectedAt
  ) {
    throw new Error('Trade timestamps are invalid');
  }
  requireNonNegative(trade.expectedMovePercent, 'expectedMovePercent');
  requireNonNegative(
    trade.estimatedTotalCostPercent,
    'estimatedTotalCostPercent',
  );
  requirePositive(trade.stopDistancePercent, 'stopDistancePercent');
  requirePositive(trade.volatilityPercent, 'volatilityPercent');
  if (!Number.isFinite(trade.realizedNetReturnPercent)) {
    throw new Error('realizedNetReturnPercent must be finite');
  }
};

const requestedRiskFractionFor = (
  trade: RiskResearchTradeObservation,
  policy: RiskManagementPolicy,
): number => {
  const volatilityScale = Math.min(
    1,
    policy.volatilityTargetPercent / trade.volatilityPercent,
  );
  return Math.min(
    policy.maximumTradeRiskFraction,
    policy.fixedRiskFraction * volatilityScale,
  );
};

export const simulateRiskManagementPolicy = (input: {
  readonly trades: readonly RiskResearchTradeObservation[];
  readonly policy: RiskManagementPolicy;
}): RiskManagementResearchReport => {
  validatePolicy(input.policy);
  for (const trade of input.trades) validateTrade(trade);
  const identifiers = new Set<string>();
  for (const trade of input.trades) {
    if (identifiers.has(trade.alertId)) {
      throw new Error(`Duplicate risk-research trade: ${trade.alertId}`);
    }
    identifiers.add(trade.alertId);
  }
  const trades = [...input.trades].sort(
    (left, right) =>
      left.detectedAt - right.detectedAt ||
      left.instrumentId.localeCompare(right.instrumentId) ||
      left.alertId.localeCompare(right.alertId),
  );
  const active: ActiveRisk[] = [];
  const decisions: RiskResearchTradeDecision[] = [];
  const acceptedEquityReturns: number[] = [];
  let equity = input.policy.initialEquity;

  const settlePositionsThrough = (timestamp: number): void => {
    active.sort(
      (left, right) =>
        left.exitedAt - right.exitedAt || left.alertId.localeCompare(right.alertId),
    );
    while (
      active.length > 0 &&
      (active[0]?.exitedAt ?? Number.POSITIVE_INFINITY) <= timestamp
    ) {
      const settled = active.shift();
      if (settled === undefined) break;
      const equityBeforeSettlement = equity;
      equity += settled.pnl;
      acceptedEquityReturns.push(
        (settled.pnl / equityBeforeSettlement) * 100,
      );
    }
  };

  for (const trade of trades) {
    settlePositionsThrough(trade.detectedAt);
    const portfolioRiskBefore = active.reduce(
      (sum, position) => sum + position.riskFraction,
      0,
    );
    const correlationRiskBefore = active
      .filter(
        (position) => position.correlationGroup === trade.correlationGroup,
      )
      .reduce((sum, position) => sum + position.riskFraction, 0);
    const equityBefore = equity;
    const requestedRiskFraction = requestedRiskFractionFor(
      trade,
      input.policy,
    );
    const unconstrainedPositionFraction =
      requestedRiskFraction / (trade.stopDistancePercent / 100);
    const positionFraction = Math.min(
      input.policy.maximumPositionFraction,
      unconstrainedPositionFraction,
    );
    const effectiveRiskFraction =
      positionFraction * (trade.stopDistancePercent / 100);
    const expectedMoveThreshold =
      trade.estimatedTotalCostPercent *
      input.policy.minimumExpectedMoveCostMultiple;
    let decision: RiskResearchDecisionReason = 'ACCEPTED';
    if (trade.expectedMovePercent < expectedMoveThreshold) {
      decision = 'EXPECTED_MOVE_BELOW_COST_THRESHOLD';
    } else if (
      portfolioRiskBefore + effectiveRiskFraction >
      input.policy.maximumConcurrentPortfolioRiskFraction
    ) {
      decision = 'PORTFOLIO_RISK_LIMIT';
    } else if (
      correlationRiskBefore + effectiveRiskFraction >
      input.policy.maximumConcurrentCorrelationRiskFraction
    ) {
      decision = 'CORRELATION_RISK_LIMIT';
    }
    let pnl = 0;
    if (decision === 'ACCEPTED') {
      const positionNotional = equityBefore * positionFraction;
      pnl = positionNotional * (trade.realizedNetReturnPercent / 100);
      active.push(
        Object.freeze({
          alertId: trade.alertId,
          exitedAt: trade.exitedAt,
          correlationGroup: trade.correlationGroup,
          riskFraction: effectiveRiskFraction,
          pnl,
        }),
      );
    }
    decisions.push(
      Object.freeze({
        alertId: trade.alertId,
        instrumentId: trade.instrumentId,
        detectedAt: trade.detectedAt,
        decision,
        riskFraction: effectiveRiskFraction,
        positionFraction,
        equityBefore,
        equityAfter: equity,
        pnl,
        portfolioRiskBefore,
        correlationRiskBefore,
      }),
    );
  }
  settlePositionsThrough(Number.POSITIVE_INFINITY);
  const acceptedTradeCount = decisions.filter(
    (decision) => decision.decision === 'ACCEPTED',
  ).length;
  return Object.freeze({
    policy: Object.freeze({ ...input.policy }),
    inputTradeCount: trades.length,
    acceptedTradeCount,
    rejectedTradeCount: trades.length - acceptedTradeCount,
    rejectedForCostCount: decisions.filter(
      (decision) =>
        decision.decision === 'EXPECTED_MOVE_BELOW_COST_THRESHOLD',
    ).length,
    rejectedForPortfolioRiskCount: decisions.filter(
      (decision) => decision.decision === 'PORTFOLIO_RISK_LIMIT',
    ).length,
    rejectedForCorrelationRiskCount: decisions.filter(
      (decision) => decision.decision === 'CORRELATION_RISK_LIMIT',
    ).length,
    startingEquity: input.policy.initialEquity,
    endingEquity: equity,
    totalReturnPercent:
      ((equity - input.policy.initialEquity) / input.policy.initialEquity) *
      100,
    returnMetrics: calculateStrategyReturnMetrics(acceptedEquityReturns),
    decisions: Object.freeze(decisions),
    liveOrderExecutionAllowed: false,
  });
};
