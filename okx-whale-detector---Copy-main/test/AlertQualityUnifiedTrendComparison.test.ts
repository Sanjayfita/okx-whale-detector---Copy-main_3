import { describe, expect, it } from 'vitest';

import {
  ALERT_QUALITY_UNIFIED_TREND_GENERATOR_VERSION,
  ALERT_QUALITY_UNIFIED_TREND_SCHEMA_VERSION,
  compareAlertQualityUnifiedTrends,
  type AlertQualityTrendMetricSummary,
  type AlertQualityUnifiedTrend,
} from '../src/evaluation';

const metric = (
  metricKey: string,
  netDelta: number | null,
  overallChange: AlertQualityTrendMetricSummary['overallChange'],
): AlertQualityTrendMetricSummary => ({
  metricKey,
  section: 'TERMINAL_RETURN',
  groupKey: 'group',
  family: null,
  metric: 'coverage.eligibleRate',
  observedTransitionCount: 2,
  improvedCount: 0,
  degradedCount: 0,
  unchangedCount: 0,
  unavailableCount: 0,
  netDelta,
  firstObservedValue: 1,
  lastObservedValue: netDelta === null ? null : 1 + netDelta,
  overallChange,
});

const trend = (
  metrics: readonly AlertQualityTrendMetricSummary[],
  groupingDimensions: readonly string[] = ['HORIZON_MS'],
): AlertQualityUnifiedTrend => ({
  schemaVersion: ALERT_QUALITY_UNIFIED_TREND_SCHEMA_VERSION,
  generatorVersion: ALERT_QUALITY_UNIFIED_TREND_GENERATOR_VERSION,
  groupingDimensions,
  reports: [
    {
      reportRunId: 'report:first',
      generatedAt: 1,
      inputRecordCounts: { terminalReturn: 1, pathOutcome: 1, targetStop: 1 },
    },
    {
      reportRunId: 'report:last',
      generatedAt: 2,
      inputRecordCounts: { terminalReturn: 1, pathOutcome: 1, targetStop: 1 },
    },
  ],
  transitions: [],
  metrics,
  totalImprovedMetricCount: 0,
  totalDegradedMetricCount: 0,
  totalUnchangedMetricCount: 0,
  totalUnavailableMetricCount: 0,
});

describe('alert-quality trend comparison', () => {
  it('classifies acceleration, deceleration, steady motion, reversal, and unavailable metrics', () => {
    const baseline = trend([
      metric('accelerating', 1, 'IMPROVED'),
      metric('decelerating', 2, 'IMPROVED'),
      metric('steady', -1, 'DEGRADED'),
      metric('reversing', -1, 'DEGRADED'),
      metric('unavailable', null, 'UNAVAILABLE'),
      metric('removed', 1, 'IMPROVED'),
    ]);
    const candidate = trend([
      metric('accelerating', 2, 'IMPROVED'),
      metric('decelerating', 1, 'IMPROVED'),
      metric('steady', -1, 'DEGRADED'),
      metric('reversing', 1, 'IMPROVED'),
      metric('unavailable', null, 'UNAVAILABLE'),
      metric('added', 1, 'IMPROVED'),
    ]);

    const comparison = compareAlertQualityUnifiedTrends(baseline, candidate);

    expect(comparison.acceleratingMetricCount).toBe(1);
    expect(comparison.deceleratingMetricCount).toBe(1);
    expect(comparison.steadyMetricCount).toBe(1);
    expect(comparison.reversingMetricCount).toBe(1);
    expect(comparison.unavailableMetricCount).toBe(1);
    expect(comparison.addedMetricKeys).toEqual(['added']);
    expect(comparison.removedMetricKeys).toEqual(['removed']);
    expect(comparison.metrics.map((entry) => entry.metricKey)).toEqual([
      'accelerating',
      'decelerating',
      'reversing',
      'steady',
      'unavailable',
    ]);
  });

  it('is deterministic for identical inputs', () => {
    const baseline = trend([metric('metric', 1, 'IMPROVED')]);
    const candidate = trend([metric('metric', 2, 'IMPROVED')]);

    expect(compareAlertQualityUnifiedTrends(baseline, candidate)).toEqual(
      compareAlertQualityUnifiedTrends(baseline, candidate),
    );
  });

  it('rejects incompatible grouping dimensions', () => {
    expect(() =>
      compareAlertQualityUnifiedTrends(
        trend([metric('metric', 1, 'IMPROVED')], ['HORIZON_MS']),
        trend([metric('metric', 1, 'IMPROVED')], ['SOURCE']),
      ),
    ).toThrow('grouping dimensions are incompatible');
  });
});
