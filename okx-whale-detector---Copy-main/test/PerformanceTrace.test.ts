import { describe, expect, it } from 'vitest';

import { PerformanceTrace } from '../src/core/PerformanceTrace';
import { PipelineProfiler } from '../src/core/PipelineProfiler';

describe('PerformanceTrace', () => {
  it('combines message and per-update stage attribution', () => {
    const profiler = new PipelineProfiler();
    const trace = new PerformanceTrace(profiler, true, {
      queueDelayMs: 4,
      stages: [{ stage: 'okx.json.parse', durationMs: 2 }],
    });

    trace.record('wallDetector.detect', 3);
    trace.record('wallDetector.detect', 1);
    trace.updateDiagnostics({
      bidDepth: 100,
      askDepth: 90,
      depthPruned: true,
      activeWhales: 4,
      activeWalls: 3,
      externalSignalStoreSize: 2,
      summaryProcessed: true,
      alertEmitted: true,
      alertPersisted: true,
      recorderFsync: true,
    });

    expect(trace.getSnapshot()).toMatchObject({
      queueDelayMs: 4,
      bidDepth: 100,
      askDepth: 90,
      depthPruned: true,
      activeWhales: 4,
      activeWalls: 3,
      externalSignalStoreSize: 2,
      summaryProcessed: true,
      alertEmitted: true,
      alertPersisted: true,
      recorderFsync: true,
      stages: expect.arrayContaining([
        { stage: 'okx.json.parse', durationMs: 2 },
        { stage: 'wallDetector.detect', durationMs: 4 },
      ]),
    });
  });

  it('keeps multiple traces isolated', () => {
    const profiler = new PipelineProfiler();
    const first = new PerformanceTrace(profiler, true);
    const second = new PerformanceTrace(profiler, true);

    first.record('stage', 1);
    second.record('stage', 2);

    expect(first.getSnapshot().stages).toEqual([
      { stage: 'stage', durationMs: 1 },
    ]);
    expect(second.getSnapshot().stages).toEqual([
      { stage: 'stage', durationMs: 2 },
    ]);
  });
});
