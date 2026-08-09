import { describe, expect, it } from 'vitest';

import {
  compareReplayReports,
  type ReplayReportComparison,
} from '../src/recording/replayReportComparison';
import type { ReplayReport } from '../src/recording/replayReport';

const createReport = (overrides: Partial<ReplayReport> = {}): ReplayReport => ({
  generatedAt: '2026-07-27T00:00:00.000Z',
  recordingFile: 'data/recordings/session.ndjson',
  symbolFilter: null,
  speed: 'instant',
  markets: 1,
  orderBookUpdates: 100,
  candleUpdates: 10,
  totalUpdates: 110,
  elapsedMs: 1000,
  throughputUpdatesPerSecond: 110,
  events: {
    sequenceGaps: 0,
    whaleEvents: {
      NEW: 4,
      REMOVED: 2,
      INCREASED: 1,
      DECREASED: 1,
      MOVED: 0,
    },
    movedWhales: 1,
    refillEvents: 2,
    spoofEvents: 0,
    behaviorEvents: { PERSISTENT: 3 },
    summaries: 1,
  },
  pipeline: [
    {
      stage: 'whaleTracker.scan',
      samples: 100,
      totalMs: 100,
      averageMs: 1,
      maximumMs: 3,
    },
  ],
  symbols: {
    'BTC-USDT': {
      orderBookUpdates: 100,
      candleUpdates: 10,
      finalActiveWhales: 2,
    },
  },
  ...overrides,
});

const compare = (
  baseline: ReplayReport,
  candidate: ReplayReport,
): ReplayReportComparison =>
  compareReplayReports('baseline.json', baseline, 'candidate.json', candidate);

describe('replay report comparison', () => {
  it('compares totals, events, symbols, and pipeline performance', () => {
    const baseline = createReport();
    const candidate = createReport({
      elapsedMs: 800,
      throughputUpdatesPerSecond: 137.5,
      events: {
        ...baseline.events,
        whaleEvents: { ...baseline.events.whaleEvents, NEW: 6 },
      },
      pipeline: [
        {
          stage: 'whaleTracker.scan',
          samples: 100,
          totalMs: 75,
          averageMs: 0.75,
          maximumMs: 2,
        },
      ],
      symbols: {
        'BTC-USDT': {
          orderBookUpdates: 100,
          candleUpdates: 10,
          finalActiveWhales: 3,
        },
      },
    });

    const result = compare(baseline, candidate);

    expect(result.compatibleInput).toBe(true);
    expect(result.totals.elapsedMs.changePercent).toBe(-20);
    expect(result.events.whaleEvents.NEW.change).toBe(2);
    expect(result.symbols['BTC-USDT']?.finalActiveWhales.change).toBe(1);
    expect(result.pipeline[0]?.averagePerformance).toBe('FASTER');
  });

  it('warns when reports use different inputs', () => {
    const result = compare(
      createReport(),
      createReport({
        recordingFile: 'data/recordings/other.ndjson',
        symbolFilter: 'BTC-USDT',
        totalUpdates: 50,
      }),
    );

    expect(result.compatibleInput).toBe(false);
    expect(result.compatibilityWarnings).toHaveLength(3);
  });

  it('handles a zero baseline without an infinite percentage', () => {
    const baseline = createReport({ elapsedMs: 0 });
    const candidate = createReport({ elapsedMs: 10 });

    expect(
      compare(baseline, candidate).totals.elapsedMs.changePercent,
    ).toBeNull();
  });

  it('includes stages and symbols present in only one report', () => {
    const candidate = createReport({
      pipeline: [
        {
          stage: 'wallDetector.detect',
          samples: 10,
          totalMs: 5,
          averageMs: 0.5,
          maximumMs: 1,
        },
      ],
      symbols: {
        'ETH-USDT': {
          orderBookUpdates: 100,
          candleUpdates: 10,
          finalActiveWhales: 1,
        },
      },
    });

    const result = compare(createReport(), candidate);

    expect(result.pipeline.map((stage) => stage.stage)).toEqual([
      'wallDetector.detect',
      'whaleTracker.scan',
    ]);
    expect(Object.keys(result.symbols)).toEqual(['BTC-USDT', 'ETH-USDT']);
  });
});
