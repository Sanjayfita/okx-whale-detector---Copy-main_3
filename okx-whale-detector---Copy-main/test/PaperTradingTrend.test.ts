import { describe, expect, it } from 'vitest';

import { summarizePaperTradingTrend } from '../src/paperTrading/paperTradingTrend';
import type { PaperTradingDocument } from '../src/paperTrading/paperTradingPersistence';

const document = (input: {
  generatedAt: number;
  equity: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  drawdownPercent: number;
  riskStatus: 'ALLOWED' | 'WARNING' | 'BLOCKED';
  initialCash?: number;
}): PaperTradingDocument =>
  ({
    schemaVersion: 1,
    generatorVersion: 'paper-trading-document-v1',
    portfolio: {
      generatedAt: input.generatedAt,
      initialCash: input.initialCash ?? 1_000,
      cash: input.equity,
      realizedPnl: input.realizedPnl ?? 0,
      feesPaid: 0,
      fills: [],
      positions: [],
    },
    valuation: {
      generatedAt: input.generatedAt,
      cash: input.equity,
      equity: input.equity,
      realizedPnl: input.realizedPnl ?? 0,
      unrealizedPnl: input.unrealizedPnl ?? 0,
      feesPaid: 0,
      grossExposure: 0,
      netExposure: 0,
      positions: [],
    },
    risk: {
      generatedAt: input.generatedAt,
      status: input.riskStatus,
      equity: input.equity,
      drawdownPercent: input.drawdownPercent,
      largestPositionExposure: 0,
      reasons: [],
    },
  }) as PaperTradingDocument;

describe('summarizePaperTradingTrend', () => {
  it('reports an improving trend and sorts documents by timestamp', () => {
    const summary = summarizePaperTradingTrend([
      document({
        generatedAt: 3,
        equity: 1_100,
        realizedPnl: 60,
        unrealizedPnl: 40,
        drawdownPercent: 0,
        riskStatus: 'ALLOWED',
      }),
      document({
        generatedAt: 1,
        equity: 950,
        realizedPnl: -20,
        unrealizedPnl: -30,
        drawdownPercent: 5,
        riskStatus: 'WARNING',
      }),
      document({
        generatedAt: 2,
        equity: 1_020,
        realizedPnl: 10,
        unrealizedPnl: 10,
        drawdownPercent: 1,
        riskStatus: 'ALLOWED',
      }),
    ]);

    expect(summary.direction).toBe('IMPROVING');
    expect(summary.points.map((point) => point.generatedAt)).toEqual([1, 2, 3]);
    expect(summary.equityChange).toBe(150);
    expect(summary.realizedPnlChange).toBe(80);
    expect(summary.unrealizedPnlChange).toBe(70);
    expect(summary.drawdownPercentChange).toBe(-5);
    expect(summary.bestEquity).toBe(1_100);
    expect(summary.worstEquity).toBe(950);
    expect(summary.maximumDrawdownPercent).toBe(5);
    expect(summary.riskImprovements).toBe(1);
    expect(summary.riskEscalations).toBe(0);
  });

  it('reports a deteriorating trend when risk escalates', () => {
    const summary = summarizePaperTradingTrend([
      document({ generatedAt: 1, equity: 1_050, drawdownPercent: 0, riskStatus: 'ALLOWED' }),
      document({ generatedAt: 2, equity: 900, drawdownPercent: 10, riskStatus: 'BLOCKED' }),
    ]);

    expect(summary.direction).toBe('DETERIORATING');
    expect(summary.riskEscalations).toBe(1);
  });

  it('reports a stable trend when quality does not change decisively', () => {
    const summary = summarizePaperTradingTrend([
      document({ generatedAt: 1, equity: 1_000, drawdownPercent: 0, riskStatus: 'ALLOWED' }),
      document({ generatedAt: 2, equity: 1_000, drawdownPercent: 0, riskStatus: 'ALLOWED' }),
    ]);

    expect(summary.direction).toBe('STABLE');
  });

  it('rejects insufficient, duplicate, or incompatible documents', () => {
    expect(() => summarizePaperTradingTrend([document({ generatedAt: 1, equity: 1_000, drawdownPercent: 0, riskStatus: 'ALLOWED' })])).toThrow(
      'At least two paper trading documents are required',
    );

    expect(() =>
      summarizePaperTradingTrend([
        document({ generatedAt: 1, equity: 1_000, drawdownPercent: 0, riskStatus: 'ALLOWED' }),
        document({ generatedAt: 1, equity: 1_010, drawdownPercent: 0, riskStatus: 'ALLOWED' }),
      ]),
    ).toThrow('Duplicate paper trading timestamp: 1');

    expect(() =>
      summarizePaperTradingTrend([
        document({ generatedAt: 1, equity: 1_000, drawdownPercent: 0, riskStatus: 'ALLOWED' }),
        document({
          generatedAt: 2,
          equity: 2_000,
          drawdownPercent: 0,
          riskStatus: 'ALLOWED',
          initialCash: 2_000,
        }),
      ]),
    ).toThrow('Paper trading documents must use the same initial cash');
  });
});
