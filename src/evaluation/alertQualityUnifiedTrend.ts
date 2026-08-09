import {
  compareAlertQualityUnifiedReports,
  type AlertQualityMetricChange,
  type AlertQualityUnifiedComparison,
} from './alertQualityUnifiedComparison';
import type { AlertQualityUnifiedReport } from './alertQualityUnifiedReport';

export const ALERT_QUALITY_UNIFIED_TREND_SCHEMA_VERSION = 1 as const;
export const ALERT_QUALITY_UNIFIED_TREND_GENERATOR_VERSION =
  'alert-quality-unified-trend-generator-v1' as const;

export interface AlertQualityTrendReportPoint {
  reportRunId: string;
  generatedAt: number;
  inputRecordCounts: {
    terminalReturn: number;
    pathOutcome: number;
    targetStop: number;
  };
}

export interface AlertQualityTrendTransition {
  baselineReportRunId: string;
  candidateReportRunId: string;
  baselineGeneratedAt: number;
  candidateGeneratedAt: number;
  comparison: AlertQualityUnifiedComparison;
}

export interface AlertQualityTrendMetricSummary {
  metricKey: string;
  section: string;
  groupKey: string;
  family: string | null;
  metric: string;
  observedTransitionCount: number;
  improvedCount: number;
  degradedCount: number;
  unchangedCount: number;
  unavailableCount: number;
  netDelta: number | null;
  firstObservedValue: number | null;
  lastObservedValue: number | null;
  overallChange: AlertQualityMetricChange;
}

export interface AlertQualityUnifiedTrend {
  schemaVersion: typeof ALERT_QUALITY_UNIFIED_TREND_SCHEMA_VERSION;
  generatorVersion: typeof ALERT_QUALITY_UNIFIED_TREND_GENERATOR_VERSION;
  groupingDimensions: readonly string[];
  reports: readonly AlertQualityTrendReportPoint[];
  transitions: readonly AlertQualityTrendTransition[];
  metrics: readonly AlertQualityTrendMetricSummary[];
  totalImprovedMetricCount: number;
  totalDegradedMetricCount: number;
  totalUnchangedMetricCount: number;
  totalUnavailableMetricCount: number;
}

const reportIdentity = (report: AlertQualityUnifiedReport): string =>
  `${report.generatedAt}:${report.reportRunId}`;

const metricKey = (input: {
  section: string;
  groupKey: string;
  family: string | null;
  metric: string;
}): string =>
  [input.section, input.groupKey, input.family ?? '', input.metric].join(':');

const classifyOverall = (
  first: number | null,
  last: number | null,
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER',
): AlertQualityMetricChange => {
  if (first === null || last === null) return 'UNAVAILABLE';
  const delta = last - first;
  if (delta === 0) return 'UNCHANGED';
  const improved = direction === 'HIGHER_IS_BETTER' ? delta > 0 : delta < 0;
  return improved ? 'IMPROVED' : 'DEGRADED';
};

export const buildAlertQualityUnifiedTrend = (
  reports: readonly AlertQualityUnifiedReport[],
): AlertQualityUnifiedTrend => {
  if (reports.length < 2) {
    throw new Error('Alert-quality trend requires at least two reports');
  }

  const ordered = [...reports].sort(
    (left, right) =>
      left.generatedAt - right.generatedAt || left.reportRunId.localeCompare(right.reportRunId),
  );
  const identities = ordered.map(reportIdentity);
  if (new Set(identities).size !== identities.length) {
    throw new Error('Alert-quality trend report identities must be unique');
  }

  const transitions: AlertQualityTrendTransition[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const baseline = ordered[index - 1]!;
    const candidate = ordered[index]!;
    transitions.push(
      Object.freeze({
        baselineReportRunId: baseline.reportRunId,
        candidateReportRunId: candidate.reportRunId,
        baselineGeneratedAt: baseline.generatedAt,
        candidateGeneratedAt: candidate.generatedAt,
        comparison: compareAlertQualityUnifiedReports(baseline, candidate),
      }),
    );
  }

  const summaries = new Map<
    string,
    {
      section: string;
      groupKey: string;
      family: string | null;
      metric: string;
      direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
      changes: AlertQualityMetricChange[];
      deltas: number[];
      first: number | null;
      last: number | null;
    }
  >();

  transitions.forEach(({ comparison }) => {
    comparison.metrics.forEach((entry) => {
      const key = metricKey(entry);
      const summary = summaries.get(key) ?? {
        section: entry.section,
        groupKey: entry.groupKey,
        family: entry.family,
        metric: entry.metric,
        direction: entry.direction,
        changes: [],
        deltas: [],
        first: entry.baseline,
        last: entry.candidate,
      };
      summary.changes.push(entry.change);
      if (entry.delta !== null) summary.deltas.push(entry.delta);
      if (summary.first === null && entry.baseline !== null) summary.first = entry.baseline;
      summary.last = entry.candidate;
      summaries.set(key, summary);
    });
  });

  const metrics = [...summaries.entries()]
    .map(([key, summary]): AlertQualityTrendMetricSummary => ({
      metricKey: key,
      section: summary.section,
      groupKey: summary.groupKey,
      family: summary.family,
      metric: summary.metric,
      observedTransitionCount: summary.changes.length,
      improvedCount: summary.changes.filter((change) => change === 'IMPROVED').length,
      degradedCount: summary.changes.filter((change) => change === 'DEGRADED').length,
      unchangedCount: summary.changes.filter((change) => change === 'UNCHANGED').length,
      unavailableCount: summary.changes.filter((change) => change === 'UNAVAILABLE').length,
      netDelta:
        summary.deltas.length === 0
          ? null
          : summary.deltas.reduce((total, delta) => total + delta, 0),
      firstObservedValue: summary.first,
      lastObservedValue: summary.last,
      overallChange: classifyOverall(summary.first, summary.last, summary.direction),
    }))
    .sort((left, right) => left.metricKey.localeCompare(right.metricKey));

  return Object.freeze({
    schemaVersion: ALERT_QUALITY_UNIFIED_TREND_SCHEMA_VERSION,
    generatorVersion: ALERT_QUALITY_UNIFIED_TREND_GENERATOR_VERSION,
    groupingDimensions: Object.freeze([...ordered[0]!.groupingDimensions]),
    reports: Object.freeze(
      ordered.map((report) =>
        Object.freeze({
          reportRunId: report.reportRunId,
          generatedAt: report.generatedAt,
          inputRecordCounts: Object.freeze({ ...report.inputRecordCounts }),
        }),
      ),
    ),
    transitions: Object.freeze(transitions),
    metrics: Object.freeze(metrics),
    totalImprovedMetricCount: transitions.reduce(
      (total, transition) => total + transition.comparison.improvedMetricCount,
      0,
    ),
    totalDegradedMetricCount: transitions.reduce(
      (total, transition) => total + transition.comparison.degradedMetricCount,
      0,
    ),
    totalUnchangedMetricCount: transitions.reduce(
      (total, transition) => total + transition.comparison.unchangedMetricCount,
      0,
    ),
    totalUnavailableMetricCount: transitions.reduce(
      (total, transition) => total + transition.comparison.unavailableMetricCount,
      0,
    ),
  });
};
