import { describe, expect, it } from 'vitest';
import { resolveSymbolConfig } from '../src/config/symbolProfiles';
import { MarketState } from '../src/core/MarketState';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';
import { TradingPlatformEngine } from '../src/platform/TradingPlatformEngine';

describe('TradingPlatformEngine', () => {
  it('marks positions and closes a take-profit through the depth-aware simulator', () => {
    const store = new PlatformStateStore({ now: () => 2_000 });
    const engine = new TradingPlatformEngine(store, { now: () => 2_000 });
    store.account.openPosition({
      instrumentId: 'BTC-USDT-SWAP',
      direction: 'LONG',
      openedAt: 1_000,
      entryPrice: 100,
      quantityBaseUnits: 1,
      stopLossPrice: 95,
      takeProfitPrice: 110,
      riskAmount: 5,
      entryReason: 'TEST_ENTRY',
      entryFee: 0,
    });

    const state = new MarketState(resolveSymbolConfig('BTC-USDT-SWAP'), {
      instId: 'BTC-USDT-SWAP',
      instType: 'SWAP',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 1,
    });
    expect(
      state.orderBookManager.applyUpdate(
        [['110', '10', '0', '1']],
        [['111', '10', '0', '1']],
        2_000,
        1,
        -1,
        'snapshot',
      ),
    ).toBe(true);

    engine.onOrderBook('BTC-USDT-SWAP', state);

    const snapshot = store.account.snapshot(2_000);
    expect(snapshot.openPositions).toHaveLength(0);
    expect(snapshot.trades).toHaveLength(1);
    expect(snapshot.trades[0]?.exitReason).toBe('TAKE_PROFIT');
    expect(snapshot.trades[0]?.fees).toBeGreaterThan(0);
  });

  it('applies funding to an open paper position', () => {
    const store = new PlatformStateStore({ now: () => 2_000 });
    const engine = new TradingPlatformEngine(store, { now: () => 2_000 });
    store.account.openPosition({
      instrumentId: 'ETH-USDT-SWAP',
      direction: 'LONG',
      openedAt: 1_000,
      entryPrice: 100,
      quantityBaseUnits: 2,
      stopLossPrice: 95,
      takeProfitPrice: 110,
      riskAmount: 10,
      entryReason: 'TEST_ENTRY',
      entryFee: 0,
    });

    engine.onFunding({
      instrumentId: 'ETH-USDT-SWAP',
      fundingRatePercent: 0.1,
      timestamp: 2_000,
    });

    expect(
      store.account.getOpenPosition('ETH-USDT-SWAP')?.fundingPnl,
    ).toBeCloseTo(-0.2);
  });

  it('clears the prior timeframe, ignores stale intervals, and cannot trade during rebuild', () => {
    const store = new PlatformStateStore({ now: () => 2_000 });
    const engine = new TradingPlatformEngine(store, { now: () => 2_000 });

    engine.onCandle({
      instId: 'BTC-USDT-SWAP',
      interval: '1m',
      timestamp: 60_000,
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 1,
      volumeCurrency: 1,
      volumeCurrencyQuote: 101,
      confirm: true,
    });
    expect(store.snapshot(2_000).candles['BTC-USDT-SWAP']).toHaveLength(1);

    store.updateSettings({ timeframe: '5m' });
    engine.beginTimeframeRebuild('5m');
    expect(store.snapshot(2_000).candles['BTC-USDT-SWAP']).toBeUndefined();
    expect(store.snapshot(2_000).timeframe.state).toBe('REBUILDING');

    engine.onCandle({
      instId: 'BTC-USDT-SWAP',
      interval: '1m',
      timestamp: 120_000,
      open: 101,
      high: 103,
      low: 100,
      close: 102,
      volume: 1,
      volumeCurrency: 1,
      volumeCurrencyQuote: 102,
      confirm: true,
    });
    expect(store.snapshot(2_000).candles['BTC-USDT-SWAP']).toBeUndefined();

    for (let index = 0; index < 60; index += 1) {
      const close = 100 + index * 0.1;
      engine.onCandle({
        instId: 'BTC-USDT-SWAP',
        interval: '5m',
        timestamp: 300_000 * (index + 1),
        open: close,
        high: close + 0.5,
        low: close - 0.5,
        close,
        volume: 1,
        volumeCurrency: 1,
        volumeCurrencyQuote: close,
        confirm: true,
      });
    }

    expect(store.snapshot(2_000).candles['BTC-USDT-SWAP']).toHaveLength(60);
    expect(store.account.snapshot(2_000).openPositions).toHaveLength(0);
    expect(store.account.snapshot(2_000).trades).toHaveLength(0);

    engine.completeTimeframeRebuild(
      '5m',
      new Map([['BTC-USDT-SWAP', 300_000 * 60]]),
    );
    expect(store.snapshot(2_000).timeframe).toMatchObject({
      selected: '5m',
      state: 'READY',
    });
  });

  it('can discover a historical EMA crossover during rebuild without attempting a paper entry', () => {
    const store = new PlatformStateStore({ now: () => 2_000 });
    const engine = new TradingPlatformEngine(store, { now: () => 2_000 });
    store.updateSettings({
      timeframe: '15m',
      fastEmaLength: 3,
      slowEmaLength: 5,
      rsiPeriod: 3,
      atrPeriod: 3,
      minimumAtrPercent: 0.1,
      maximumAtrPercent: 20,
      trailingStopEnabled: false,
    });
    engine.beginTimeframeRebuild('15m');

    const closes = [100, 98, 96, 94, 94.5, 96.5, 98.5] as const;
    closes.forEach((close, index) => {
      const open = closes[index - 1] ?? close;
      engine.onCandle({
        instId: 'BTC-USDT-SWAP',
        interval: '15m',
        timestamp: 900_000 * (index + 1),
        open,
        high: Math.max(open, close) + 0.5,
        low: Math.min(open, close) - 0.5,
        close,
        volume: 10,
        volumeCurrency: 5,
        volumeCurrencyQuote: close * 5,
        confirm: true,
      });
    });

    const snapshot = store.snapshot(2_000);
    expect(snapshot.strategyStatus['ema-trend-crossover-v1']?.signal).toBe('BUY');
    expect(snapshot.positions).toHaveLength(0);
    expect(snapshot.trades).toHaveLength(0);
    expect(
      snapshot.logs.some((entry) =>
        entry.message.includes('Paper entry missed because no usable order book'),
      ),
    ).toBe(false);
  });
});