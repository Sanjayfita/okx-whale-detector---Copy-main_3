export type StrategyCandidateMetricDirection =
  'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';

export interface StrategyCandidateMetricInput {
  name: string;
  direction: StrategyCandidateMetricDirection;
  baseline: number | null;
  candidate: number | null;
  normalizationScale: number;
  weight?: number;
}

export interface StrategyCandidateMetricComparison {
  name: string;
  direction: StrategyCandidateMetricDirection;
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  normalizationScale: number;
  weightedScore: number | null;
  outcome: 'IMPROVED' | 'DEGRADED' | 'UNCHANGED' | 'UNAVAILABLE';
}

export interface StrategyCandidateComparison {
  baselineCandidateId: string;
  candidateCandidateId: string;
  metrics: readonly StrategyCandidateMetricComparison[];
  improvedCount: number;
  degradedCount: number;
  unchangedCount: number;
  unavailableCount: number;
  totalWeightedScore: number;
  verdict: 'BETTER' | 'WORSE' | 'EQUIVALENT' | 'INSUFFICIENT_DATA';
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export const compareStrategyCandidates = (input: {
  baselineCandidateId: string;
  candidateCandidateId: string;
  metrics: readonly StrategyCandidateMetricInput[];
}): StrategyCandidateComparison => {
  if (!IDENTIFIER_PATTERN.test(input.baselineCandidateId)) {
    throw new Error('baselineCandidateId must be a valid durable identifier');
  }
  if (!IDENTIFIER_PATTERN.test(input.candidateCandidateId)) {
    throw new Error('candidateCandidateId must be a valid durable identifier');
  }
  if (input.baselineCandidateId === input.candidateCandidateId) {
    throw new Error(
      'Candidate comparison requires two different candidate IDs',
    );
  }
  if (input.metrics.length === 0)
    throw new Error('metrics must contain at least one metric');

  const names = new Set<string>();
  const metrics = input.metrics
    .map((metric): StrategyCandidateMetricComparison => {
      if (metric.name.trim() === '' || metric.name !== metric.name.trim()) {
        throw new Error('Metric name must be non-empty and normalized');
      }
      if (names.has(metric.name))
        throw new Error(`Duplicate metric name: ${metric.name}`);
      names.add(metric.name);
      if (
        metric.direction !== 'HIGHER_IS_BETTER' &&
        metric.direction !== 'LOWER_IS_BETTER'
      ) {
        throw new Error(`Metric ${metric.name} direction is invalid`);
      }
      const weight = metric.weight ?? 1;
      if (!Number.isFinite(weight) || weight <= 0)
        throw new Error('Metric weight must be positive');
      if (
        !Number.isFinite(metric.normalizationScale) ||
        metric.normalizationScale <= 0
      ) {
        throw new Error(
          `Metric ${metric.name} normalizationScale must be positive`,
        );
      }
      if (metric.baseline === null || metric.candidate === null) {
        return Object.freeze({
          name: metric.name,
          direction: metric.direction,
          baseline: metric.baseline,
          candidate: metric.candidate,
          normalizationScale: metric.normalizationScale,
          delta: null,
          weightedScore: null,
          outcome: 'UNAVAILABLE',
        });
      }
      if (
        !Number.isFinite(metric.baseline) ||
        !Number.isFinite(metric.candidate)
      ) {
        throw new Error(`Metric ${metric.name} values must be finite or null`);
      }
      const delta = metric.candidate - metric.baseline;
      const directionalDelta =
        (metric.direction === 'HIGHER_IS_BETTER' ? delta : -delta) /
        metric.normalizationScale;
      return Object.freeze({
        name: metric.name,
        direction: metric.direction,
        baseline: metric.baseline,
        candidate: metric.candidate,
        delta,
        normalizationScale: metric.normalizationScale,
        weightedScore: directionalDelta * weight,
        outcome:
          directionalDelta > 0
            ? 'IMPROVED'
            : directionalDelta < 0
              ? 'DEGRADED'
              : 'UNCHANGED',
      });
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const improvedCount = metrics.filter(
    (metric) => metric.outcome === 'IMPROVED',
  ).length;
  const degradedCount = metrics.filter(
    (metric) => metric.outcome === 'DEGRADED',
  ).length;
  const unchangedCount = metrics.filter(
    (metric) => metric.outcome === 'UNCHANGED',
  ).length;
  const unavailableCount = metrics.filter(
    (metric) => metric.outcome === 'UNAVAILABLE',
  ).length;
  const available = metrics.filter((metric) => metric.weightedScore !== null);
  const totalWeightedScore = available.reduce(
    (sum, metric) => sum + (metric.weightedScore ?? 0),
    0,
  );
  const verdict =
    available.length === 0
      ? 'INSUFFICIENT_DATA'
      : totalWeightedScore > 0
        ? 'BETTER'
        : totalWeightedScore < 0
          ? 'WORSE'
          : 'EQUIVALENT';

  return Object.freeze({
    baselineCandidateId: input.baselineCandidateId,
    candidateCandidateId: input.candidateCandidateId,
    metrics: Object.freeze(metrics),
    improvedCount,
    degradedCount,
    unchangedCount,
    unavailableCount,
    totalWeightedScore,
    verdict,
  });
};
