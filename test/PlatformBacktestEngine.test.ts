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
  { timestamp: 4, open: 106, high: 108, low: 105, close: 107, confirm: true },
];

const instrumentSpecification = {
  instrumentId: 'BTC-USDT-SWAP',
  tickSize: 0.0001,
  lotSizeBaseUnits: 0.001,
  minimumOrderBaseUnits: 0.001,
  minimumOrderValue: 0.01,
  maximumLeverage: 100,
} as const;

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
      action:
        latest?.timestamp === 3 && context.openPosition != null
          ? 'EXIT'
          : 'WAIT',
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
      leverage: 2,
      feeBps: 5,
      spreadBps: 2,
      slippageBps: 1,
    });
    const report = engine.run({
      instrumentId: 'BTC-USDT-SWAP',
      instrumentSpecification,
      candles,
      config: tradingStrategyConfig,
    });

    expect(report.strategyId).toBe('test-strategy');
    expect(report.trades).toHaveLength(1);
    expect(report.trades[0]?.entryReason).toBe('TEST_ENTRY');
    expect(report.trades[0]?.exitReason).toBe('TEST_EXIT');
    expect(report.trades[0]?.openedAt).toBe(3);
    expect(report.trades[0]?.closedAt).toBe(4);
    expect(report.trades[0]?.entryPrice).toBeCloseTo(104.0208);
    expect(report.trades[0]?.exitPrice).toBeCloseTo(105.9788);
    expect(report.trades[0]?.entryReferencePrice).toBe(104);
    expect(report.trades[0]?.exitReferencePrice).toBe(106);
    expect(report.trades[0]?.feeCost).toBeGreaterThan(0);
    expect(report.trades[0]?.slippageCost).toBeGreaterThan(0);
    expect(report.trades[0]?.netPnl).toBeCloseTo(
      (report.trades[0]?.grossPnl ?? 0) -
        (report.trades[0]?.feeCost ?? 0) -
        (report.trades[0]?.slippageCost ?? 0),
    );
    expect(report.analytics.trades).toBe(1);
    expect(report.statistics.tradeCount).toBe(1);
    expect(report.statistics.totalFees).toBeCloseTo(
      report.trades[0]?.feeCost ?? 0,
    );
    expect(report.equityCurve.length).toBeGreaterThan(candles.length);
    expect(report.buyAndHold.returnPercent).toBeCloseTo(7);
    expect(report.liveExecutionAllowed).toBe(false);
    expect(engine.exportTradesCsv(report)).toContain('TEST_ENTRY');
  });

  it('bounds candidate comparison and bridges to purged walk-forward planning', () => {
    const engine = new PlatformBacktestEngine(deterministicStrategy);
    const results = engine.compareCandidates({
      instrumentId: 'BTC-USDT-SWAP',
      instrumentSpecification,
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
      labelHorizonMs: 2 * 86_400_000,
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
    expect(plan.discovery[0]?.labelEndAt).toBe(
      (plan.discovery[0]?.observedAt ?? 0) + 2 * 86_400_000,
    );
  });

  it('applies funding only from explicit settlement events to held exposure', () => {
    const engine = new PlatformBacktestEngine(deterministicStrategy, {
      initialEquity: 10_000,
      leverage: 2,
      feeBps: 0,
      spreadBps: 0,
      slippageBps: 0,
    });
    const report = engine.run({
      instrumentId: 'BTC-USDT-SWAP',
      instrumentSpecification,
      candles,
      fundingEvents: [
        {
          eventId: 'funding-before-entry',
          timestamp: 2,
          fundingRatePercent: 0.1,
          markPrice: 100,
        },
        {
          eventId: 'funding-held-position',
          timestamp: 4,
          fundingRatePercent: 0.1,
          markPrice: 105,
        },
      ],
      config: tradingStrategyConfig,
    });

    expect(report.fundingEventCount).toBe(2);
    expect(report.appliedFundingEventCount).toBe(1);
    expect(report.trades[0]?.fundingPnl).toBeCloseTo(-0.105);
  });

  it('rejects zero-horizon walk-forward labels', () => {
    const engine = new PlatformBacktestEngine(deterministicStrategy);
    expect(() =>
      engine.createWalkForwardPlan({
        instrumentId: 'BTC-USDT-SWAP',
        candles,
        labelHorizonMs: 0,
        policy: {
          trainSize: 2,
          testSize: 1,
          stepSize: 1,
          purgeMs: 0,
          embargoMs: 0,
          holdoutFraction: 0.25,
          anchoredTraining: true,
        },
      }),
    ).toThrow('labelHorizonMs');
  });

  it('records instrument-constraint rejections instead of creating invalid trades', () => {
    const engine = new PlatformBacktestEngine(deterministicStrategy);
    const report = engine.run({
      instrumentId: 'BTC-USDT-SWAP',
      instrumentSpecification: {
        ...instrumentSpecification,
        lotSizeBaseUnits: 1,
        minimumOrderBaseUnits: 2,
      },
      candles,
      config: tradingStrategyConfig,
    });

    expect(report.trades).toHaveLength(0);
    expect(report.tradeRejections).toContainEqual({
      decidedAt: 2,
      executionAt: 3,
      reason: 'BELOW_MINIMUM_ORDER_SIZE',
      requestedQuantityBaseUnits: 1,
      normalizedQuantityBaseUnits: 1,
    });
  });

  it('fills a pre-existing protective stop at a worse gap-open price', () => {
    const holdStrategy: TradingStrategy = {
      ...deterministicStrategy,
      generateSignal(context) {
        const result = deterministicStrategy.generateSignal(context);
        return result.action === 'EXIT'
          ? { ...result, action: 'WAIT', reasons: ['WAIT'] }
          : result;
      },
    };
    const engine = new PlatformBacktestEngine(holdStrategy, {
      initialEquity: 10_000,
      leverage: 2,
      feeBps: 0,
      spreadBps: 0,
      slippageBps: 0,
    });
    const report = engine.run({
      instrumentId: 'BTC-USDT-SWAP',
      instrumentSpecification: {
        ...instrumentSpecification,
        tickSize: 0.1,
      },
      candles: [
        ...candles
          .slice(0, 3)
          .map((candle) =>
            candle.timestamp === 3
              ? { ...candle, open: 100, high: 101, low: 99, close: 100 }
              : candle,
          ),
        { timestamp: 4, open: 80, high: 82, low: 79, close: 81, confirm: true },
      ],
      config: tradingStrategyConfig,
    });

    expect(report.trades[0]).toMatchObject({
      exitReason: 'STOP_LOSS',
      exitReferencePrice: 80,
      exitPrice: 80,
    });
  });
});
