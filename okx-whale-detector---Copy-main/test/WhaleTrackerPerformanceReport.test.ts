import { describe, expect, it } from 'vitest';

import {
  runWhaleTrackerBenchmark,
  type WhaleTrackerBenchmarkMetric,
} from '../src/tools/whaleTrackerPerformanceReport';

const expectValidMetric = (
  metric: WhaleTrackerBenchmarkMetric,
  samples: number,
): void => {
  expect(metric.samples).toBe(samples);
  expect(metric.p50Ms).toBeGreaterThanOrEqual(0);
  expect(metric.p95Ms).toBeGreaterThanOrEqual(metric.p50Ms);
  expect(metric.p99Ms).toBeGreaterThanOrEqual(metric.p95Ms);
  expect(metric.maximumMs).toBeGreaterThanOrEqual(metric.p99Ms);
  expect(metric.throughputPerSecond).toBeGreaterThan(0);
};

describe('WhaleTracker performance report', () => {
  it('covers every requested depth, active state, and update pattern', () => {
    const samples = 1;
    const results = runWhaleTrackerBenchmark({
      samples,
      warmups: 0,
    });

    expect(results).toHaveLength(4 * 2 * 6);
    expect(new Set(results.map((result) => result.depthPerSide))).toEqual(
      new Set([50, 100, 200, 400]),
    );
    expect(new Set(results.map((result) => result.activeState))).toEqual(
      new Set(['few', 'many']),
    );
    expect(new Set(results.map((result) => result.pattern))).toEqual(
      new Set([
        'irrelevant',
        'exact-whale',
        'removal',
        'nearby-movement',
        'many-movements',
        'snapshot',
      ]),
    );

    for (const result of results) {
      expectValidMetric(result.whaleTracker, samples);
      expectValidMetric(result.wallDetector, samples);
      expectValidMetric(result.combinedDetectors, samples);
      expectValidMetric(result.marketEngine, samples);
    }
  });

  it('rejects invalid sample and warmup counts', () => {
    expect(() => runWhaleTrackerBenchmark({ samples: 0 })).toThrow(
      'samples must be a positive integer',
    );
    expect(() => runWhaleTrackerBenchmark({ warmups: -1 })).toThrow(
      'warmups must be a non-negative integer',
    );
  });
});
