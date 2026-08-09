import { describe, expect, it } from 'vitest';
import {
  formatProcessMemoryUsage,
  startProcessMemoryReporter,
} from '../src/observability/processMemoryReporter';

describe('processMemoryReporter', () => {
  it('formats bounded process memory metrics in megabytes', () => {
    const usage: NodeJS.MemoryUsage = {
      rss: 128 * 1024 * 1024,
      heapTotal: 64 * 1024 * 1024,
      heapUsed: 32 * 1024 * 1024,
      external: 4 * 1024 * 1024,
      arrayBuffers: 2 * 1024 * 1024,
    };

    expect(formatProcessMemoryUsage(usage)).toBe(
      '[MEMORY] rss=128.0MB heapUsed=32.0MB heapTotal=64.0MB external=4.0MB arrayBuffers=2.0MB',
    );
  });

  it('reports immediately with optional bounded execution metrics', () => {
    const messages: string[] = [];
    const reporter = startProcessMemoryReporter({
      intervalMs: 60_000,
      readMemoryUsage: () => ({
        rss: 1,
        heapTotal: 2,
        heapUsed: 1,
        external: 0,
        arrayBuffers: 0,
      }),
      additionalMetrics: () => ({
        orderBookUpdates: 250_000,
        executionBookMaterializations: 1,
      }),
      log: (message) => messages.push(message),
    });
    reporter.stop();

    expect(messages).toEqual([
      '[MEMORY] rss=0.0MB heapUsed=0.0MB heapTotal=0.0MB external=0.0MB arrayBuffers=0.0MB orderBookUpdates=250000 executionBookMaterializations=1',
    ]);
  });

  it('reports immediately and rejects invalid intervals', () => {
    const messages: string[] = [];
    const reporter = startProcessMemoryReporter({
      intervalMs: 60_000,
      readMemoryUsage: () => ({
        rss: 1,
        heapTotal: 2,
        heapUsed: 1,
        external: 0,
        arrayBuffers: 0,
      }),
      log: (message) => messages.push(message),
    });
    reporter.stop();
    expect(messages).toHaveLength(1);
    expect(() => startProcessMemoryReporter({ intervalMs: 0 })).toThrow(
      'memory reporting intervalMs must be a positive safe integer',
    );
  });
});
