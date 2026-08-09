import { describe, expect, it } from 'vitest';

import {
  evaluateAlertQualityTrendAwareDecision,
  type AlertQualityThresholdReport,
  type AlertQualityUnifiedTrend,
  type AlertQualityUnifiedTrendComparison,
} from '../src/evaluation';

const thresholdReport = (
  passed: number,
  failed: number,
  insufficientData: number,
): AlertQualityThresholdReport =>
  ({
    reportRunId: 'alert-quality-report:decision-test',
    generatedAt: 1_700_000_000_000,
    policy: {},
    evaluations: Array.from({ length: passed + failed + insufficientData }, (_, index) => ({
      groupKey: String(index),
      status:
        index < passed ? 'PASS' : index < passed + failed ? 'FAIL' : 'INSUFFICIENT_DATA',
    })),
    passedCount: passed,
    failedCount: failed,
    insufficientDataCount: insufficientData,
  }) as AlertQualityThresholdReport;

const trend = (improved: number, degraded: number): AlertQualityUnifiedTrend =>
  ({
    totalImprovedMetricCount: improved,
    totalDegradedMetricCount: degraded,
    totalUnchangedMetricCount: 10,
    totalUnavailableMetricCount: 2,
  }) as AlertQualityUnifiedTrend;

const comparison = (
  momentum: 'DECELERATING' | 'POSITIVE_REVERSAL' | 'NEGATIVE_REVERSAL',
): AlertQualityUnifiedTrendComparison => {
  const reversing = momentum.endsWith('REVERSAL');
  return {
    groupingDimensions: [],
    baselineReportCount: 3,
    candidateReportCount: 3,
    metrics: reversing
      ? [
          {
            metricKey: 'metric',
            baselineOverallChange: momentum === 'POSITIVE_REVERSAL' ? 'DEGRADED' : 'IMPROVED',
            candidateOverallChange: momentum === 'POSITIVE_REVERSAL' ? 'IMPROVED' : 'DEGRADED',
            baselineNetDelta: -1,
            candidateNetDelta: 1,
            deltaChange: 2,
            momentum: 'REVERSING',
          },
        ]
      : [],
    acceleratingMetricCount: 0,
    deceleratingMetricCount: momentum === 'DECELERATING' ? 1 : 0,
    steadyMetricCount: 0,
    reversingMetricCount: reversing ? 1 : 0,
    unavailableMetricCount: 0,
    addedMetricKeys: [],
    removedMetricKeys: [],
  };
};

describe('alert quality trend-aware decision engine', () => {
  it('qualifies complete passing evidence with a non-degrading trend', () => {
    const result = evaluateAlertQualityTrendAwareDecision({
      thresholdReport: thresholdReport(2, 0, 0),
      trend: trend(3, 1),
    });

    expect(result.decision).toBe('QUALIFIED');
    expect(result.reasons).toContain('ALL_GROUPS_PASS');
    expect(result.reasons).toContain('TREND_IMPROVING');
  });

  it('warns when passing evidence is decelerating', () => {
    const result = evaluateAlertQualityTrendAwareDecision({
      thresholdReport: thresholdReport(2, 0, 0),
      trend: trend(3, 1),
      trendComparison: comparison('DECELERATING'),
    });

    expect(result.decision).toBe('QUALIFIED_BUT_DECELERATING');
  });

  it('prioritizes insufficient evidence over quality classifications', () => {
    const result = evaluateAlertQualityTrendAwareDecision({
      thresholdReport: thresholdReport(1, 0, 1),
      trend: trend(4, 0),
    });

    expect(result.decision).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('classifies failed and worsening evidence as degrading', () => {
    const result = evaluateAlertQualityTrendAwareDecision({
      thresholdReport: thresholdReport(0, 2, 0),
      trend: trend(1, 4),
    });

    expect(result.decision).toBe('DEGRADING');
  });

  it('detects positive and negative trend reversals', () => {
    const positive = evaluateAlertQualityTrendAwareDecision({
      thresholdReport: thresholdReport(2, 0, 0),
      trend: trend(1, 1),
      trendComparison: comparison('POSITIVE_REVERSAL'),
    });
    const negative = evaluateAlertQualityTrendAwareDecision({
      thresholdReport: thresholdReport(2, 0, 0),
      trend: trend(1, 1),
      trendComparison: comparison('NEGATIVE_REVERSAL'),
    });

    expect(positive.decision).toBe('REVERSING_POSITIVE');
    expect(negative.decision).toBe('REVERSING_NEGATIVE');
  });
});
