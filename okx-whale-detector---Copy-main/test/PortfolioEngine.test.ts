import { describe, expect, it } from 'vitest';

import { allocatePortfolioCapital } from '../src/portfolio/PortfolioEngine';

describe('allocatePortfolioCapital', () => {
  it('allocates by edge-to-volatility and enforces sector and VaR caps', () => {
    const result = allocatePortfolioCapital({
      state: {
        equity: 10_000,
        peakEquity: 10_000,
        positions: [],
      },
      candidates: [
        {
          instrumentId: 'BTC-USDT-SWAP',
          sector: 'CRYPTO_MAJOR',
          correlationGroup: 'CRYPTO_BETA',
          direction: 'LONG',
          expectedEdge: 0.02,
          dailyVolatility: 0.04,
          maximumNotional: 10_000,
        },
        {
          instrumentId: 'ETH-USDT-SWAP',
          sector: 'CRYPTO_MAJOR',
          correlationGroup: 'CRYPTO_BETA',
          direction: 'LONG',
          expectedEdge: 0.01,
          dailyVolatility: 0.04,
          maximumNotional: 10_000,
        },
      ],
      returnScenarios: [
        {
          timestamp: 1,
          returns: {
            'BTC-USDT-SWAP': -0.1,
            'ETH-USDT-SWAP': -0.1,
          },
        },
        {
          timestamp: 2,
          returns: {
            'BTC-USDT-SWAP': 0.02,
            'ETH-USDT-SWAP': 0.02,
          },
        },
      ],
      policy: {
        maximumLeverage: 3,
        maximumGrossExposureFraction: 1.5,
        maximumNetExposureFraction: 0.75,
        maximumSectorExposureFraction: 0.3,
        maximumCorrelationGroupExposureFraction: 0.65,
        maximumDrawdownFraction: 0.1,
        valueAtRiskConfidence: 0.99,
        maximumValueAtRiskFraction: 0.025,
      },
    });

    expect(result.status).toBe('APPROVED_FOR_PAPER_RESEARCH');
    expect(result.allocations[0]?.instrumentId).toBe('BTC-USDT-SWAP');
    expect(result.grossExposure).toBeCloseTo(2_500, 8);
    expect(result.valueAtRisk).toBeCloseTo(250, 8);
    expect(result.valueAtRiskFraction).toBeCloseTo(0.025, 8);
    expect(result.liveExecutionAllowed).toBe(false);
  });

  it('blocks all new allocation after the portfolio drawdown breaker', () => {
    const result = allocatePortfolioCapital({
      state: {
        equity: 8_900,
        peakEquity: 10_000,
        positions: [],
      },
      candidates: [
        {
          instrumentId: 'BTC-USDT-SWAP',
          sector: 'CRYPTO_MAJOR',
          correlationGroup: 'CRYPTO_BETA',
          direction: 'LONG',
          expectedEdge: 0.02,
          dailyVolatility: 0.04,
          maximumNotional: 1_000,
        },
      ],
      returnScenarios: [],
    });

    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReasons).toEqual(['PORTFOLIO_DRAWDOWN_BREAKER']);
    expect(result.allocations).toEqual([]);
  });

  it('supports hedged long and short contracts under the net exposure cap', () => {
    const result = allocatePortfolioCapital({
      state: {
        equity: 10_000,
        peakEquity: 10_000,
        positions: [],
      },
      candidates: [
        {
          instrumentId: 'BTC-USDT-SWAP',
          sector: 'CRYPTO_MAJOR',
          correlationGroup: 'BTC',
          direction: 'LONG',
          expectedEdge: 0.02,
          dailyVolatility: 0.04,
          maximumNotional: 4_000,
        },
        {
          instrumentId: 'ETH-USDT-SWAP',
          sector: 'CRYPTO_MAJOR',
          correlationGroup: 'ETH',
          direction: 'SHORT',
          expectedEdge: 0.02,
          dailyVolatility: 0.04,
          maximumNotional: 4_000,
        },
      ],
      returnScenarios: [],
    });

    expect(Math.abs(result.netExposure)).toBeLessThanOrEqual(7_500);
    expect(result.grossExposure).toBeGreaterThan(0);
  });
});
