import { describe, expect, it } from 'vitest';

import {
  runBehaviorTransitionBenchmark,
  type BehaviorTransitionBenchmarkMetric,
} from '../src/tools/behaviorTransitionPerformanceReport';

const expectValidMetric = (
  metric: BehaviorTransitionBenchmarkMetric,
  samples: number,
): void => {
  expect(metric.samples).toBe(samples);
  expect(metric.p50Ms).toBeGreaterThanOrEqual(0);
  expect(metric.p95Ms).toBeGreaterThanOrEqual(metric.p50Ms);
  expect(metric.p99Ms).toBeGreaterThanOrEqual(metric.p95Ms);
  expect(metric.maximumMs).toBeGreaterThanOrEqual(metric.p99Ms);
  expect(metric.throughputPerSecond).toBeGreaterThan(0);
};

describe('Behavior transition performance report', () => {
  it('covers all whale counts, behavior patterns, and MarketEngine scenarios', () => {
    const samples = 1;
    const result = runBehaviorTransitionBenchmark({
      samples,
      warmups: 0,
    });

    expect(result.behaviorScenarios).toHaveLength(6 * 5);
    expect(result.marketEngineScenarios).toHaveLength(6);
    expect(
      new Set(
        result.behaviorScenarios.map((scenario) => scenario.activeWhales),
      ),
    ).toEqual(new Set([2, 20, 100, 200, 400, 800]));
    expect(
      new Set(result.behaviorScenarios.map((scenario) => scenario.pattern)),
    ).toEqual(
      new Set([
        'no-behaviors',
        'persistent-unchanged',
        'one-transition',
        'many-transitions',
        'mass-removals',
      ]),
    );

    for (const scenario of result.behaviorScenarios) {
      expectValidMetric(scenario.transitionBookkeeping, samples);
      expectValidMetric(scenario.fullBehaviorStage, samples);
    }

    for (const scenario of result.marketEngineScenarios) {
      expectValidMetric(scenario.marketEngine, samples);
    }
  });

  it('rejects invalid sample, warmup, and whale counts', () => {
    expect(() => runBehaviorTransitionBenchmark({ samples: 0 })).toThrow(
      'samples must be a positive integer',
    );
    expect(() => runBehaviorTransitionBenchmark({ warmups: -1 })).toThrow(
      'warmups must be a non-negative integer',
    );
    expect(() =>
      runBehaviorTransitionBenchmark({ activeWhaleCounts: [0] }),
    ).toThrow('active whale count must be a positive integer');
  });
});
