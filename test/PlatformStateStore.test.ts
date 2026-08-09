import { describe, expect, it } from 'vitest';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';

describe('PlatformStateStore', () => {
  it('publishes bounded candle, log, settings and risk state with 1m default', () => {
    let now = 1_000;
    const store = new PlatformStateStore({
      startingEquity: 5_000,
      maximumCandlesPerInstrument: 2,
      maximumLogs: 2,
      now: () => now++,
    });

    expect(store.getSettings().timeframe).toBe('1m');
    for (const timestamp of [1, 2, 3]) {
      store.appendCandle({
        instrumentId: 'BTC-USDT-SWAP',
        timeframe: '1m',
        timestamp,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 10,
        confirmed: true,
        fastEma: 100,
        slowEma: 99,
        rsi: 55,
        atr: 1,
      });
    }
    store.log('INFO', 'one');
    store.log('WARNING', 'two');
    store.log('ERROR', 'three');
    store.setKillSwitch(true);
    store.updateSettings({ riskPerTradePercent: 0.5 });

    const snapshot = store.snapshot(2_000);
    expect(snapshot.overview.accountEquity).toBe(5_000);
    expect(snapshot.overview.timeframe).toBe('1m');
    expect(snapshot.candles['BTC-USDT-SWAP']).toHaveLength(2);
    expect(snapshot.logs).toHaveLength(2);
    expect(snapshot.settings.riskPerTradePercent).toBe(0.5);
    expect(snapshot.risk.killSwitchActive).toBe(true);
    expect(snapshot.liveExecutionAllowed).toBe(false);
  });

  it('does not retain candles from a previously selected timeframe', () => {
    const store = new PlatformStateStore();
    store.appendCandle({
      instrumentId: 'BTC-USDT-SWAP',
      timeframe: '1m',
      timestamp: 1,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
      confirmed: true,
      fastEma: 100,
      slowEma: 99,
      rsi: 55,
      atr: 1,
    });
    store.updateSettings({ timeframe: '5m' });
    store.clearStrategyMarketState();
    store.appendCandle({
      instrumentId: 'BTC-USDT-SWAP',
      timeframe: '1m',
      timestamp: 2,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
      confirmed: true,
      fastEma: 100,
      slowEma: 99,
      rsi: 55,
      atr: 1,
    });
    expect(store.snapshot().candles['BTC-USDT-SWAP']).toBeUndefined();
  });

  it('rejects settings that exceed the one-percent risk ceiling', () => {
    const store = new PlatformStateStore();
    expect(() => store.updateSettings({ riskPerTradePercent: 1.1 })).toThrow(
      /must not exceed 1%/u,
    );
  });
});
