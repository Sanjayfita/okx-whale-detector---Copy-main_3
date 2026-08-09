import { describe, expect, it } from 'vitest';
import {
  PlatformBacktestEngine,
  type HistoricalBacktestCandle,
} from '../src/backtest/PlatformBacktestEngine';
import { tradingStrategyConfig } from '../src/config/tradingStrategyConfig';
import type {
  StrategyContext,
  StrategySignalResult,
  TradingStrategy,
} from '../src/strategies/TradingStrategy';

const candles: HistoricalBacktestCandle[] = [
  { timestamp: 1, open: 100, high: 101, low: 99, close: 100, confirm: true },
  { timestamp: 2, open: 100, high: 101, low: 99, close: 100, confirm: true },
  { timestamp: 3, open: 104, high: 106, low: 103, close: 105, confirm: true },
];

const deterministicStrategy: TradingStrategy = {
  id: 'test-strategy',
  label: 'Test Strategy',
  generateSignal(context: StrategyContext): StrategySignalResult {
    const latest = context.candles[context.candles.length - 1];
    if (latest?.timestamp === 2 && context.openPosition == null) {
      return {
        strategyId: this.id,
        instrumentId: context.instrumentId,
        action: 'BUY',
        direction: 'LONG',
        observedAt: latest.timestamp,
        reasons: ['TEST_ENTRY'],
        entryPrice: 100,
        stopLossPrice: 90,
        takeProfitPrice: 120,
        trailingStopPrice: null,
        positionSizeBaseUnits: 1,
        riskAmount: 10,
        riskRewardRatio: 2,
        indicators: {},
        liveExecutionAllowed: false,
      };
    }
    return {
      strategyId: this.id,
      instrumentId: context.instrumentId,
      action: latest?.timestamp === 3 && context.openPosition != null ? 'EXIT' : 'WAIT',
      direction: context.openPosition?.direction ?? null,
      observedAt: latest?.timestamp ?? null,
      reasons: [latest?.timestamp === 3 ? 'TEST_EXIT' : 'WAIT'],
      entryPrice: null,
      stopLossPrice: null,
      takeProfitPrice: null,
      trailingStopPrice: null,
      positionSizeBaseUnits: 0,
      riskAmount: 0,
      riskRewardRatio: null,
      indicators: {},
      liveExecutionAllowed: false,
    };
  },
  calculateStop: () => null,
  calculateTakeProfit: () => null,
  calculatePositionSize: () => 0,
};

describe('PlatformBacktestEngine', () => {
  it('produces cost-aware trades, equity, analytics and buy-and-hold benchmark', () => {
    const engine = new PlatformBacktestEngine(deterministicStrategy, {
      initialEquity: 10_000,
      feeBps: 5,
      spreadBps: 2,
      slippageBps: 1,
    });
    const report = engine.run({
      instrumentId: 'BTC-USDT-SWAP',
      candles,
      config: tradingStrategyConfig,
    });

    expect(report.strategyId).toBe('test-strategy');
    expect(report.trades).toHaveLength(1);
    expect(report.trades[0]?.entryReason).toBe('TEST_ENTRY');
    expect(report.trades[0]?.exitReason).toBe('TEST_EXIT');
    expect(report.trades[0]?.feeCost).toBeGreaterThan(0);
    expect(report.trades[0]?.slippageCost).toBeGreaterThan(0);
    expect(report.analytics.trades).toBe(1);
    expect(report.equityCurve.length).toBeGreaterThan(candles.length);
    expect(report.buyAndHold.returnPercent).toBeCloseTo(5);
    expect(report.liveExecutionAllowed).toBe(false);
    expect(engine.exportTradesCsv(report)).toContain('TEST_ENTRY');
  });

  it('bounds candidate comparison and bridges to purged walk-forward planning', () => {
    const engine = new PlatformBacktestEngine(deterministicStrategy);
    const results = engine.compareCandidates({
      instrumentId: 'BTC-USDT-SWAP',
      candles,
      candidates: [
        { candidateId: 'baseline', config: tradingStrategyConfig },
        {
          candidateId: 'lower-risk',
          config: { ...tradingStrategyConfig, riskPerTradePercent: 0.5 },
        },
      ],
    });
    expect(results).toHaveLength(2);

    const extended = Array.from({ length: 40 }, (_, index) => ({
      timestamp: (index + 1) * 86_400_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100 + index,
      confirm: true,
    }));
    const plan = engine.createWalkForwardPlan({
      instrumentId: 'BTC-USDT-SWAP',
      candles: extended,
      policy: {
        trainSize: 10,
        testSize: 4,
        stepSize: 4,
        purgeMs: 0,
        embargoMs: 0,
        holdoutFraction: 0.2,
        anchoredTraining: true,
      },
    });
    expect(plan.discovery.length).toBeGreaterThan(0);
    expect(plan.holdout.length).toBeGreaterThan(0);
    expect(plan.folds.length).toBeGreaterThan(0);
  });
});
