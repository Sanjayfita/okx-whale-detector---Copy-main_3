import { describe, expect, it } from 'vitest';

import { classifyMarketRegime } from '../src/regime/ExplainableMarketRegimeEngine';

const baseObservation = {
  instrumentId: 'BTC-USDT-SWAP',
  observedAt: 1_700_000_000_000,
  directionalReturnPercent: 0,
  trendEfficiency: 0.1,
  realizedVolatilityPercent: 40,
  volatilityPercentile: 0.5,
  atrCompressionRatio: 1,
  fundingRate: 0,
  fundingAccelerationPerHour: 0,
  liquidationNotionalZScore: 0,
  liquidationDirection: 'BALANCED' as const,
  openInterestMomentumPercent: 0,
};

describe('classifyMarketRegime', () => {
  it('classifies a bullish high-volatility funding squeeze with explanations', () => {
    const decision = classifyMarketRegime({
      observation: {
        ...baseObservation,
        directionalReturnPercent: 1.2,
        trendEfficiency: 0.7,
        volatilityPercentile: 0.9,
        atrCompressionRatio: 1.5,
        fundingRate: 0.0008,
        fundingAccelerationPerHour: 0.00008,
        openInterestMomentumPercent: 4,
      },
    });

    expect(decision.directionalRegime).toBe('TRENDING_BULL');
    expect(decision.overlays).toEqual([
      'HIGH_VOLATILITY',
      'FUNDING_SQUEEZE',
      'EXPANSION',
    ]);
    expect(decision.activeStrategyFamilies).toContain('TREND_FOLLOWING');
    expect(decision.activeStrategyFamilies).toContain('DERIVATIVES_FLOW');
    expect(decision.blockedStrategyFamilies).toContain('MEAN_REVERSION');
    expect(decision.explanations.join(' ')).toContain('TRENDING_BULL');
    expect(decision.confidence).toBeGreaterThan(0.8);
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('activates mean reversion and breakout during sideways compression', () => {
    const decision = classifyMarketRegime({
      observation: {
        ...baseObservation,
        directionalReturnPercent: 0.1,
        trendEfficiency: 0.12,
        volatilityPercentile: 0.2,
        atrCompressionRatio: 0.6,
      },
    });

    expect(decision.directionalRegime).toBe('SIDEWAYS');
    expect(decision.overlays).toEqual(['LOW_VOLATILITY', 'COMPRESSION']);
    expect(decision.activeStrategyFamilies).toContain('MEAN_REVERSION');
    expect(decision.activeStrategyFamilies).toContain('BREAKOUT');
    expect(decision.blockedStrategyFamilies).toContain('TREND_FOLLOWING');
  });

  it('blocks mean reversion during a liquidation cascade', () => {
    const decision = classifyMarketRegime({
      observation: {
        ...baseObservation,
        liquidationNotionalZScore: 4.2,
        liquidationDirection: 'LONGS',
        openInterestMomentumPercent: -8,
      },
    });

    expect(decision.overlays).toContain('LIQUIDATION_CASCADE');
    expect(decision.activeStrategyFamilies).toContain('DERIVATIVES_FLOW');
    expect(decision.blockedStrategyFamilies).toContain('MEAN_REVERSION');
    expect(decision.explanations.join(' ')).toContain('longs liquidation');
  });
});
