import { describe, expect, it, vi } from 'vitest';

import type { HealthConfig } from '../src/config/healthConfig';
import { MarketHealthMonitor } from '../src/core/MarketHealthMonitor';

const config: HealthConfig = {
  checkIntervalMs: 1_000,
  reportIntervalMs: 5_000,
  startupGraceMs: 2_000,
  orderBookStaleAfterMs: 3_000,
  candleStaleAfterMs: 10_000,
};

describe('MarketHealthMonitor', () => {
  it('treats uninitialized symbols as warming during startup grace', () => {
    const monitor = new MarketHealthMonitor(
      ['BTC-USDT'],
      config,
      vi.fn(),
      vi.fn(),
      1_000,
    );

    expect(monitor.check(2_000)).toEqual({
      totalSymbols: 1,
      healthySymbols: 0,
      warmingSymbols: 1,
      staleOrderBookSymbols: [],
      staleCandleSymbols: [],
    });
  });

  it('reports a symbol healthy after both streams update', () => {
    const monitor = new MarketHealthMonitor(
      ['BTC-USDT'],
      config,
      vi.fn(),
      vi.fn(),
      1_000,
    );

    monitor.recordOrderBook('BTC-USDT', 2_000);
    monitor.recordCandle('BTC-USDT', 2_000);

    expect(monitor.check(2_500).healthySymbols).toBe(1);
  });

  it('warns once when an order book becomes stale', () => {
    const warn = vi.fn();
    const monitor = new MarketHealthMonitor(
      ['BTC-USDT'],
      config,
      vi.fn(),
      warn,
      0,
    );

    monitor.recordOrderBook('BTC-USDT', 1_000);
    monitor.recordCandle('BTC-USDT', 1_000);

    expect(monitor.check(4_000).staleOrderBookSymbols).toEqual(['BTC-USDT']);
    monitor.check(5_000);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Stale order book'),
    );
  });

  it('warns when the candle stream becomes stale', () => {
    const warn = vi.fn();
    const monitor = new MarketHealthMonitor(
      ['ETH-USDT'],
      config,
      vi.fn(),
      warn,
      0,
    );

    monitor.recordOrderBook('ETH-USDT', 10_000);
    monitor.recordCandle('ETH-USDT', 1_000);

    expect(monitor.check(11_000).staleCandleSymbols).toEqual(['ETH-USDT']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Stale candle stream'),
    );
  });

  it('logs recovery when stale data resumes', () => {
    const log = vi.fn();
    const monitor = new MarketHealthMonitor(
      ['BTC-USDT'],
      config,
      log,
      vi.fn(),
      0,
    );

    monitor.recordOrderBook('BTC-USDT', 1_000);
    monitor.recordCandle('BTC-USDT', 1_000);
    monitor.check(4_000);
    monitor.recordOrderBook('BTC-USDT', 4_100);

    expect(log).toHaveBeenCalledWith('✅ Order book recovered for BTC-USDT');
  });

  it('prints a compact health report', () => {
    const log = vi.fn();
    const monitor = new MarketHealthMonitor(
      ['BTC-USDT'],
      config,
      log,
      vi.fn(),
      0,
    );

    monitor.recordOrderBook('BTC-USDT', 1_000);
    monitor.recordCandle('BTC-USDT', 1_000);
    monitor.report(1_500);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('💚 MARKET HEALTH | Healthy: 1/1'),
    );
  });

  it('resets only requested symbols into startup grace', () => {
    const monitor = new MarketHealthMonitor(
      ['BTC-USDT', 'ETH-USDT'],
      config,
      vi.fn(),
      vi.fn(),
      0,
    );

    for (const symbol of ['BTC-USDT', 'ETH-USDT']) {
      monitor.recordOrderBook(symbol, 1_000);
      monitor.recordCandle(symbol, 1_000);
    }

    monitor.resetSymbols(['BTC-USDT'], 5_000);
    const summary = monitor.check(5_500);

    expect(summary.warmingSymbols).toBe(1);
    expect(summary.staleOrderBookSymbols).toEqual(['ETH-USDT']);
  });

  it('ignores updates for unregistered symbols', () => {
    const monitor = new MarketHealthMonitor(
      ['BTC-USDT'],
      config,
      vi.fn(),
      vi.fn(),
      0,
    );

    monitor.recordOrderBook('UNKNOWN-USDT', 1_000);
    monitor.recordCandle('UNKNOWN-USDT', 1_000);

    expect(monitor.check(1_500).totalSymbols).toBe(1);
  });
});
