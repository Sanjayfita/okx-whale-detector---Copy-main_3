import type {
  AlertQualityTrendMetricSummary,
  AlertQualityUnifiedTrend,
} from './alertQualityUnifiedTrend';

export type AlertQualityTrendMomentum =
  | 'ACCELERATING'
  | 'DECELERATING'
  | 'STEADY'
  | 'REVERSING'
  | 'UNAVAILABLE';

export interface AlertQualityTrendComparisonMetric {
  metricKey: string;
  baselineOverallChange: AlertQualityTrendMetricSummary['overallChange'];
  candidateOverallChange: AlertQualityTrendMetricSummary['overallChange'];
  baselineNetDelta: number | null;
  candidateNetDelta: number | null;
  deltaChange: number | null;
  momentum: AlertQualityTrendMomentum;
}

export interface AlertQualityUnifiedTrendComparison {
  groupingDimensions: readonly string[];
  baselineReportCount: number;
  candidateReportCount: number;
  metrics: readonly AlertQualityTrendComparisonMetric[];
  acceleratingMetricCount: number;
  deceleratingMetricCount: number;
  steadyMetricCount: number;
  reversingMetricCount: number;
  unavailableMetricCount: number;
  addedMetricKeys: readonly string[];
  removedMetricKeys: readonly string[];
}

const normalizedDimensions = (dimensions: readonly string[]): string =>
  JSON.stringify([...dimensions].sort());

const classifyMomentum = (
  baseline: AlertQualityTrendMetricSummary,
  candidate: AlertQualityTrendMetricSummary,
): AlertQualityTrendMomentum => {
  if (baseline.netDelta === null || candidate.netDelta === null) return 'UNAVAILABLE';
  if (
    baseline.overallChange !== 'UNCHANGED' &&
    candidate.overallChange !== 'UNCHANGED' &&
    baseline.overallChange !== candidate.overallChange
  ) {
    return 'REVERSING';
  }
  const baselineMagnitude = Math.abs(baseline.netDelta);
  const candidateMagnitude = Math.abs(candidate.netDelta);
  if (candidateMagnitude > baselineMagnitude) return 'ACCELERATING';
  if (candidateMagnitude < baselineMagnitude) return 'DECELERATING';
  return 'STEADY';
};

export const compareAlertQualityUnifiedTrends = (
  baseline: AlertQualityUnifiedTrend,
  candidate: AlertQualityUnifiedTrend,
): AlertQualityUnifiedTrendComparison => {
  if (baseline.schemaVersion !== candidate.schemaVersion) {
    throw new Error('Alert-quality trend schema versions are incompatible');
  }
  if (baseline.generatorVersion !== candidate.generatorVersion) {
    throw new Error('Alert-quality trend generator versions are incompatible');
  }
  if (
    normalizedDimensions(baseline.groupingDimensions) !==
    normalizedDimensions(candidate.groupingDimensions)
  ) {
    throw new Error('Alert-quality trend grouping dimensions are incompatible');
  }

  const baselineByKey = new Map(baseline.metrics.map((metric) => [metric.metricKey, metric]));
  const candidateByKey = new Map(candidate.metrics.map((metric) => [metric.metricKey, metric]));
  const sharedKeys = [...baselineByKey.keys()]
    .filter((key) => candidateByKey.has(key))
    .sort();
  const addedMetricKeys = [...candidateByKey.keys()]
    .filter((key) => !baselineByKey.has(key))
    .sort();
  const removedMetricKeys = [...baselineByKey.keys()]
    .filter((key) => !candidateByKey.has(key))
    .sort();

  const metrics = sharedKeys.map((metricKey): AlertQualityTrendComparisonMetric => {
    const baselineMetric = baselineByKey.get(metricKey)!;
    const candidateMetric = candidateByKey.get(metricKey)!;
    return Object.freeze({
      metricKey,
      baselineOverallChange: baselineMetric.overallChange,
      candidateOverallChange: candidateMetric.overallChange,
      baselineNetDelta: baselineMetric.netDelta,
      candidateNetDelta: candidateMetric.netDelta,
      deltaChange:
        baselineMetric.netDelta === null || candidateMetric.netDelta === null
          ? null
          : candidateMetric.netDelta - baselineMetric.netDelta,
      momentum: classifyMomentum(baselineMetric, candidateMetric),
    });
  });

  const count = (momentum: AlertQualityTrendMomentum): number =>
    metrics.filter((metric) => metric.momentum === momentum).length;

  return Object.freeze({
    groupingDimensions: Object.freeze([...baseline.groupingDimensions]),
    baselineReportCount: baseline.reports.length,
    candidateReportCount: candidate.reports.length,
    metrics: Object.freeze(metrics),
    acceleratingMetricCount: count('ACCELERATING'),
    deceleratingMetricCount: count('DECELERATING'),
    steadyMetricCount: count('STEADY'),
    reversingMetricCount: count('REVERSING'),
    unavailableMetricCount: count('UNAVAILABLE'),
    addedMetricKeys: Object.freeze(addedMetricKeys),
    removedMetricKeys: Object.freeze(removedMetricKeys),
  });
};
