import { describe, expect, it, vi } from 'vitest';

import { PipelineProfiler } from '../src/core/PipelineProfiler';

describe('PipelineProfiler', () => {
  it('records samples and sorts stages by total time', () => {
    const profiler = new PipelineProfiler();

    profiler.record('fast', 2);
    profiler.record('slow', 5);
    profiler.record('slow', 7);

    expect(profiler.getSnapshot()).toEqual([
      {
        stage: 'slow',
        samples: 2,
        totalMs: 12,
        averageMs: 6,
        maximumMs: 7,
      },
      {
        stage: 'fast',
        samples: 1,
        totalMs: 2,
        averageMs: 2,
        maximumMs: 2,
      },
    ]);
  });

  it('measures successful and failing operations', () => {
    const profiler = new PipelineProfiler();
    const now = vi.spyOn(performance, 'now');

    now.mockReturnValueOnce(10).mockReturnValueOnce(14);
    expect(profiler.measure('success', () => 42)).toBe(42);

    now.mockReturnValueOnce(20).mockReturnValueOnce(29);
    expect(() =>
      profiler.measure('failure', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(profiler.getSnapshot().map((stage) => stage.stage)).toEqual([
      'failure',
      'success',
    ]);

    now.mockRestore();
  });

  it('ignores invalid samples and resets all statistics', () => {
    const profiler = new PipelineProfiler();

    profiler.record('', 10);
    profiler.record('negative', -1);
    profiler.record('invalid', Number.NaN);
    profiler.record('valid', 3);

    expect(profiler.getSnapshot()).toHaveLength(1);

    profiler.reset();

    expect(profiler.getSnapshot()).toEqual([]);
  });

  it('calculates bounded recent percentile statistics', () => {
    const profiler = new PipelineProfiler({ maximumSamplesPerStage: 3 });

    for (const duration of [1, 2, 3, 4, 5]) {
      profiler.record('bounded', duration);
    }

    expect(profiler.getRecentStage('bounded')).toEqual({
      stage: 'bounded',
      count: 3,
      latestMs: 5,
      totalMs: 12,
      averageMs: 4,
      maximumMs: 5,
      p50Ms: 4,
      p95Ms: 5,
      p99Ms: 5,
    });
    expect(profiler.getSnapshot()[0]?.samples).toBe(5);
  });

  it('bounds the number of distinct metric stages', () => {
    const profiler = new PipelineProfiler({ maximumStages: 2 });

    profiler.record('one', 1);
    profiler.record('two', 2);
    profiler.record('three', 3);

    expect(profiler.getStageCount()).toBe(2);
    expect(profiler.getRecentStage('three')).toBeUndefined();
  });

  it('avoids timing work when instrumentation is disabled', () => {
    const profiler = new PipelineProfiler({ enabled: false });
    const operation = vi.fn(() => 42);

    expect(profiler.measure('disabled', operation)).toBe(42);
    expect(operation).toHaveBeenCalledOnce();
    expect(profiler.getSnapshot()).toEqual([]);
  });
});
