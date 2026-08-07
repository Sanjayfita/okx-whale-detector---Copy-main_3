import { describe, expect, it } from 'vitest';

import type { TradingStrategyConfig } from '../src/config/tradingStrategyConfig';
import {
  evaluateEmaTrendStrategy,
  type EmaTrendCandle,
} from '../src/strategy/EmaTrendStrategy';

const start = 1_800_000_000_000;

const testConfig: TradingStrategyConfig = {
  fastEmaLength: 3,
  slowEmaLength: 5,
  rsiPeriod: 3,
  atrPeriod: 3,
  atrMultiplier: 1.5,
  minimumAtrPercent: 0.1,
  maximumAtrPercent: 20,
  stopLossPercent: 1,
  takeProfitPercent: 2,
  trailingStopEnabled: false,
  trailingStopPercent: 1,
};

const candlesFromCloses = (
  closes: readonly number[],
  range = 0.5,
): readonly EmaTrendCandle[] =>
  closes.map((close, index) => {
    const open = closes[index - 1] ?? close;
    return {
      timestamp: start + index * 60_000,
      open,
      high: Math.max(open, close) + range,
      low: Math.min(open, close) - range,
      close,
      confirm: true,
    };
  });

describe('EmaTrendStrategy', () => {
  it('enters long only after a confirmed bullish EMA crossover and risks 1% of equity', () => {
    const result = evaluateEmaTrendStrategy({
      instrumentId: 'BTC-USDT-SWAP',
      candles: candlesFromCloses([100, 98, 96, 94, 94.5, 96.5, 98.5]),
      accountEquity: 10_000,
      config: testConfig,
    });

    expect(result.action).toBe('ENTER_LONG');
    expect(result.direction).toBe('LONG');
    expect(result.reasons).toEqual(['LONG_EMA_CROSSOVER_CONFIRMED']);
    expect(result.riskAmount).toBe(100);
    expect(result.riskRewardRatio).toBeGreaterThanOrEqual(2);
    expect(result.stopLossPrice).toBeLessThan(result.entryPrice ?? 0);
    expect(result.takeProfitPrice).toBeGreaterThan(result.entryPrice ?? 0);
    expect(result.positionSizeBaseUnits).toBeGreaterThan(0);
    expect(result.liveExecutionAllowed).toBe(false);
  });

  it('enters short on the symmetric bearish EMA crossover', () => {
    const result = evaluateEmaTrendStrategy({
      instrumentId: 'ETH-USDT-SWAP',
      candles: candlesFromCloses([100, 98, 96, 95, 97, 99, 97]),
      accountEquity: 20_000,
      config: testConfig,
    });

    expect(result.action).toBe('ENTER_SHORT');
    expect(result.direction).toBe('SHORT');
    expect(result.reasons).toEqual(['SHORT_EMA_CROSSOVER_CONFIRMED']);
    expect(result.riskAmount).toBe(200);
    expect(result.riskRewardRatio).toBeGreaterThanOrEqual(2);
    expect(result.stopLossPrice).toBeGreaterThan(result.entryPrice ?? 0);
    expect(result.takeProfitPrice).toBeLessThan(result.entryPrice ?? 0);
  });

  it('skips otherwise valid entries when ATR volatility is below policy', () => {
    const result = evaluateEmaTrendStrategy({
      instrumentId: 'BTC-USDT-SWAP',
      candles: candlesFromCloses([100, 98, 96, 94, 94.5, 96.5, 98.5]),
      accountEquity: 10_000,
      config: {
        ...testConfig,
        minimumAtrPercent: 10,
      },
    });

    expect(result.action).toBe('HOLD');
    expect(result.reasons).toEqual(['LOW_VOLATILITY']);
  });

  it('does not create another entry while a position is already open', () => {
    const candles = candlesFromCloses([100, 98, 96, 94, 94.5, 96.5, 98.5]);
    const result = evaluateEmaTrendStrategy({
      instrumentId: 'BTC-USDT-SWAP',
      candles,
      accountEquity: 10_000,
      openPosition: {
        direction: 'LONG',
        openedAt: candles[candles.length - 1]?.timestamp ?? start,
        entryPrice: 98.5,
        stopLossPrice: 50,
        takeProfitPrice: 150,
      },
      config: testConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.direction).toBe('LONG');
    expect(result.reasons).toEqual(['POSITION_ALREADY_OPEN']);
  });

  it('exits conservatively at the stop before considering a target touched in the same candle', () => {
    const result = evaluateEmaTrendStrategy({
      instrumentId: 'BTC-USDT-SWAP',
      candles: [
        {
          timestamp: start,
          open: 100,
          high: 106,
          low: 94,
          close: 101,
          confirm: true,
        },
      ],
      accountEquity: 10_000,
      openPosition: {
        direction: 'LONG',
        openedAt: start,
        entryPrice: 100,
        stopLossPrice: 95,
        takeProfitPrice: 105,
      },
      config: testConfig,
    });

    expect(result.action).toBe('EXIT_LONG');
    expect(result.reasons).toEqual(['STOP_LOSS']);
  });

  it('supports an optional trailing stop after favorable movement', () => {
    const result = evaluateEmaTrendStrategy({
      instrumentId: 'BTC-USDT-SWAP',
      candles: [
        {
          timestamp: start,
          open: 100,
          high: 110,
          low: 100,
          close: 109,
          confirm: true,
        },
        {
          timestamp: start + 60_000,
          open: 109,
          high: 109.5,
          low: 108,
          close: 108.5,
          confirm: true,
        },
      ],
      accountEquity: 10_000,
      openPosition: {
        direction: 'LONG',
        openedAt: start,
        entryPrice: 100,
        stopLossPrice: 95,
        takeProfitPrice: 120,
      },
      config: {
        ...testConfig,
        trailingStopEnabled: true,
        trailingStopPercent: 1,
      },
    });

    expect(result.action).toBe('EXIT_LONG');
    expect(result.reasons).toEqual(['TRAILING_STOP']);
    expect(result.trailingStopPrice).toBeCloseTo(108.9, 8);
  });

  it('ignores unconfirmed candles and fails closed when history is insufficient', () => {
    const result = evaluateEmaTrendStrategy({
      instrumentId: 'BTC-USDT-SWAP',
      candles: [
        ...candlesFromCloses([100, 99, 98, 97]),
        {
          timestamp: start + 4 * 60_000,
          open: 97,
          high: 110,
          low: 96,
          close: 109,
          confirm: false,
        },
      ],
      accountEquity: 10_000,
      config: testConfig,
    });

    expect(result.action).toBe('HOLD');
    expect(result.reasons).toEqual(['INSUFFICIENT_CONFIRMED_CANDLES']);
  });
});
