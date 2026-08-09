import { describe, expect, it, vi } from 'vitest';

import { ProcessingMonitor } from '../src/core/ProcessingMonitor';
import { PerformanceTrace } from '../src/core/PerformanceTrace';
import { PipelineProfiler } from '../src/core/PipelineProfiler';

const config = {
  slowUpdateThresholdMs: 25,
  warningCooldownMs: 30_000,
  maximumSamplesPerSymbol: 3,
  maximumSamplesPerStage: 3,
  maximumProfiledStages: 10,
  attributionEnabled: true,
  warningStageLimit: 2,
};

describe('ProcessingMonitor', () => {
  it('keeps only the newest bounded samples', () => {
    const monitor = new ProcessingMonitor(config, () => undefined);

    monitor.record('BTC-USDT', 10);
    monitor.record('BTC-USDT', 20);
    monitor.record('BTC-USDT', 30);
    monitor.record('BTC-USDT', 40);

    expect(monitor.getStats('BTC-USDT')).toEqual({
      sampleCount: 3,
      averageMs: 30,
      maximumMs: 40,
      latestMs: 40,
    });
  });

  it('warns when an update exceeds the threshold', () => {
    const logger = vi.fn();
    const monitor = new ProcessingMonitor(config, logger);

    monitor.record('ETH-USDT', 25, 1_000);

    expect(logger).toHaveBeenCalledOnce();
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('Slow market update for ETH-USDT'),
    );
  });

  it('includes compact per-update attribution in a slow warning', () => {
    const logger = vi.fn();
    const monitor = new ProcessingMonitor(config, logger);
    const trace = new PerformanceTrace(new PipelineProfiler(), true, {
      queueDelayMs: 7,
      stages: [{ stage: 'okx.json.parse', durationMs: 2 }],
    });
    trace.record('wallDetector.detect', 20);
    trace.updateDiagnostics({
      bidDepth: 100,
      askDepth: 99,
      depthPruned: true,
      activeWhales: 4,
      activeWalls: 3,
      externalSignalStoreSize: 2,
      summaryProcessed: true,
      alertEmitted: true,
      alertPersisted: true,
      recorderFsync: true,
    });

    monitor.record('BTC-USDT', 30, 1_000, trace);

    expect(logger).toHaveBeenCalledWith(
      expect.stringMatching(
        /queue=7\.00ms[\s\S]*wallDetector\.detect=20\.00ms[\s\S]*depth=100\/99[\s\S]*pruned=true[\s\S]*whales=4[\s\S]*walls=3[\s\S]*external=2[\s\S]*summary=true[\s\S]*alert=true[\s\S]*persisted=true[\s\S]*fsync=true/,
      ),
    );
  });

  it('applies warning cooldown per symbol', () => {
    const logger = vi.fn();
    const monitor = new ProcessingMonitor(config, logger);

    monitor.record('BTC-USDT', 30, 1_000);
    monitor.record('BTC-USDT', 40, 2_000);
    monitor.record('ETH-USDT', 40, 2_000);
    monitor.record('BTC-USDT', 50, 31_000);

    expect(logger).toHaveBeenCalledTimes(3);
  });

  it('does not warn for fast updates', () => {
    const logger = vi.fn();
    const monitor = new ProcessingMonitor(config, logger);

    monitor.record('SOL-USDT', 24.99);

    expect(logger).not.toHaveBeenCalled();
  });

  it('ignores invalid durations', () => {
    const monitor = new ProcessingMonitor(config, () => undefined);

    monitor.record('BTC-USDT', Number.NaN);
    monitor.record('BTC-USDT', -1);

    expect(monitor.getStats('BTC-USDT')).toBeUndefined();
  });

  it('resets one symbol without clearing other symbols', () => {
    const monitor = new ProcessingMonitor(config, () => undefined);

    monitor.record('BTC-USDT', 10);
    monitor.record('ETH-USDT', 20);
    monitor.reset('BTC-USDT');

    expect(monitor.getStats('BTC-USDT')).toBeUndefined();
    expect(monitor.getStats('ETH-USDT')).toBeDefined();
  });

  it('resets a shard of symbols', () => {
    const monitor = new ProcessingMonitor(config, () => undefined);

    monitor.record('BTC-USDT', 10);
    monitor.record('ETH-USDT', 20);
    monitor.record('SOL-USDT', 30);
    monitor.resetSymbols(['BTC-USDT', 'ETH-USDT']);

    expect(monitor.getStats('BTC-USDT')).toBeUndefined();
    expect(monitor.getStats('ETH-USDT')).toBeUndefined();
    expect(monitor.getStats('SOL-USDT')).toBeDefined();
  });
});
