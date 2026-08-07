export interface TradingRiskPolicy {
  /** Maximum planned account-equity risk permitted for one new trade. */
  readonly maximumRiskPerTradePercent: number;
  /** Stop opening new trades after this much realized loss in one UTC day. */
  readonly dailyLossLimitPercent: number;
  /** Stop opening new trades after this peak-to-current equity drawdown. */
  readonly maximumDrawdownPercent: number;
  /** Portfolio-wide cap. A strategy may impose a stricter per-instrument rule. */
  readonly maximumOpenPositions: number;
  /** Prevent immediate revenge/re-entry after a losing close. */
  readonly cooldownAfterLossMs: number;
  /** Hard leverage ceiling used before an order reaches execution simulation. */
  readonly maximumLeverage: number;
  /** Hard UTC-day trade-count ceiling. */
  readonly dailyTradeLimit: number;
  /** Consecutive losing trades that trip the circuit breaker. */
  readonly circuitBreakerLossStreak: number;
}

export const DEFAULT_TRADING_RISK_POLICY: TradingRiskPolicy = Object.freeze({
  maximumRiskPerTradePercent: 1,
  dailyLossLimitPercent: 3,
  maximumDrawdownPercent: 10,
  maximumOpenPositions: 3,
  cooldownAfterLossMs: 30 * 60 * 1_000,
  maximumLeverage: 5,
  dailyTradeLimit: 12,
  circuitBreakerLossStreak: 4,
});

export interface RiskAccountSnapshot {
  readonly timestamp: number;
  readonly startingDayEquity: number;
  readonly currentEquity: number;
  readonly peakEquity: number;
  readonly openPositions: number;
  readonly tradesToday: number;
  readonly realizedPnlToday: number;
  readonly requestedRiskPercent: number;
  readonly requestedLeverage: number;
}

export type RiskBlockReason =
  | 'KILL_SWITCH_ACTIVE'
  | 'CIRCUIT_BREAKER_ACTIVE'
  | 'RISK_PER_TRADE_EXCEEDED'
  | 'DAILY_LOSS_LIMIT_REACHED'
  | 'MAXIMUM_DRAWDOWN_REACHED'
  | 'MAXIMUM_OPEN_POSITIONS_REACHED'
  | 'LOSS_COOLDOWN_ACTIVE'
  | 'MAXIMUM_LEVERAGE_EXCEEDED'
  | 'DAILY_TRADE_LIMIT_REACHED';

export interface RiskDecision {
  readonly allowed: boolean;
  readonly reasons: readonly RiskBlockReason[];
  readonly dailyLossPercent: number;
  readonly drawdownPercent: number;
  readonly killSwitchActive: boolean;
  readonly circuitBreakerActive: boolean;
  readonly cooldownUntil: number | null;
  readonly liveExecutionAllowed: false;
}

export interface TradingRiskStatus {
  readonly killSwitchActive: boolean;
  readonly circuitBreakerActive: boolean;
  readonly consecutiveLosses: number;
  readonly lastLossAt: number | null;
  readonly cooldownUntil: number | null;
  readonly liveExecutionAllowed: false;
}

const requirePositiveFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
};

const requireNonNegativeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

export const validateTradingRiskPolicy = (policy: TradingRiskPolicy): void => {
  requirePositiveFinite(
    policy.maximumRiskPerTradePercent,
    'maximumRiskPerTradePercent',
  );
  requirePositiveFinite(policy.dailyLossLimitPercent, 'dailyLossLimitPercent');
  requirePositiveFinite(policy.maximumDrawdownPercent, 'maximumDrawdownPercent');
  requirePositiveFinite(policy.maximumLeverage, 'maximumLeverage');
  requireNonNegativeInteger(policy.maximumOpenPositions, 'maximumOpenPositions');
  requireNonNegativeInteger(policy.cooldownAfterLossMs, 'cooldownAfterLossMs');
  requireNonNegativeInteger(policy.dailyTradeLimit, 'dailyTradeLimit');
  requireNonNegativeInteger(
    policy.circuitBreakerLossStreak,
    'circuitBreakerLossStreak',
  );

  if (policy.maximumRiskPerTradePercent > 1) {
    throw new Error('maximumRiskPerTradePercent must not exceed 1');
  }
  if (policy.maximumOpenPositions === 0) {
    throw new Error('maximumOpenPositions must be greater than 0');
  }
  if (policy.dailyTradeLimit === 0) {
    throw new Error('dailyTradeLimit must be greater than 0');
  }
  if (policy.circuitBreakerLossStreak === 0) {
    throw new Error('circuitBreakerLossStreak must be greater than 0');
  }
};

const lossPercent = (realizedPnl: number, startingEquity: number): number =>
  realizedPnl < 0 ? (-realizedPnl / startingEquity) * 100 : 0;

const drawdownPercent = (currentEquity: number, peakEquity: number): number =>
  peakEquity > 0
    ? Math.max(0, ((peakEquity - currentEquity) / peakEquity) * 100)
    : 0;

export class TradingRiskManager {
  private killSwitchActive = false;
  private consecutiveLosses = 0;
  private lastLossAt: number | null = null;

  public constructor(
    private readonly policy: TradingRiskPolicy = DEFAULT_TRADING_RISK_POLICY,
  ) {
    validateTradingRiskPolicy(policy);
  }

  public setKillSwitch(active: boolean): void {
    this.killSwitchActive = active;
  }

  public recordClosedTrade(input: {
    readonly closedAt: number;
    readonly netPnl: number;
  }): void {
    requireNonNegativeInteger(input.closedAt, 'closedAt');
    if (!Number.isFinite(input.netPnl)) {
      throw new Error('netPnl must be finite');
    }

    if (input.netPnl < 0) {
      this.consecutiveLosses += 1;
      this.lastLossAt = input.closedAt;
    } else {
      this.consecutiveLosses = 0;
    }
  }

  public evaluateNewTrade(snapshot: RiskAccountSnapshot): RiskDecision {
    requireNonNegativeInteger(snapshot.timestamp, 'timestamp');
    requirePositiveFinite(snapshot.startingDayEquity, 'startingDayEquity');
    requirePositiveFinite(snapshot.currentEquity, 'currentEquity');
    requirePositiveFinite(snapshot.peakEquity, 'peakEquity');
    requirePositiveFinite(snapshot.requestedRiskPercent, 'requestedRiskPercent');
    requirePositiveFinite(snapshot.requestedLeverage, 'requestedLeverage');
    requireNonNegativeInteger(snapshot.openPositions, 'openPositions');
    requireNonNegativeInteger(snapshot.tradesToday, 'tradesToday');
    if (!Number.isFinite(snapshot.realizedPnlToday)) {
      throw new Error('realizedPnlToday must be finite');
    }

    const reasons: RiskBlockReason[] = [];
    const dailyLoss = lossPercent(
      snapshot.realizedPnlToday,
      snapshot.startingDayEquity,
    );
    const drawdown = drawdownPercent(
      snapshot.currentEquity,
      snapshot.peakEquity,
    );
    const circuitBreakerActive =
      this.consecutiveLosses >= this.policy.circuitBreakerLossStreak;
    const cooldownUntil =
      this.lastLossAt === null
        ? null
        : this.lastLossAt + this.policy.cooldownAfterLossMs;

    if (this.killSwitchActive) reasons.push('KILL_SWITCH_ACTIVE');
    if (circuitBreakerActive) reasons.push('CIRCUIT_BREAKER_ACTIVE');
    if (snapshot.requestedRiskPercent > this.policy.maximumRiskPerTradePercent) {
      reasons.push('RISK_PER_TRADE_EXCEEDED');
    }
    if (dailyLoss >= this.policy.dailyLossLimitPercent) {
      reasons.push('DAILY_LOSS_LIMIT_REACHED');
    }
    if (drawdown >= this.policy.maximumDrawdownPercent) {
      reasons.push('MAXIMUM_DRAWDOWN_REACHED');
    }
    if (snapshot.openPositions >= this.policy.maximumOpenPositions) {
      reasons.push('MAXIMUM_OPEN_POSITIONS_REACHED');
    }
    if (cooldownUntil !== null && snapshot.timestamp < cooldownUntil) {
      reasons.push('LOSS_COOLDOWN_ACTIVE');
    }
    if (snapshot.requestedLeverage > this.policy.maximumLeverage) {
      reasons.push('MAXIMUM_LEVERAGE_EXCEEDED');
    }
    if (snapshot.tradesToday >= this.policy.dailyTradeLimit) {
      reasons.push('DAILY_TRADE_LIMIT_REACHED');
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      dailyLossPercent: dailyLoss,
      drawdownPercent: drawdown,
      killSwitchActive: this.killSwitchActive,
      circuitBreakerActive,
      cooldownUntil,
      liveExecutionAllowed: false,
    };
  }

  public getStatus(): TradingRiskStatus {
    return {
      killSwitchActive: this.killSwitchActive,
      circuitBreakerActive:
        this.consecutiveLosses >= this.policy.circuitBreakerLossStreak,
      consecutiveLosses: this.consecutiveLosses,
      lastLossAt: this.lastLossAt,
      cooldownUntil:
        this.lastLossAt === null
          ? null
          : this.lastLossAt + this.policy.cooldownAfterLossMs,
      liveExecutionAllowed: false,
    };
  }

  public getPolicy(): TradingRiskPolicy {
    return { ...this.policy };
  }
}
