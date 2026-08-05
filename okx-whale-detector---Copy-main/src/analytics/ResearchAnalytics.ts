import { createServer, type Server } from 'node:http';

import type {
  BacktestStatistics,
  BacktestTradeRecord,
  EquityCurvePoint,
} from '../backtest/BacktestStatistics';

export interface ExposurePoint {
  readonly timestamp: number;
  readonly grossExposure: number;
  readonly netExposure: number;
  readonly leverage: number;
}

export interface PeriodReturn {
  readonly period: string;
  readonly returnPercent: number;
}

export interface RollingMetricPoint {
  readonly timestamp: number;
  readonly value: number | null;
}

export interface TradeDistributionBucket {
  readonly minimumR: number;
  readonly maximumR: number;
  readonly count: number;
}

export interface ResearchAnalyticsReport {
  readonly generatedAt: number;
  readonly statistics: BacktestStatistics;
  readonly dailyReturns: readonly PeriodReturn[];
  readonly monthlyReturns: readonly PeriodReturn[];
  readonly rollingSharpe: readonly RollingMetricPoint[];
  readonly rollingDrawdownPercent: readonly RollingMetricPoint[];
  readonly exposure: readonly ExposurePoint[];
  readonly tradeDistribution: readonly TradeDistributionBucket[];
  readonly liveExecutionAllowed: false;
}

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleStandardDeviation = (values: readonly number[]): number | null => {
  if (values.length < 2) {
    return null;
  }
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return variance > 0 ? Math.sqrt(variance) : null;
};

const periodKey = (timestamp: number, mode: 'DAY' | 'MONTH'): string => {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  if (mode === 'MONTH') {
    return `${year}-${month}`;
  }
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const calculatePeriodReturns = (
  equityCurve: readonly EquityCurvePoint[],
  mode: 'DAY' | 'MONTH',
): readonly PeriodReturn[] => {
  const periods = new Map<string, { first: number; last: number }>();
  for (const point of equityCurve) {
    const key = periodKey(point.timestamp, mode);
    const existing = periods.get(key);
    if (existing === undefined) {
      periods.set(key, { first: point.equity, last: point.equity });
    } else {
      existing.last = point.equity;
    }
  }
  return [...periods.entries()]
    .map(([period, values]) => ({
      period,
      returnPercent:
        values.first === 0 ? 0 : ((values.last - values.first) / values.first) * 100,
    }))
    .sort((left, right) => left.period.localeCompare(right.period));
};

const calculateRollingMetrics = (
  equityCurve: readonly EquityCurvePoint[],
  window: number,
): {
  readonly rollingSharpe: readonly RollingMetricPoint[];
  readonly rollingDrawdownPercent: readonly RollingMetricPoint[];
} => {
  if (!Number.isSafeInteger(window) || window < 2) {
    throw new Error('rolling window must be a safe integer of at least 2');
  }
  const returns: number[] = [];
  const rollingSharpe: RollingMetricPoint[] = [];
  const rollingDrawdownPercent: RollingMetricPoint[] = [];
  for (let index = 0; index < equityCurve.length; index += 1) {
    const current = equityCurve[index];
    const previous = equityCurve[index - 1];
    if (current === undefined) {
      continue;
    }
    if (previous !== undefined && previous.equity !== 0) {
      returns.push((current.equity - previous.equity) / previous.equity);
    }
    const windowReturns = returns.slice(Math.max(0, returns.length - window));
    const deviation = sampleStandardDeviation(windowReturns);
    rollingSharpe.push({
      timestamp: current.timestamp,
      value:
        deviation === null || deviation === 0
          ? null
          : (mean(windowReturns) / deviation) * Math.sqrt(365.25),
    });
    const windowPoints = equityCurve.slice(Math.max(0, index - window + 1), index + 1);
    const peak = Math.max(...windowPoints.map((point) => point.equity));
    rollingDrawdownPercent.push({
      timestamp: current.timestamp,
      value: peak <= 0 ? null : ((peak - current.equity) / peak) * 100,
    });
  }
  return { rollingSharpe, rollingDrawdownPercent };
};

const calculateTradeDistribution = (
  trades: readonly BacktestTradeRecord[],
): readonly TradeDistributionBucket[] => {
  const boundaries = [-Infinity, -2, -1, 0, 1, 2, Infinity];
  return boundaries.slice(0, -1).map((minimumR, index) => {
    const maximumR = boundaries[index + 1] ?? Infinity;
    return {
      minimumR,
      maximumR,
      count: trades.filter((trade) => {
        const r = trade.netPnl / trade.initialRisk;
        return r >= minimumR && r < maximumR;
      }).length,
    };
  });
};

export const buildResearchAnalyticsReport = (input: {
  readonly generatedAt: number;
  readonly statistics: BacktestStatistics;
  readonly trades: readonly BacktestTradeRecord[];
  readonly exposure?: readonly ExposurePoint[];
  readonly rollingWindow?: number;
}): ResearchAnalyticsReport => {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('generatedAt must be a non-negative safe integer');
  }
  const rolling = calculateRollingMetrics(
    input.statistics.equityCurve,
    input.rollingWindow ?? 20,
  );
  return {
    generatedAt: input.generatedAt,
    statistics: input.statistics,
    dailyReturns: calculatePeriodReturns(input.statistics.equityCurve, 'DAY'),
    monthlyReturns: calculatePeriodReturns(
      input.statistics.equityCurve,
      'MONTH',
    ),
    rollingSharpe: rolling.rollingSharpe,
    rollingDrawdownPercent: rolling.rollingDrawdownPercent,
    exposure: (input.exposure ?? []).slice().sort(
      (left, right) => left.timestamp - right.timestamp,
    ),
    tradeDistribution: calculateTradeDistribution(input.trades),
    liveExecutionAllowed: false,
  };
};

const metric = (value: number | null, digits = 4): string =>
  value === null ? 'N/A' : value.toFixed(digits);

export const renderResearchAnalyticsCli = (
  report: ResearchAnalyticsReport,
): string => {
  const statistics = report.statistics;
  return [
    'QUANTITATIVE RESEARCH REPORT',
    `Generated: ${new Date(report.generatedAt).toISOString()}`,
    `Trades: ${statistics.tradeCount}`,
    `Net profit: ${metric(statistics.netProfit, 2)}`,
    `Win rate: ${metric(statistics.winRate * 100, 2)}%`,
    `Profit factor: ${metric(statistics.profitFactor)}`,
    `Expectancy: ${metric(statistics.expectancy)}`,
    `Sharpe: ${metric(statistics.sharpeRatio)}`,
    `Sortino: ${metric(statistics.sortinoRatio)}`,
    `Maximum drawdown: ${metric(statistics.maximumDrawdownPercent * 100, 2)}%`,
    `Recovery factor: ${metric(statistics.recoveryFactor)}`,
    `Average R: ${metric(statistics.averageR)}`,
    `Fees: ${metric(statistics.totalFees, 2)}`,
    `Funding PnL: ${metric(statistics.totalFundingPnl, 2)}`,
    'Research analytics only. Live execution is disabled.',
  ].join('\n');
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const svgPolyline = (
  points: readonly { readonly timestamp: number; readonly value: number }[],
  width: number,
  height: number,
): string => {
  if (points.length === 0) {
    return '';
  }
  const minimum = Math.min(...points.map((point) => point.value));
  const maximum = Math.max(...points.map((point) => point.value));
  const range = maximum - minimum || 1;
  return points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width;
      const y = height - ((point.value - minimum) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
};

export const renderResearchAnalyticsHtml = (
  report: ResearchAnalyticsReport,
): string => {
  const statistics = report.statistics;
  const equityPoints = svgPolyline(
    statistics.equityCurve.map((point) => ({
      timestamp: point.timestamp,
      value: point.equity,
    })),
    900,
    260,
  );
  const drawdownPoints = svgPolyline(
    statistics.equityCurve.map((point) => ({
      timestamp: point.timestamp,
      value: point.drawdownPercent * 100,
    })),
    900,
    180,
  );
  const cards = [
    ['Trades', String(statistics.tradeCount)],
    ['Net profit', metric(statistics.netProfit, 2)],
    ['Win rate', `${metric(statistics.winRate * 100, 2)}%`],
    ['Profit factor', metric(statistics.profitFactor)],
    ['Sharpe', metric(statistics.sharpeRatio)],
    ['Sortino', metric(statistics.sortinoRatio)],
    ['Max drawdown', `${metric(statistics.maximumDrawdownPercent * 100, 2)}%`],
    ['Recovery', metric(statistics.recoveryFactor)],
  ]
    .map(
      ([label, value]) =>
        `<article><span>${escapeHtml(label ?? '')}</span><strong>${escapeHtml(value ?? '')}</strong></article>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quantitative Research Dashboard</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#111;color:#eee}main{max-width:1100px;margin:auto;padding:24px}section{background:#1b1b1b;padding:18px;margin:16px 0;border-radius:12px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.cards article{background:#262626;padding:14px;border-radius:10px}.cards span{display:block;color:#aaa}.cards strong{font-size:1.4rem}svg{width:100%;height:auto;background:#0b0b0b;border-radius:8px}polyline{fill:none;stroke:currentColor;stroke-width:2}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#bbb}</style>
</head>
<body><main>
<h1>Quantitative Research Dashboard</h1>
<p>Generated ${escapeHtml(new Date(report.generatedAt).toISOString())}. Research analytics only; live execution is disabled.</p>
<section class="cards">${cards}</section>
<section><h2>Equity curve</h2><svg viewBox="0 0 900 260"><polyline points="${equityPoints}" /></svg></section>
<section><h2>Rolling drawdown</h2><svg viewBox="0 0 900 180"><polyline points="${drawdownPoints}" /></svg></section>
<section><h2>Complete report</h2><pre id="report"></pre></section>
<script>document.getElementById('report').textContent=${JSON.stringify(JSON.stringify(report, null, 2))};</script>
</main></body></html>`;
};

export const createResearchAnalyticsServer = (input: {
  readonly report: ResearchAnalyticsReport;
}): Server =>
  createServer((request, response) => {
    if (request.url === '/api/report') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(input.report));
      return;
    }
    if (request.url === '/' || request.url === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(renderResearchAnalyticsHtml(input.report));
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
