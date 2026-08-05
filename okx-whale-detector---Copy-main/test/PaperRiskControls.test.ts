import { describe, expect, it } from 'vitest';

import { assessPaperTradingRisk } from '../src/paperTrading/paperRiskControls';
import type { PaperPortfolioValuation } from '../src/paperTrading/paperPortfolioValuation';

const valuation = (overrides: Partial<PaperPortfolioValuation> = {}): PaperPortfolioValuation => ({
  generatedAt: 1_700_000_000_000,
  cash: 5_000,
  equity: 10_000,
  realizedPnl: 0,
  unrealizedPnl: 0,
  feesPaid: 0,
  grossExposure: 5_000,
  netExposure: 5_000,
  positions: [
    {
      instrumentId: 'BTC-USDT',
      quantity: 0.1,
      averageEntryPrice: 50_000,
      markPrice: 50_000,
      marketValue: 5_000,
      unrealizedPnl: 0,
      realizedPnl: 0,
    },
  ],
  ...overrides,
});

const limits = {
  maxGrossExposure: 10_000,
  maxAbsoluteNetExposure: 10_000,
  maxPositionExposure: 8_000,
  maxDrawdownPercent: 20,
  warningThresholdPercent: 80,
};

describe('assessPaperTradingRisk', () => {
  it('allows a portfolio comfortably inside every limit', () => {
    const result = assessPaperTradingRisk({ valuation: valuation(), initialEquity: 10_000, limits });
    expect(result.status).toBe('ALLOWED');
    expect(result.reasons).toEqual([]);
  });

  it('warns when exposure reaches the configured warning threshold', () => {
    const result = assessPaperTradingRisk({
      valuation: valuation({ grossExposure: 8_000 }),
      initialEquity: 10_000,
      limits,
    });
    expect(result.status).toBe('WARNING');
    expect(result.reasons).toContain('Gross exposure is near limit: 8000 / 10000');
  });

  it('blocks when any exposure limit is exceeded', () => {
    const result = assessPaperTradingRisk({
      valuation: valuation({ grossExposure: 10_001 }),
      initialEquity: 10_000,
      limits,
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.reasons[0]).toContain('Gross exposure exceeds limit');
  });

  it('blocks when drawdown exceeds the configured limit', () => {
    const result = assessPaperTradingRisk({
      valuation: valuation({ equity: 7_500 }),
      initialEquity: 10_000,
      limits,
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.drawdownPercent).toBe(25);
  });

  it('rejects invalid limits and zero initial equity', () => {
    expect(() =>
      assessPaperTradingRisk({ valuation: valuation(), initialEquity: 0, limits }),
    ).toThrow('initialEquity must be greater than zero');
    expect(() =>
      assessPaperTradingRisk({
        valuation: valuation(),
        initialEquity: 10_000,
        limits: { ...limits, warningThresholdPercent: 101 },
      }),
    ).toThrow('warningThresholdPercent must be between 0 and 100');
  });
});
