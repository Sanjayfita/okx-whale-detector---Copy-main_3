import { describe, expect, it } from 'vitest';

import { comparePaperTradingDocuments } from '../src/paperTrading/paperTradingComparison';
import type { PaperRiskStatus } from '../src/paperTrading/paperRiskControls';
import type { PaperTradingDocument } from '../src/paperTrading/paperTradingPersistence';

const document = (input: {
  generatedAt: number;
  initialCash?: number;
  equity: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  feesPaid?: number;
  grossExposure?: number;
  netExposure?: number;
  drawdownPercent: number;
  riskStatus: PaperRiskStatus;
  positions?: readonly string[];
}): PaperTradingDocument => {
  const initialCash = input.initialCash ?? 1_000;
  const realizedPnl = input.realizedPnl ?? 0;
  const unrealizedPnl = input.unrealizedPnl ?? 0;
  const feesPaid = input.feesPaid ?? 0;
  const grossExposure = input.grossExposure ?? 0;
  const netExposure = input.netExposure ?? 0;
  const positions = (input.positions ?? []).map((instrumentId) => ({
    instrumentId,
    quantity: 1,
    averageEntryPrice: 100,
    markPrice: 100,
    marketValue: 100,
    unrealizedPnl: 0,
    realizedPnl: 0,
  }));

  return {
    schemaVersion: 1,
    generatorVersion: 'paper-trading-document-v1',
    portfolio: {
      generatedAt: input.generatedAt,
      initialCash,
      cash: input.equity - netExposure,
      realizedPnl,
      feesPaid,
      fills: [],
      positions: positions.map(({ instrumentId, quantity, averageEntryPrice }) => ({
        instrumentId,
        quantity,
        averageEntryPrice,
        realizedPnl: 0,
      })),
    },
    valuation: {
      generatedAt: input.generatedAt,
      cash: input.equity - netExposure,
      equity: input.equity,
      realizedPnl,
      unrealizedPnl,
      feesPaid,
      grossExposure,
      netExposure,
      positions,
    },
    risk: {
      generatedAt: input.generatedAt,
      status: input.riskStatus,
      equity: input.equity,
      drawdownPercent: input.drawdownPercent,
      largestPositionExposure: positions.length > 0 ? 100 : 0,
      reasons: [],
    },
  };
};

describe('comparePaperTradingDocuments', () => {
  it('reports improvement when risk status improves', () => {
    const comparison = comparePaperTradingDocuments({
      baseline: document({
        generatedAt: 100,
        equity: 900,
        drawdownPercent: 10,
        riskStatus: 'BLOCKED',
        positions: ['BTC-USDT'],
      }),
      candidate: document({
        generatedAt: 200,
        equity: 950,
        drawdownPercent: 5,
        riskStatus: 'WARNING',
        positions: ['ETH-USDT'],
      }),
    });

    expect(comparison.outcome).toBe('IMPROVED');
    expect(comparison.equityDelta).toBe(50);
    expect(comparison.addedPositionIds).toEqual(['ETH-USDT']);
    expect(comparison.closedPositionIds).toEqual(['BTC-USDT']);
  });

  it('reports worsening when risk status worsens', () => {
    const comparison = comparePaperTradingDocuments({
      baseline: document({
        generatedAt: 100,
        equity: 1_010,
        drawdownPercent: 0,
        riskStatus: 'ALLOWED',
      }),
      candidate: document({
        generatedAt: 200,
        equity: 980,
        drawdownPercent: 2,
        riskStatus: 'WARNING',
      }),
    });

    expect(comparison.outcome).toBe('WORSENED');
    expect(comparison.reasons[0]).toContain('worsened');
  });

  it('uses equity and drawdown when risk status is unchanged', () => {
    const comparison = comparePaperTradingDocuments({
      baseline: document({
        generatedAt: 100,
        equity: 1_000,
        drawdownPercent: 4,
        riskStatus: 'ALLOWED',
        positions: ['BTC-USDT'],
      }),
      candidate: document({
        generatedAt: 200,
        equity: 1_025,
        drawdownPercent: 3,
        riskStatus: 'ALLOWED',
        positions: ['BTC-USDT', 'ETH-USDT'],
      }),
    });

    expect(comparison.outcome).toBe('IMPROVED');
    expect(comparison.retainedPositionIds).toEqual(['BTC-USDT']);
    expect(comparison.addedPositionIds).toEqual(['ETH-USDT']);
  });

  it('rejects an older candidate or different starting cash', () => {
    const baseline = document({
      generatedAt: 200,
      equity: 1_000,
      drawdownPercent: 0,
      riskStatus: 'ALLOWED',
    });

    expect(() =>
      comparePaperTradingDocuments({
        baseline,
        candidate: document({
          generatedAt: 100,
          equity: 1_000,
          drawdownPercent: 0,
          riskStatus: 'ALLOWED',
        }),
      }),
    ).toThrow('cannot be older');

    expect(() =>
      comparePaperTradingDocuments({
        baseline,
        candidate: document({
          generatedAt: 300,
          initialCash: 2_000,
          equity: 2_000,
          drawdownPercent: 0,
          riskStatus: 'ALLOWED',
        }),
      }),
    ).toThrow('same initial cash');
  });
});
