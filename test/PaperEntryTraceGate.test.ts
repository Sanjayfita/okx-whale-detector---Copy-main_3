import { describe, expect, it, vi } from 'vitest';
import { resolveSymbolConfig } from '../src/config/symbolProfiles';
import { MarketState } from '../src/core/MarketState';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';
import { TradingPlatformEngine } from '../src/platform/TradingPlatformEngine';
import { StrategyRegistry } from '../src/strategies/StrategyRegistry';
import type {
  StrategyContext,
  StrategySignalResult,
  TradingStrategy,
} from '../src/strategies/TradingStrategy';

const entryStrategy: TradingStrategy = {
  id: 'ema-trend-crossover-v1',
  label: 'Trace gate fixture',
  generateSignal(context: StrategyContext): StrategySignalResult {
    const candle = context.candles.at(-1);
    if (candle === undefined) throw new Error('expected candle');
    return {
      strategyId: this.id,
      instrumentId: context.instrumentId,
      action: 'BUY',
      direction: 'LONG',
      observedAt: candle.timestamp,
      reasons: ['TRACE_GATE_TEST'],
      diagnostics: {
        state: 'ENTRY_READY',
        candidateDirection: 'LONG',
        sufficientHistory: true,
        freshEmaCrossover: true,
        priceTrendAlignment: true,
        rsiPass: true,
        atrVolatilityPass: true,
        positionOpen: false,
        blockingReasons: [],
        primaryReason: null,
      },
      entryPrice: candle.close,
      stopLossPrice: candle.close - 1,
      takeProfitPrice: candle.close + 2,
      trailingStopPrice: null,
      positionSizeBaseUnits: 1,
      riskAmount: 1,
      riskRewardRatio: 2,
      indicators: {},
      liveExecutionAllowed: false,
    };
  },
  calculateStop(): number | null {
    return null;
  },
  calculateTakeProfit(): number | null {
    return null;
  },
  calculatePositionSize(): number {
    return 1;
  },
};

const stateWithUsableBook = (): MarketState => {
  const state = new MarketState(resolveSymbolConfig('BTC-USDT-SWAP'), {
    instId: 'BTC-USDT-SWAP',
    instType: 'SWAP',
    quoteCurrency: 'USDT',
    baseUnitsPerSize: 1,
  });
  const accepted = state.orderBookManager.applyUpdate(
    [['99', '10', '0', '1']],
    [['100', '10', '0', '1']],
    2_000,
    1,
    -1,
    'snapshot',
  );
  if (!accepted) throw new Error('expected usable fixture order book');
  return state;
};

const candle = {
  instId: 'BTC-USDT-SWAP',
  interval: '1m' as const,
  timestamp: 60_000,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 10,
  volumeCurrency: 5,
  volumeCurrencyQuote: 500,
  confirm: true,
};

const createStore = (): PlatformStateStore =>
  new PlatformStateStore({
    now: () => 2_000,
    strategyRegistry: new StrategyRegistry([entryStrategy], entryStrategy.id),
  });

describe('paper entry traceability gate', () => {
  it('does not mutate the paper account when trace context persistence fails', () => {
    const store = createStore();
    const beforePaperPositionOpen = vi.fn(() => false);
    const engine = new TradingPlatformEngine(store, {
      now: () => 2_000,
      beforePaperPositionOpen,
    });
    engine.onOrderBook('BTC-USDT-SWAP', stateWithUsableBook());

    engine.onCandle(candle);

    expect(beforePaperPositionOpen).toHaveBeenCalledTimes(1);
    const snapshot = store.account.snapshot(2_000);
    expect(snapshot.openPositions).toHaveLength(0);
    expect(snapshot.fills).toHaveLength(0);
  });

  it('opens normally only after the trace context gate succeeds', () => {
    const store = createStore();
    const beforePaperPositionOpen = vi.fn(() => true);
    const engine = new TradingPlatformEngine(store, {
      now: () => 2_000,
      beforePaperPositionOpen,
    });
    engine.onOrderBook('BTC-USDT-SWAP', stateWithUsableBook());

    engine.onCandle(candle);

    expect(beforePaperPositionOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        instrumentId: 'BTC-USDT-SWAP',
        strategyId: 'ema-trend-crossover-v1',
        timeframe: '1m',
      }),
    );
    const snapshot = store.account.snapshot(2_000);
    expect(snapshot.openPositions).toHaveLength(1);
    expect(snapshot.fills).toHaveLength(1);
  });
});
