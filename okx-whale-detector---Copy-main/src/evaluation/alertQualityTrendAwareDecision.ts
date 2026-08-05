import type { AlertQualityThresholdReport } from './alertQualityThresholdPolicy';
import type { AlertQualityUnifiedTrend } from './alertQualityUnifiedTrend';
import type { AlertQualityUnifiedTrendComparison } from './alertQualityUnifiedTrendComparison';

export type AlertQualityResearchDecision =
  | 'QUALIFIED'
  | 'QUALIFIED_BUT_DECELERATING'
  | 'WATCH'
  | 'INSUFFICIENT_EVIDENCE'
  | 'DISQUALIFIED'
  | 'DEGRADING'
  | 'REVERSING_POSITIVE'
  | 'REVERSING_NEGATIVE';

export type AlertQualityResearchDecisionReason =
  | 'ALL_GROUPS_PASS'
  | 'SOME_GROUPS_FAIL'
  | 'INSUFFICIENT_DATA_PRESENT'
  | 'TREND_IMPROVING'
  | 'TREND_DEGRADING'
  | 'TREND_STABLE'
  | 'TREND_DECELERATING'
  | 'POSITIVE_REVERSAL'
  | 'NEGATIVE_REVERSAL';

export interface AlertQualityTrendAwareDecisionReport {
  decision: AlertQualityResearchDecision;
  reasons: readonly AlertQualityResearchDecisionReason[];
  sourceReportRunId: string;
  sourceReportGeneratedAt: number;
  thresholdCounts: {
    passed: number;
    failed: number;
    insufficientData: number;
  };
  trendCounts: {
    improved: number;
    degraded: number;
    unchanged: number;
    unavailable: number;
  };
  comparisonCounts: {
    accelerating: number;
    decelerating: number;
    steady: number;
    reversing: number;
    unavailable: number;
  } | null;
}

const classifyReversal = (
  comparison: AlertQualityUnifiedTrendComparison | undefined,
): 'POSITIVE' | 'NEGATIVE' | null => {
  if (!comparison || comparison.reversingMetricCount === 0) return null;
  const reversing = comparison.metrics.filter((metric) => metric.momentum === 'REVERSING');
  const positive = reversing.filter(
    (metric) =>
      metric.baselineOverallChange === 'DEGRADED' &&
      metric.candidateOverallChange === 'IMPROVED',
  ).length;
  const negative = reversing.filter(
    (metric) =>
      metric.baselineOverallChange === 'IMPROVED' &&
      metric.candidateOverallChange === 'DEGRADED',
  ).length;
  if (positive === negative) return null;
  return positive > negative ? 'POSITIVE' : 'NEGATIVE';
};

export const evaluateAlertQualityTrendAwareDecision = (input: {
  thresholdReport: AlertQualityThresholdReport;
  trend: AlertQualityUnifiedTrend;
  trendComparison?: AlertQualityUnifiedTrendComparison;
}): AlertQualityTrendAwareDecisionReport => {
  const { thresholdReport, trend, trendComparison } = input;
  const reasons: AlertQualityResearchDecisionReason[] = [];
  const hasFailures = thresholdReport.failedCount > 0;
  const hasInsufficient = thresholdReport.insufficientDataCount > 0;
  const allPass = thresholdReport.evaluations.length > 0 && !hasFailures && !hasInsufficient;
  const improving = trend.totalImprovedMetricCount > trend.totalDegradedMetricCount;
  const degrading = trend.totalDegradedMetricCount > trend.totalImprovedMetricCount;
  const reversal = classifyReversal(trendComparison);

  if (allPass) reasons.push('ALL_GROUPS_PASS');
  if (hasFailures) reasons.push('SOME_GROUPS_FAIL');
  if (hasInsufficient) reasons.push('INSUFFICIENT_DATA_PRESENT');
  if (improving) reasons.push('TREND_IMPROVING');
  else if (degrading) reasons.push('TREND_DEGRADING');
  else reasons.push('TREND_STABLE');
  if ((trendComparison?.deceleratingMetricCount ?? 0) > 0) reasons.push('TREND_DECELERATING');
  if (reversal === 'POSITIVE') reasons.push('POSITIVE_REVERSAL');
  if (reversal === 'NEGATIVE') reasons.push('NEGATIVE_REVERSAL');

  let decision: AlertQualityResearchDecision;
  if (hasInsufficient) {
    decision = 'INSUFFICIENT_EVIDENCE';
  } else if (reversal === 'NEGATIVE') {
    decision = 'REVERSING_NEGATIVE';
  } else if (reversal === 'POSITIVE') {
    decision = hasFailures ? 'WATCH' : 'REVERSING_POSITIVE';
  } else if (allPass && (trendComparison?.deceleratingMetricCount ?? 0) > 0) {
    decision = 'QUALIFIED_BUT_DECELERATING';
  } else if (allPass && !degrading) {
    decision = 'QUALIFIED';
  } else if (hasFailures && degrading) {
    decision = 'DEGRADING';
  } else if (hasFailures) {
    decision = 'DISQUALIFIED';
  } else {
    decision = 'WATCH';
  }

  return Object.freeze({
    decision,
    reasons: Object.freeze(reasons),
    sourceReportRunId: thresholdReport.reportRunId,
    sourceReportGeneratedAt: thresholdReport.generatedAt,
    thresholdCounts: Object.freeze({
      passed: thresholdReport.passedCount,
      failed: thresholdReport.failedCount,
      insufficientData: thresholdReport.insufficientDataCount,
    }),
    trendCounts: Object.freeze({
      improved: trend.totalImprovedMetricCount,
      degraded: trend.totalDegradedMetricCount,
      unchanged: trend.totalUnchangedMetricCount,
      unavailable: trend.totalUnavailableMetricCount,
    }),
    comparisonCounts: trendComparison
      ? Object.freeze({
          accelerating: trendComparison.acceleratingMetricCount,
          decelerating: trendComparison.deceleratingMetricCount,
          steady: trendComparison.steadyMetricCount,
          reversing: trendComparison.reversingMetricCount,
          unavailable: trendComparison.unavailableMetricCount,
        })
      : null,
  });
};
