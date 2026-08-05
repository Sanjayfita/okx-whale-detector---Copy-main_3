import { describe, expect, it } from 'vitest';

import {
  simulateRiskManagementPolicy,
  type RiskManagementPolicy,
  type RiskResearchTradeObservation,
} from '../src/research/riskManagementResearch';

const policy: RiskManagementPolicy = {
  initialEquity: 10_000,
  fixedRiskFraction: 0.01,
  maximumTradeRiskFraction: 0.02,
  volatilityTargetPercent: 1,
  maximumPositionFraction: 1,
  maximumConcurrentPortfolioRiskFraction: 0.02,
  maximumConcurrentCorrelationRiskFraction: 0.01,
  minimumExpectedMoveCostMultiple: 2,
};

const trade = (
  alertId: string,
  detectedAt: number,
  overrides: Partial<RiskResearchTradeObservation> = {},
): RiskResearchTradeObservation => ({
  alertId,
  instrumentId: 'BTC-USDT',
  correlationGroup: 'CRYPTO-MAJOR',
  detectedAt,
  exitedAt: detectedAt + 60_000,
  expectedMovePercent: 1,
  estimatedTotalCostPercent: 0.2,
  stopDistancePercent: 1,
  volatilityPercent: 1,
  realizedNetReturnPercent: 1,
  ...overrides,
});

describe('risk management research', () => {
  it('applies cost, portfolio, and correlation gates chronologically', () => {
    const start = 1_800_000_000_000;
    const report = simulateRiskManagementPolicy({
      policy: {
        ...policy,
        maximumConcurrentPortfolioRiskFraction: 0.02,
        maximumConcurrentCorrelationRiskFraction: 0.015,
      },
      trades: [
        trade('accepted-1', start, { exitedAt: start + 10 * 60_000 }),
        trade('cost-rejected', start + 60_000, {
          instrumentId: 'XRP-USDT',
          correlationGroup: 'ALT',
          expectedMovePercent: 0.3,
          estimatedTotalCostPercent: 0.2,
        }),
        trade('correlation-rejected', start + 2 * 60_000),
        trade('accepted-diversifier', start + 3 * 60_000, {
          instrumentId: 'XAU-USDT',
          correlationGroup: 'METALS',
          volatilityPercent: 2,
          realizedNetReturnPercent: 0,
          exitedAt: start + 10 * 60_000,
        }),
        trade('portfolio-rejected', start + 4 * 60_000, {
          instrumentId: 'SOL-USDT',
          correlationGroup: 'ALT',
        }),
        trade('accepted-after-close', start + 11 * 60_000, {
          realizedNetReturnPercent: -0.5,
        }),
      ],
    });

    expect(report.inputTradeCount).toBe(6);
    expect(report.acceptedTradeCount).toBe(3);
    expect(report.rejectedForCostCount).toBe(1);
    expect(report.rejectedForCorrelationRiskCount).toBe(1);
    expect(report.rejectedForPortfolioRiskCount).toBe(1);
    expect(report.decisions.map((decision) => decision.decision)).toEqual([
      'ACCEPTED',
      'EXPECTED_MOVE_BELOW_COST_THRESHOLD',
      'CORRELATION_RISK_LIMIT',
      'ACCEPTED',
      'PORTFOLIO_RISK_LIMIT',
      'ACCEPTED',
    ]);
    expect(report.endingEquity).toBeCloseTo(10_049.5);
    expect(report.totalReturnPercent).toBeCloseTo(0.495);
    expect(report.returnMetrics.sampleSize).toBe(3);
    expect(report.liveOrderExecutionAllowed).toBe(false);
  });

  it('does not use unresolved future PnL to size overlapping trades', () => {
    const start = 1_800_000_000_000;
    const report = simulateRiskManagementPolicy({
      policy,
      trades: [
        trade('overlap-1', start, {
          correlationGroup: 'GROUP-A',
          exitedAt: start + 10 * 60_000,
          realizedNetReturnPercent: 10,
        }),
        trade('overlap-2', start + 60_000, {
          instrumentId: 'ETH-USDT',
          correlationGroup: 'GROUP-B',
          exitedAt: start + 11 * 60_000,
          realizedNetReturnPercent: 10,
        }),
      ],
    });

    expect(report.acceptedTradeCount).toBe(2);
    expect(report.decisions[0]?.equityBefore).toBe(10_000);
    expect(report.decisions[1]?.equityBefore).toBe(10_000);
    expect(report.decisions[1]?.pnl).toBe(1_000);
    expect(report.endingEquity).toBe(12_000);
  });

  it('uses effective risk after the maximum-position cap', () => {
    const report = simulateRiskManagementPolicy({
      policy: {
        ...policy,
        maximumPositionFraction: 0.25,
        maximumConcurrentPortfolioRiskFraction: 0.01,
        maximumConcurrentCorrelationRiskFraction: 0.01,
      },
      trades: [trade('position-capped', 1_800_000_000_000)],
    });

    expect(report.decisions[0]?.positionFraction).toBe(0.25);
    expect(report.decisions[0]?.riskFraction).toBeCloseTo(0.0025);
    expect(report.endingEquity).toBeCloseTo(10_025);
  });

  it('reduces risk in volatility above the target', () => {
    const report = simulateRiskManagementPolicy({
      policy,
      trades: [
        trade('high-volatility', 1_800_000_000_000, {
          volatilityPercent: 4,
          stopDistancePercent: 2,
        }),
      ],
    });

    expect(report.decisions[0]?.riskFraction).toBeCloseTo(0.0025);
    expect(report.decisions[0]?.positionFraction).toBeCloseTo(0.125);
    expect(report.endingEquity).toBeCloseTo(10_012.5);
  });

  it('rejects invalid policy relationships and duplicate trades', () => {
    expect(() =>
      simulateRiskManagementPolicy({
        policy: {
          ...policy,
          maximumConcurrentCorrelationRiskFraction: 0.03,
        },
        trades: [],
      }),
    ).toThrow(/Correlation risk limit cannot exceed/);

    const duplicate = trade('duplicate', 1_800_000_000_000);
    expect(() =>
      simulateRiskManagementPolicy({
        policy,
        trades: [duplicate, duplicate],
      }),
    ).toThrow(/Duplicate risk-research trade/);
  });
});
