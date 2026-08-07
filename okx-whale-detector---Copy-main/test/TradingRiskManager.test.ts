import { describe, expect, it } from 'vitest';
import {
  TradingRiskManager,
  type RiskAccountSnapshot,
} from '../src/risk/TradingRiskManager';

const snapshot = (
  overrides: Partial<RiskAccountSnapshot> = {},
): RiskAccountSnapshot => ({
  timestamp: 1_000_000,
  startingDayEquity: 10_000,
  currentEquity: 10_000,
  peakEquity: 10_000,
  openPositions: 0,
  tradesToday: 0,
  realizedPnlToday: 0,
  requestedRiskPercent: 1,
  requestedLeverage: 2,
  ...overrides,
});

describe('TradingRiskManager', () => {
  it('allows a trade inside all default limits', () => {
    const manager = new TradingRiskManager();
    expect(manager.evaluateNewTrade(snapshot()).allowed).toBe(true);
  });

  it('fails closed across account, leverage and activity limits', () => {
    const manager = new TradingRiskManager();
    const decision = manager.evaluateNewTrade(
      snapshot({
        currentEquity: 8_500,
        peakEquity: 10_000,
        realizedPnlToday: -400,
        openPositions: 3,
        tradesToday: 12,
        requestedRiskPercent: 1.1,
        requestedLeverage: 6,
      }),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'RISK_PER_TRADE_EXCEEDED',
        'DAILY_LOSS_LIMIT_REACHED',
        'MAXIMUM_DRAWDOWN_REACHED',
        'MAXIMUM_OPEN_POSITIONS_REACHED',
        'MAXIMUM_LEVERAGE_EXCEEDED',
        'DAILY_TRADE_LIMIT_REACHED',
      ]),
    );
  });

  it('supports cooldown, circuit breaker and manual kill switch', () => {
    const manager = new TradingRiskManager();
    for (let index = 0; index < 4; index += 1) {
      manager.recordClosedTrade({ closedAt: 900_000 + index, netPnl: -10 });
    }
    manager.setKillSwitch(true);

    const decision = manager.evaluateNewTrade(snapshot());
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        'KILL_SWITCH_ACTIVE',
        'CIRCUIT_BREAKER_ACTIVE',
        'LOSS_COOLDOWN_ACTIVE',
      ]),
    );
    expect(manager.getStatus().consecutiveLosses).toBe(4);
  });
});
