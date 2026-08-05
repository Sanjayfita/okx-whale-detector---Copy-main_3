import { describe, expect, it } from 'vitest';

import {
  evaluateProfessionalRisk,
  type PortfolioRiskState,
  type ProposedDerivativeTrade,
} from '../src/risk/ProfessionalRiskManager';

const state = (
  override: Partial<PortfolioRiskState> = {},
): PortfolioRiskState => ({
  equity: 10_000,
  peakEquity: 10_000,
  sessionStartingEquity: 10_000,
  sessionRealizedPnl: 0,
  consecutiveLosses: 0,
  activePortfolioRiskFraction: 0,
  activeCorrelationRiskFraction: 0,
  ...override,
});

const trade = (
  override: Partial<ProposedDerivativeTrade> = {},
): ProposedDerivativeTrade => ({
  instrumentId: 'BTC-USDT-SWAP',
  correlationGroup: 'CRYPTO-MAJORS',
  direction: 'LONG',
  observedAt: 1_700_000_000_000,
  evaluatedAt: 1_700_000_001_000,
  entryPrice: 100,
  stopPrice: 98,
  atrPercent: 1,
  spreadBps: 2,
  expectedMovePercent: 1,
  estimatedRoundTripCostPercent: 0.1,
  estimatedLiquidationDistancePercent: 20,
  baseUnitsPerContract: 0.01,
  lotSizeContracts: 1,
  minimumContracts: 1,
  ...override,
});

describe('ProfessionalRiskManager', () => {
  it('sizes contracts from fixed fractional risk and stop distance', () => {
    const decision = evaluateProfessionalRisk({
      trade: trade(),
      state: state(),
    });

    expect(decision.status).toBe('APPROVED_FOR_PAPER_RESEARCH');
    expect(decision.requestedRiskAmount).toBeCloseTo(50, 8);
    expect(decision.positionNotional).toBeCloseTo(2_500, 8);
    expect(decision.contracts).toBe(2_500);
    expect(decision.effectiveRiskAmount).toBeCloseTo(50, 8);
    expect(decision.effectiveRiskFraction).toBeCloseTo(0.005, 8);
    expect(decision.impliedLeverage).toBeCloseTo(0.25, 8);
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('reduces risk when volatility is above target', () => {
    const decision = evaluateProfessionalRisk({
      trade: trade({ atrPercent: 4 }),
      state: state(),
    });

    expect(decision.status).toBe('APPROVED_FOR_PAPER_RESEARCH');
    expect(decision.volatilityScale).toBe(0.25);
    expect(decision.requestedRiskAmount).toBeCloseTo(12.5, 8);
    expect(decision.positionNotional).toBeCloseTo(625, 8);
  });

  it('blocks trading after daily loss, drawdown, or consecutive-loss limits', () => {
    expect(
      evaluateProfessionalRisk({
        trade: trade(),
        state: state({ sessionRealizedPnl: -250 }),
      }).rejectionReasons,
    ).toContain('DAILY_LOSS_CIRCUIT_BREAKER');

    expect(
      evaluateProfessionalRisk({
        trade: trade(),
        state: state({ equity: 9_000, peakEquity: 10_000 }),
      }).rejectionReasons,
    ).toContain('MAXIMUM_DRAWDOWN_CIRCUIT_BREAKER');

    expect(
      evaluateProfessionalRisk({
        trade: trade(),
        state: state({ consecutiveLosses: 3 }),
      }).rejectionReasons,
    ).toContain('CONSECUTIVE_LOSS_CIRCUIT_BREAKER');
  });

  it('blocks stale, expensive, illiquid, and unsafe-liquidation proposals', () => {
    const decision = evaluateProfessionalRisk({
      trade: trade({
        evaluatedAt: 1_700_000_010_000,
        spreadBps: 12,
        expectedMovePercent: 0.2,
        estimatedRoundTripCostPercent: 0.1,
        estimatedLiquidationDistancePercent: 3,
      }),
      state: state(),
    });

    expect(decision.rejectionReasons).toContain('STALE_MARKET_DATA');
    expect(decision.rejectionReasons).toContain('SPREAD_TOO_WIDE');
    expect(decision.rejectionReasons).toContain(
      'EXPECTED_MOVE_BELOW_COST_THRESHOLD',
    );
    expect(decision.rejectionReasons).toContain(
      'STOP_BEYOND_SAFE_LIQUIDATION_BUFFER',
    );
  });

  it('enforces concurrent portfolio and correlation risk limits', () => {
    const decision = evaluateProfessionalRisk({
      trade: trade(),
      state: state({
        activePortfolioRiskFraction: 0.022,
        activeCorrelationRiskFraction: 0.009,
      }),
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.rejectionReasons).toContain('PORTFOLIO_RISK_LIMIT');
    expect(decision.rejectionReasons).toContain('CORRELATION_RISK_LIMIT');
    expect(decision.positionNotional).toBeGreaterThan(0);
  });

  it('rejects a risk-sized position below exchange minimum contracts', () => {
    const decision = evaluateProfessionalRisk({
      trade: trade({
        entryPrice: 10_000,
        stopPrice: 9_800,
        baseUnitsPerContract: 1,
        minimumContracts: 10,
      }),
      state: state(),
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.rejectionReasons).toEqual([
      'POSITION_BELOW_EXCHANGE_MINIMUM',
    ]);
  });

  it('requires a stop on the invalidation side of the entry', () => {
    expect(() =>
      evaluateProfessionalRisk({
        trade: trade({ stopPrice: 101 }),
        state: state(),
      }),
    ).toThrow('stopPrice must invalidate the proposed trade direction');
  });
});
