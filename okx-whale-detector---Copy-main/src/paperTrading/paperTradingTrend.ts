import type { PaperRiskStatus } from './paperRiskControls';
import type { PaperTradingDocument } from './paperTradingPersistence';

export type PaperTradingTrendDirection = 'IMPROVING' | 'STABLE' | 'DETERIORATING';

export interface PaperTradingTrendPoint {
  generatedAt: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  drawdownPercent: number;
  riskStatus: PaperRiskStatus;
}

export interface PaperTradingTrendSummary {
  direction: PaperTradingTrendDirection;
  points: readonly PaperTradingTrendPoint[];
  equityChange: number;
  realizedPnlChange: number;
  unrealizedPnlChange: number;
  drawdownPercentChange: number;
  bestEquity: number;
  worstEquity: number;
  maximumDrawdownPercent: number;
  riskEscalations: number;
  riskImprovements: number;
  reasons: readonly string[];
}

const RISK_RANK: Readonly<Record<PaperRiskStatus, number>> = Object.freeze({
  ALLOWED: 0,
  WARNING: 1,
  BLOCKED: 2,
});

export const summarizePaperTradingTrend = (
  documents: readonly PaperTradingDocument[],
): PaperTradingTrendSummary => {
  if (documents.length < 2) {
    throw new Error('At least two paper trading documents are required');
  }

  const sorted = [...documents].sort(
    (left, right) => left.valuation.generatedAt - right.valuation.generatedAt,
  );
  const initialCash = sorted[0]!.portfolio.initialCash;
  const timestamps = new Set<number>();

  for (const document of sorted) {
    if (document.portfolio.initialCash !== initialCash) {
      throw new Error('Paper trading documents must use the same initial cash');
    }
    const timestamp = document.valuation.generatedAt;
    if (timestamps.has(timestamp)) {
      throw new Error(`Duplicate paper trading timestamp: ${timestamp}`);
    }
    timestamps.add(timestamp);
  }

  const points = sorted.map((document): PaperTradingTrendPoint =>
    Object.freeze({
      generatedAt: document.valuation.generatedAt,
      equity: document.valuation.equity,
      realizedPnl: document.valuation.realizedPnl,
      unrealizedPnl: document.valuation.unrealizedPnl,
      drawdownPercent: document.risk.drawdownPercent,
      riskStatus: document.risk.status,
    }),
  );

  let riskEscalations = 0;
  let riskImprovements = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const delta = RISK_RANK[current.riskStatus] - RISK_RANK[previous.riskStatus];
    if (delta > 0) riskEscalations += 1;
    if (delta < 0) riskImprovements += 1;
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const equityChange = last.equity - first.equity;
  const drawdownPercentChange = last.drawdownPercent - first.drawdownPercent;
  const reasons: string[] = [];

  let direction: PaperTradingTrendDirection;
  if (
    riskEscalations > riskImprovements ||
    (equityChange < 0 && drawdownPercentChange >= 0)
  ) {
    direction = 'DETERIORATING';
    reasons.push('Risk increased or equity declined without a drawdown improvement');
  } else if (
    riskImprovements > riskEscalations ||
    (equityChange > 0 && drawdownPercentChange <= 0)
  ) {
    direction = 'IMPROVING';
    reasons.push('Risk improved or equity increased without increasing drawdown');
  } else {
    direction = 'STABLE';
    reasons.push('Portfolio quality did not change decisively across the series');
  }

  return Object.freeze({
    direction,
    points: Object.freeze(points),
    equityChange,
    realizedPnlChange: last.realizedPnl - first.realizedPnl,
    unrealizedPnlChange: last.unrealizedPnl - first.unrealizedPnl,
    drawdownPercentChange,
    bestEquity: Math.max(...points.map((point) => point.equity)),
    worstEquity: Math.min(...points.map((point) => point.equity)),
    maximumDrawdownPercent: Math.max(
      ...points.map((point) => point.drawdownPercent),
    ),
    riskEscalations,
    riskImprovements,
    reasons: Object.freeze(reasons),
  });
};
