import { describe, expect, it } from 'vitest';

import {
  calculateBacktestStatistics,
  type BacktestTradeRecord,
} from '../src/backtest/BacktestStatistics';

const trade = (
  id: string,
  openedAt: number,
  netPnl: number,
): BacktestTradeRecord => ({
  id,
  openedAt,
  closedAt: openedAt + 1_000,
  grossPnl: netPnl + 1,
  feeCost: 1,
  fundingPnl: 0,
  netPnl,
  initialRisk: 50,
});

describe('calculateBacktestStatistics', () => {
  it('reports cost-adjusted profitability, drawdown, R and equity curve', () => {
    const statistics = calculateBacktestStatistics({
      initialEquity: 1_000,
      trades: [
        trade('one', 0, 100),
        trade('two', 2_000, -50),
        trade('three', 4_000, 25),
        trade('four', 6_000, -25),
      ],
    });

    expect(statistics.tradeCount).toBe(4);
    expect(statistics.winRate).toBe(0.5);
    expect(statistics.grossProfit).toBe(125);
    expect(statistics.grossLoss).toBe(75);
    expect(statistics.netProfit).toBe(50);
    expect(statistics.profitFactor).toBeCloseTo(5 / 3, 8);
    expect(statistics.expectancy).toBe(12.5);
    expect(statistics.averageR).toBe(0.25);
    expect(statistics.maximumDrawdown).toBe(50);
    expect(statistics.maximumDrawdownPercent).toBeCloseTo(50 / 1_100, 8);
    expect(statistics.recoveryFactor).toBe(1);
    expect(statistics.averageHoldingTimeMs).toBe(1_000);
    expect(statistics.totalFees).toBe(4);
    expect(statistics.sharpeRatio).not.toBeNull();
    expect(statistics.sortinoRatio).not.toBeNull();
    expect(statistics.equityCurve.at(-1)?.equity).toBe(1_050);
  });

  it('returns honest null ratios when a statistic is not identifiable', () => {
    const statistics = calculateBacktestStatistics({
      initialEquity: 1_000,
      trades: [],
    });

    expect(statistics.tradeCount).toBe(0);
    expect(statistics.profitFactor).toBeNull();
    expect(statistics.averageR).toBeNull();
    expect(statistics.sharpeRatio).toBeNull();
    expect(statistics.sortinoRatio).toBeNull();
    expect(statistics.recoveryFactor).toBeNull();
    expect(statistics.equityCurve).toEqual([
      {
        timestamp: 0,
        equity: 1_000,
        drawdown: 0,
        drawdownPercent: 0,
      },
    ]);
  });

  it('rejects malformed records instead of silently producing metrics', () => {
    expect(() =>
      calculateBacktestStatistics({
        initialEquity: 1_000,
        trades: [{ ...trade('bad', 2_000, 10), closedAt: 1_000 }],
      }),
    ).toThrow('invalid timestamps');
  });
});
