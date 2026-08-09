import { describe, expect, it } from 'vitest';
import type { TradingStrategyConfig } from '../src/config/tradingStrategyConfig';
import {
  evaluateEmaTrendStrategy,
  type EmaTrendCandle,
} from '../src/strategy/EmaTrendStrategy';

const start = 1_800_000_000_000;
const config: TradingStrategyConfig = {
  fastEmaLength: 3,
  slowEmaLength: 5,
  rsiPeriod: 3,
  atrPeriod: 3,
  atrMultiplier: 1.5,
  minimumAtrPercent: 0.1,
  maximumAtrPercent: 20,
  stopLossPercent: 1,
  takeProfitPercent: 2,
  riskPerTradePercent: 1,
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

const evaluate = (
  closes: readonly number[],
  override: Partial<TradingStrategyConfig> = {},
) =>
  evaluateEmaTrendStrategy({
    instrumentId: 'BTC-USDT-SWAP',
    candles: candlesFromCloses(closes),
    accountEquity: 10_000,
    config: { ...config, ...override },
  });

describe('EMA trend strategy diagnostics', () => {
  it('reports no fresh crossover without pretending direction-dependent checks failed', () => {
    const result = evaluate([100, 101, 102, 103, 104, 105, 106]);

    expect(result.action).toBe('HOLD');
    expect(result.diagnostics).toMatchObject({
      state: 'WAIT',
      sufficientHistory: true,
      freshEmaCrossover: false,
      priceTrendAlignment: null,
      rsiPass: null,
      atrVolatilityPass: true,
      positionOpen: false,
      primaryReason: 'NO_EMA_CROSSOVER',
    });
    expect(result.diagnostics.blockingReasons).toEqual(['NO_EMA_CROSSOVER']);
  });

  it('reports ATR failure from the same threshold used by the trade decision', () => {
    const result = evaluate(
      [100, 98, 96, 94, 94.5, 96.5, 98.5],
      { minimumAtrPercent: 10 },
    );

    expect(result.action).toBe('HOLD');
    expect(result.reasons).toEqual(['LOW_VOLATILITY']);
    expect(result.diagnostics.atrVolatilityPass).toBe(false);
    expect(result.diagnostics.blockingReasons).toContain('LOW_VOLATILITY');
  });

  it('reports an RSI blocker after a valid fresh crossover and trend alignment', () => {
    const result = evaluate([
      100,
      107.35562737324312,
      110.3964379507914,
      106.16158318276695,
      103.29986270087909,
      101.73606515695482,
      100.90934628931265,
      101.79824151999564,
      105.42955428794426,
    ]);

    expect(result.action).toBe('HOLD');
    expect(result.reasons).toEqual(['RSI_FILTER_NOT_CONFIRMED']);
    expect(result.diagnostics.freshEmaCrossover).toBe(true);
    expect(result.diagnostics.priceTrendAlignment).toBe(true);
    expect(result.diagnostics.rsiPass).toBe(false);
    expect(result.diagnostics.primaryReason).toBe('RSI_FILTER_NOT_CONFIRMED');
  });

  it('exposes multiple simultaneous blockers while preserving decision precedence', () => {
    const result = evaluate(
      [
        100,
        107.35562737324312,
        110.3964379507914,
        106.16158318276695,
        103.29986270087909,
        101.73606515695482,
        100.90934628931265,
        101.79824151999564,
        105.42955428794426,
      ],
      { minimumAtrPercent: 10 },
    );

    expect(result.action).toBe('HOLD');
    expect(result.reasons).toEqual(['LOW_VOLATILITY']);
    expect(result.diagnostics.primaryReason).toBe('LOW_VOLATILITY');
    expect(result.diagnostics.blockingReasons).toEqual(
      expect.arrayContaining(['LOW_VOLATILITY', 'RSI_FILTER_NOT_CONFIRMED']),
    );
  });

  it('marks ENTRY_READY exactly when the evaluator emits an entry', () => {
    const result = evaluate([100, 98, 96, 94, 94.5, 96.5, 98.5]);

    expect(result.action).toBe('ENTER_LONG');
    expect(result.diagnostics).toMatchObject({
      state: 'ENTRY_READY',
      freshEmaCrossover: true,
      priceTrendAlignment: true,
      rsiPass: true,
      atrVolatilityPass: true,
      positionOpen: false,
      primaryReason: null,
    });
    expect(result.diagnostics.blockingReasons).toEqual([]);
  });

  it('marks an existing position as the primary blocker when no exit is due', () => {
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
      config,
    });

    expect(result.action).toBe('HOLD');
    expect(result.diagnostics.state).toBe('IN_POSITION');
    expect(result.diagnostics.positionOpen).toBe(true);
    expect(result.diagnostics.primaryReason).toBe('POSITION_ALREADY_OPEN');
    expect(result.diagnostics.blockingReasons).toContain('POSITION_ALREADY_OPEN');
  });

  it('keeps diagnostics and actual entry decisions mutually consistent', () => {
    const scenarios = [
      evaluate([100, 101, 102, 103, 104, 105, 106]),
      evaluate([100, 98, 96, 94, 94.5, 96.5, 98.5]),
      evaluate([100, 98, 96, 94, 94.5, 96.5, 98.5], {
        minimumAtrPercent: 10,
      }),
    ];

    for (const result of scenarios) {
      const entry = result.action === 'ENTER_LONG' || result.action === 'ENTER_SHORT';
      expect(result.diagnostics.state === 'ENTRY_READY').toBe(entry);
      expect(result.diagnostics.primaryReason === null).toBe(entry);
    }
  });
});
