import { describe, expect, it } from 'vitest';
import { calculatePerformanceAnalytics } from '../src/analytics/PerformanceAnalytics';

describe('calculatePerformanceAnalytics', () => {
  it('calculates journal, drawdown, return and R metrics', () => {
    const report = calculatePerformanceAnalytics({
      trades: [
        { openedAt: 1_000, closedAt: 2_000, netPnl: 200, riskAmount: 100 },
        { openedAt: 3_000, closedAt: 4_000, netPnl: -100, riskAmount: 100 },
        { openedAt: 5_000, closedAt: 6_000, netPnl: 50, riskAmount: 100 },
      ],
      equityCurve: [
        { timestamp: 0, equity: 10_000 },
        { timestamp: 86_400_000, equity: 10_200 },
        { timestamp: 172_800_000, equity: 10_100 },
        { timestamp: 259_200_000, equity: 10_150 },
      ],
    });

    expect(report.trades).toBe(3);
    expect(report.wins).toBe(2);
    expect(report.losses).toBe(1);
    expect(report.netPnl).toBe(150);
    expect(report.profitFactor).toBe(2.5);
    expect(report.expectancy).toBe(50);
    expect(report.averageR).toBeCloseTo(0.5);
    expect(report.maximumDrawdownPercent).toBeGreaterThan(0);
    expect(report.dailyReturnsPercent.length).toBeGreaterThan(1);
    expect(report.returnDistribution.length).toBeGreaterThan(0);
    expect(report.rMultipleDistribution.length).toBeGreaterThan(0);
    expect(report.heatmap).toHaveLength(1);
  });
});
