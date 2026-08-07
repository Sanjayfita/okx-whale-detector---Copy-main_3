import { describe, expect, it } from 'vitest';

import type { OKXCandle } from '../src/clients/okx/OKXCandleWebSocketClient';
import {
  emaTrendStrategyConfig,
  type EmaTrendStrategyConfig,
} from '../src/config/strategyConfig';
import {
  createEmaTrendPositionState,
  evaluateEmaTrendEntry,
  evaluateEmaTrendExit,
  type EmaTrendPositionState,
} from '../src/strategy/EmaTrendStrategy';

const TEST_CONFIG: EmaTrendStrategyConfig = {
  ...emaTrendStrategyConfig,
  fastEmaPeriod: 3,
  slowEmaPeriod: 5,
  rsiPeriod: 3,
  atrPeriod: 3,
  minimumAtrPercent: 0.1,
  atrMultiplier: 0.5,
  stopLossPercent: 1,
  takeProfitPercent: 2,
  trendSlopeLookback: 1,
  longRsiMinimum: 50,
  longRsiMaximum: 100,
  shortRsiMinimum: 0,
  shortRsiMaximum: 50,
  riskPerTradePercent: 1,
  minimumRewardRiskRatio: 2,
  trailingStop: {
    enabled: true,
    atrMultiplier: 1,
  },
};

const candlesFromCloses = (
  closes: readonly number[],
  instrumentId = 'BTC-USDT-SWAP',
  spread = 0.5,
): readonly OKXCandle[] =>
  closes.map((close, index) => ({
    instId: instrumentId,
    timestamp: 1_700_000_000_000 + index * 60_000,
    open: close,
    high: close + spread,
    low: Math.max(0.0001, close - spread),
    close,
    volume: 100,
    volumeCurrency: 100,
    volumeCurrencyQuote: 10_000,
    confirm: true,
  }));

const bullishCrossCandles = (): readonly OKXCandle[] =>
  candlesFromCloses([10, 9, 8, 8, 8.5, 9, 10]);

const bearishCrossCandles = (): readonly OKXCandle[] =>
  candlesFromCloses([8, 9, 10, 10, 9.5, 9, 8]);

describe('EMA trend entry strategy', () => {
  it('enters only on a fresh bullish crossover with trend and RSI confirmation', () => {
    const decision = evaluateEmaTrendEntry({
      candles: bullishCrossCandles(),
      accountEquity: 10_000,
      config: TEST_CONFIG,
    });

    expect(decision.status).toBe('SIGNAL');
    expect(decision.direction).toBe('LONG');
    expect(decision.reasons).toEqual([]);
    expect(decision.indicators?.previousFastEma).toBeLessThanOrEqual(
      decision.indicators?.previousSlowEma ?? 0,
    );
    expect(decision.indicators?.fastEma).toBeGreaterThan(
      decision.indicators?.slowEma ?? Number.POSITIVE_INFINITY,
    );
    expect(decision.tradePlan?.riskPercent).toBe(1);
    expect(decision.tradePlan?.riskAmountQuote).toBeCloseTo(100, 10);
    expect(decision.tradePlan?.rewardRiskRatio).toBeGreaterThanOrEqual(2);
    expect(decision.tradePlan?.stopLossPrice).toBeLessThan(
      decision.tradePlan?.entryPrice ?? 0,
    );
    expect(decision.tradePlan?.takeProfitPrice).toBeGreaterThan(
      decision.tradePlan?.entryPrice ?? Number.POSITIVE_INFINITY,
    );
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('supports the symmetric bearish rules', () => {
    const decision = evaluateEmaTrendEntry({
      candles: bearishCrossCandles(),
      accountEquity: 10_000,
      config: TEST_CONFIG,
    });

    expect(decision.status).toBe('SIGNAL');
    expect(decision.direction).toBe('SHORT');
    expect(decision.tradePlan?.stopLossPrice).toBeGreaterThan(
      decision.tradePlan?.entryPrice ?? Number.POSITIVE_INFINITY,
    );
    expect(decision.tradePlan?.takeProfitPrice).toBeLessThan(
      decision.tradePlan?.entryPrice ?? 0,
    );
  });

  it('skips low-volatility conditions before opening a trade', () => {
    const decision = evaluateEmaTrendEntry({
      candles: candlesFromCloses([10, 9, 8, 8, 8.5, 9, 10], 'BTC-USDT-SWAP', 0.001),
      accountEquity: 10_000,
      config: {
        ...TEST_CONFIG,
        minimumAtrPercent: 5,
      },
    });

    expect(decision.status).toBe('NO_SIGNAL');
    expect(decision.reasons).toContain('LOW_VOLATILITY');
  });

  it('never opens another position in the same direction', () => {
    const decision = evaluateEmaTrendEntry({
      candles: bullishCrossCandles(),
      accountEquity: 10_000,
      openPositions: [
        {
          instrumentId: 'ETH-USDT-SWAP',
          direction: 'LONG',
        },
      ],
      config: TEST_CONFIG,
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.reasons).toContain('SAME_DIRECTION_POSITION_ALREADY_OPEN');
  });

  it('never opens a second position for the same instrument', () => {
    const decision = evaluateEmaTrendEntry({
      candles: bullishCrossCandles(),
      accountEquity: 10_000,
      openPositions: [
        {
          instrumentId: 'BTC-USDT-SWAP',
          direction: 'SHORT',
        },
      ],
      config: TEST_CONFIG,
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.reasons).toContain('POSITION_ALREADY_OPEN_FOR_INSTRUMENT');
  });

  it('ignores unconfirmed candles so incomplete bars cannot create entries', () => {
    const candles = bullishCrossCandles().map((candle, index, all) =>
      index === all.length - 1 ? { ...candle, confirm: false } : candle,
    );
    const decision = evaluateEmaTrendEntry({
      candles,
      accountEquity: 10_000,
      config: TEST_CONFIG,
    });

    expect(decision.status).not.toBe('SIGNAL');
  });
});

describe('EMA trend exit strategy', () => {
  it('creates an immutable position state from a valid entry plan', () => {
    const entry = evaluateEmaTrendEntry({
      candles: bullishCrossCandles(),
      accountEquity: 10_000,
      config: TEST_CONFIG,
    });
    const position = createEmaTrendPositionState({ decision: entry });

    expect(position.instrumentId).toBe('BTC-USDT-SWAP');
    expect(position.direction).toBe('LONG');
    expect(position.riskPercent).toBe(1);
  });

  it('assumes the adverse stop occurs first when one candle touches stop and target', () => {
    const position: EmaTrendPositionState = {
      instrumentId: 'BTC-USDT-SWAP',
      direction: 'LONG',
      entryPrice: 100,
      stopLossPrice: 99,
      takeProfitPrice: 102,
      trailingStopPrice: null,
      stopDistancePercent: 1,
      takeProfitDistancePercent: 2,
      rewardRiskRatio: 2,
      riskPercent: 1,
      riskAmountQuote: 100,
      notionalQuote: 10_000,
      baseQuantity: 100,
      openedAt: 1_700_000_000_000,
      highestPriceSinceEntry: 100,
      lowestPriceSinceEntry: 100,
    };
    const history = candlesFromCloses([100, 100, 100, 100, 100, 100, 100]);
    const latest = history[history.length - 1];
    if (!latest) throw new Error('test candle missing');
    const candles = [
      ...history.slice(0, -1),
      { ...latest, high: 103, low: 98.5 },
    ];

    const exit = evaluateEmaTrendExit({
      position,
      candles,
      config: TEST_CONFIG,
    });

    expect(exit.status).toBe('EXIT');
    expect(exit.reason).toBe('STOP_LOSS');
    expect(exit.exitPrice).toBe(99);
  });

  it('ratchets a trailing stop only after evaluating the current confirmed candle', () => {
    const position: EmaTrendPositionState = {
      instrumentId: 'BTC-USDT-SWAP',
      direction: 'LONG',
      entryPrice: 100,
      stopLossPrice: 95,
      takeProfitPrice: 130,
      trailingStopPrice: 95,
      stopDistancePercent: 5,
      takeProfitDistancePercent: 30,
      rewardRiskRatio: 6,
      riskPercent: 1,
      riskAmountQuote: 100,
      notionalQuote: 2_000,
      baseQuantity: 20,
      openedAt: 1_700_000_000_000,
      highestPriceSinceEntry: 100,
      lowestPriceSinceEntry: 100,
    };
    const candles = candlesFromCloses([100, 99, 98, 99, 100, 101, 104], 'BTC-USDT-SWAP', 0.5);

    const result = evaluateEmaTrendExit({
      position,
      candles,
      config: TEST_CONFIG,
    });

    expect(result.status).toBe('HOLD');
    expect(result.position.highestPriceSinceEntry).toBeGreaterThan(100);
    expect(result.position.trailingStopPrice).toBeGreaterThan(95);
  });
});
