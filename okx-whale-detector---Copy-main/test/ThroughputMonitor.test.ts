import { describe, expect, it, vi } from 'vitest';

import type { ThroughputConfig } from '../src/config/throughputConfig';
import { ThroughputMonitor } from '../src/core/ThroughputMonitor';
import { PipelineProfiler } from '../src/core/PipelineProfiler';

const config: ThroughputConfig = {
  reportIntervalMs: 60_000,
  eventLoopSampleIntervalMs: 1_000,
  eventLoopLagWarningMs: 100,
  warningCooldownMs: 30_000,
  maximumSymbolsInReport: 2,
};

describe('ThroughputMonitor', () => {
  it('calculates stream rates and ranks the busiest symbols', () => {
    const logger = vi.fn();
    const monitor = new ThroughputMonitor(config, logger, vi.fn(), 0);

    monitor.record('BTC-USDT', 'orderBook');
    monitor.record('BTC-USDT', 'orderBook');
    monitor.record('ETH-USDT', 'orderBook');
    monitor.record('ETH-USDT', 'candle');
    monitor.record('SOL-USDT', 'candle');

    const summary = monitor.report(1_000);

    expect(summary.orderBookUpdates).toBe(3);
    expect(summary.candleUpdates).toBe(2);
    expect(summary.orderBookPerSecond).toBe(3);
    expect(summary.candlePerSecond).toBe(2);
    expect(summary.busiestSymbols).toEqual([
      { symbol: 'BTC-USDT', totalUpdates: 2 },
      { symbol: 'ETH-USDT', totalUpdates: 2 },
    ]);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('THROUGHPUT'));
  });

  it('resets interval counters after reporting', () => {
    const monitor = new ThroughputMonitor(config, vi.fn(), vi.fn(), 0);

    monitor.record('BTC-USDT', 'orderBook');
    monitor.report(1_000);

    const second = monitor.report(2_000);

    expect(second.orderBookUpdates).toBe(0);
    expect(second.candleUpdates).toBe(0);
  });

  it('tracks the maximum event-loop lag for the interval', () => {
    const monitor = new ThroughputMonitor(config, vi.fn(), vi.fn(), 0);

    monitor.recordEventLoopLag(20, 100);
    monitor.recordEventLoopLag(75, 200);
    monitor.recordEventLoopLag(40, 300);

    expect(monitor.report(1_000).maximumEventLoopLagMs).toBe(75);
    expect(monitor.report(2_000).maximumEventLoopLagMs).toBe(0);
  });

  it('warns about event-loop lag with a cooldown', () => {
    const warningLogger = vi.fn();
    const monitor = new ThroughputMonitor(config, vi.fn(), warningLogger, 0);

    monitor.recordEventLoopLag(120, 1_000);
    monitor.recordEventLoopLag(150, 2_000);
    monitor.recordEventLoopLag(130, 31_000);

    expect(warningLogger).toHaveBeenCalledTimes(2);
    expect(warningLogger).toHaveBeenCalledWith(
      expect.stringContaining('Event-loop lag'),
    );
  });

  it('adds recent activity context without claiming causation', () => {
    const warningLogger = vi.fn();
    const profiler = new PipelineProfiler();
    profiler.record('okx.orderBook.queueDelay', 12);
    profiler.record('summary.consoleEmission', 8);
    profiler.record('polymarket.aggregation', 6);
    profiler.record('alert.persistence.fsync', 4);
    const monitor = new ThroughputMonitor(
      config,
      vi.fn(),
      warningLogger,
      0,
      profiler,
    );
    monitor.record('BTC-USDT', 'orderBook');

    monitor.recordEventLoopLag(120, 1_000);

    expect(warningLogger).toHaveBeenCalledWith(
      expect.stringMatching(
        /Recent activity around lag sample[\s\S]*not definitive causation[\s\S]*queue=p95=12\.00ms[\s\S]*messages=books:1,candles:0[\s\S]*console=p95=8\.00ms[\s\S]*polymarket=p95=6\.00ms[\s\S]*alertPersistence=p95=4\.00ms/,
      ),
    );
  });

  it('ignores invalid event-loop lag measurements', () => {
    const warningLogger = vi.fn();
    const monitor = new ThroughputMonitor(config, vi.fn(), warningLogger, 0);

    monitor.recordEventLoopLag(Number.NaN);
    monitor.recordEventLoopLag(-1);

    expect(monitor.report(1_000).maximumEventLoopLagMs).toBe(0);
    expect(warningLogger).not.toHaveBeenCalled();
  });

  it('clears partial counts only for reset symbols', () => {
    const monitor = new ThroughputMonitor(config, vi.fn(), vi.fn(), 0);

    monitor.record('BTC-USDT', 'orderBook');
    monitor.record('ETH-USDT', 'orderBook');
    monitor.resetSymbols(['BTC-USDT']);

    const summary = monitor.report(1_000);

    expect(summary.orderBookUpdates).toBe(1);
    expect(summary.busiestSymbols).toEqual([
      { symbol: 'ETH-USDT', totalUpdates: 1 },
    ]);
  });

  it('starts and stops timers idempotently', () => {
    vi.useFakeTimers();
    const monitor = new ThroughputMonitor(config, vi.fn(), vi.fn(), 0);

    monitor.start();
    monitor.start();
    monitor.stop();
    monitor.stop();

    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
