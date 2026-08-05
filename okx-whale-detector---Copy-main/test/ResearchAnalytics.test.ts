import { describe, expect, it } from 'vitest';

import {
  calculateBacktestStatistics,
  type BacktestTradeRecord,
} from '../src/backtest/BacktestStatistics';
import {
  buildResearchAnalyticsReport,
  renderResearchAnalyticsCli,
  renderResearchAnalyticsHtml,
} from '../src/analytics/ResearchAnalytics';

const day = 24 * 60 * 60 * 1_000;
const start = Date.UTC(2026, 0, 1);

const trades: readonly BacktestTradeRecord[] = [
  {
    id: 'trade-1',
    openedAt: start,
    closedAt: start + day,
    grossPnl: 120,
    feeCost: 10,
    fundingPnl: -2,
    netPnl: 108,
    initialRisk: 100,
  },
  {
    id: 'trade-2',
    openedAt: start + day,
    closedAt: start + 2 * day,
    grossPnl: -60,
    feeCost: 10,
    fundingPnl: 0,
    netPnl: -70,
    initialRisk: 100,
  },
  {
    id: 'trade-3',
    openedAt: start + 31 * day,
    closedAt: start + 32 * day,
    grossPnl: 100,
    feeCost: 10,
    fundingPnl: 2,
    netPnl: 92,
    initialRisk: 100,
  },
];

describe('ResearchAnalytics', () => {
  it('builds one immutable report for CLI and web views', () => {
    const statistics = calculateBacktestStatistics({
      initialEquity: 10_000,
      trades,
    });
    const report = buildResearchAnalyticsReport({
      generatedAt: start + 33 * day,
      statistics,
      trades,
      exposure: [
        {
          timestamp: start,
          grossExposure: 2_000,
          netExposure: 1_000,
          leverage: 0.2,
        },
      ],
      rollingWindow: 2,
    });

    expect(report.dailyReturns.length).toBeGreaterThan(1);
    expect(report.monthlyReturns.map((value) => value.period)).toEqual([
      '2026-01',
      '2026-02',
    ]);
    expect(report.rollingSharpe).toHaveLength(statistics.equityCurve.length);
    expect(report.tradeDistribution.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(
      trades.length,
    );
    expect(report.liveExecutionAllowed).toBe(false);

    const cli = renderResearchAnalyticsCli(report);
    const html = renderResearchAnalyticsHtml(report);

    expect(cli).toContain('QUANTITATIVE RESEARCH REPORT');
    expect(cli).toContain('Live execution is disabled');
    expect(html).toContain('Quantitative Research Dashboard');
    expect(html).toContain('Equity curve');
    expect(html).toContain('liveExecutionAllowed');
  });

  it('rejects invalid rolling windows', () => {
    const statistics = calculateBacktestStatistics({
      initialEquity: 10_000,
      trades,
    });

    expect(() =>
      buildResearchAnalyticsReport({
        generatedAt: start,
        statistics,
        trades,
        rollingWindow: 1,
      }),
    ).toThrow('rolling window must be a safe integer of at least 2');
  });
});
