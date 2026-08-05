import type { AlertQualityUnifiedReport } from './alertQualityUnifiedReport';

export const ALERT_QUALITY_UNIFIED_COMPARISON_SCHEMA_VERSION = 1 as const;
export const ALERT_QUALITY_UNIFIED_COMPARISON_GENERATOR_VERSION =
  'alert-quality-unified-comparison-generator-v1' as const;

export type AlertQualityMetricDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
export type AlertQualityMetricChange = 'IMPROVED' | 'DEGRADED' | 'UNCHANGED' | 'UNAVAILABLE';
export type AlertQualityComparisonSection = 'TERMINAL_RETURN' | 'PATH_OUTCOME' | 'TARGET_STOP';

export interface AlertQualityMetricDelta {
  section: AlertQualityComparisonSection;
  groupKey: string;
  dimension: string;
  value: string | number | null;
  family: string | null;
  metric: string;
  direction: AlertQualityMetricDirection;
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  change: AlertQualityMetricChange;
}

export interface AlertQualityUnifiedComparison {
  schemaVersion: typeof ALERT_QUALITY_UNIFIED_COMPARISON_SCHEMA_VERSION;
  generatorVersion: typeof ALERT_QUALITY_UNIFIED_COMPARISON_GENERATOR_VERSION;
  baselineReportRunId: string;
  candidateReportRunId: string;
  baselineGeneratedAt: number;
  candidateGeneratedAt: number;
  groupingDimensions: readonly string[];
  matchedGroupCounts: {
    terminalReturn: number;
    pathOutcome: number;
    targetStop: number;
  };
  addedGroupKeys: readonly string[];
  removedGroupKeys: readonly string[];
  metrics: readonly AlertQualityMetricDelta[];
  improvedMetricCount: number;
  degradedMetricCount: number;
  unchangedMetricCount: number;
  unavailableMetricCount: number;
}

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sorted = (values: readonly string[]): string[] => [...values].sort();

const assertCompatible = (
  baseline: AlertQualityUnifiedReport,
  candidate: AlertQualityUnifiedReport,
): void => {
  if (baseline.schemaVersion !== candidate.schemaVersion) {
    throw new Error('Unified report schema versions are incompatible');
  }
  if (baseline.generatorVersion !== candidate.generatorVersion) {
    throw new Error('Unified report generator versions are incompatible');
  }
  if (!sameStrings(sorted(baseline.groupingDimensions), sorted(candidate.groupingDimensions))) {
    throw new Error('Unified report grouping dimensions are incompatible');
  }
  for (const [label, left, right] of [
    [
      'terminal-return evaluator versions',
      baseline.terminalReturn.evaluatorVersions,
      candidate.terminalReturn.evaluatorVersions,
    ],
    [
      'terminal-return policy fingerprints',
      baseline.terminalReturn.policyFingerprints,
      candidate.terminalReturn.policyFingerprints,
    ],
    [
      'path-outcome evaluator versions',
      baseline.pathOutcome.evaluatorVersions,
      candidate.pathOutcome.evaluatorVersions,
    ],
    [
      'path-outcome policy fingerprints',
      baseline.pathOutcome.policyFingerprints,
      candidate.pathOutcome.policyFingerprints,
    ],
    [
      'target-stop evaluator versions',
      baseline.targetStop.evaluatorVersions,
      candidate.targetStop.evaluatorVersions,
    ],
    [
      'target-stop policy fingerprints',
      baseline.targetStop.policyFingerprints,
      candidate.targetStop.policyFingerprints,
    ],
  ] as const) {
    if (!sameStrings(sorted(left), sorted(right))) {
      throw new Error(`Unified report ${label} are incompatible`);
    }
  }
};

const classify = (
  baseline: number | null,
  candidate: number | null,
  direction: AlertQualityMetricDirection,
): Pick<AlertQualityMetricDelta, 'delta' | 'change'> => {
  if (baseline === null || candidate === null) return { delta: null, change: 'UNAVAILABLE' };
  const delta = candidate - baseline;
  if (delta === 0) return { delta, change: 'UNCHANGED' };
  const improved = direction === 'HIGHER_IS_BETTER' ? delta > 0 : delta < 0;
  return { delta, change: improved ? 'IMPROVED' : 'DEGRADED' };
};

const metric = (input: Omit<AlertQualityMetricDelta, 'delta' | 'change'>): AlertQualityMetricDelta => ({
  ...input,
  ...classify(input.baseline, input.candidate, input.direction),
});

export const compareAlertQualityUnifiedReports = (
  baseline: AlertQualityUnifiedReport,
  candidate: AlertQualityUnifiedReport,
): AlertQualityUnifiedComparison => {
  assertCompatible(baseline, candidate);
  if (baseline.reportRunId === candidate.reportRunId && baseline.generatedAt === candidate.generatedAt) {
    throw new Error('Baseline and candidate reports must have different identities');
  }

  const metrics: AlertQualityMetricDelta[] = [];
  const addedGroupKeys: string[] = [];
  const removedGroupKeys: string[] = [];
  const matchedGroupCounts = { terminalReturn: 0, pathOutcome: 0, targetStop: 0 };

  const compareGroups = <T extends { groupKey: string; dimension: string; value: string | number | null }>(
    section: AlertQualityComparisonSection,
    baselineGroups: readonly T[],
    candidateGroups: readonly T[],
    familyOf: (group: T) => string | null,
    collect: (left: T, right: T, family: string | null) => void,
  ): number => {
    const left = new Map(baselineGroups.map((group) => [group.groupKey, group]));
    const right = new Map(candidateGroups.map((group) => [group.groupKey, group]));
    let matched = 0;
    for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const baselineGroup = left.get(key);
      const candidateGroup = right.get(key);
      if (!baselineGroup) {
        addedGroupKeys.push(`${section}:${key}`);
      } else if (!candidateGroup) {
        removedGroupKeys.push(`${section}:${key}`);
      } else {
        matched += 1;
        collect(baselineGroup, candidateGroup, familyOf(candidateGroup));
      }
    }
    return matched;
  };

  matchedGroupCounts.terminalReturn = compareGroups(
    'TERMINAL_RETURN',
    baseline.terminalReturn.groups,
    candidate.terminalReturn.groups,
    () => null,
    (left, right, family) => {
      for (const [name, direction, before, after] of [
        ['coverage.eligibleRate', 'HIGHER_IS_BETTER', left.coverage.eligibleRate, right.coverage.eligibleRate],
        ['coverage.ambiguityRate', 'LOWER_IS_BETTER', left.coverage.ambiguityRate, right.coverage.ambiguityRate],
        ['returns.okxDirectional.mean', 'HIGHER_IS_BETTER', left.returns.okxDirectionalReturnPercent.mean, right.returns.okxDirectionalReturnPercent.mean],
        ['returns.okxExecutable.mean', 'HIGHER_IS_BETTER', left.returns.okxExecutableDirectionalReturnPercent.mean, right.returns.okxExecutableDirectionalReturnPercent.mean],
        ['returns.externalExecutable.mean', 'HIGHER_IS_BETTER', left.returns.externalExecutableDirectionalReturnPercent.mean, right.returns.externalExecutableDirectionalReturnPercent.mean],
      ] as const) {
        metrics.push(metric({ section: 'TERMINAL_RETURN', groupKey: right.groupKey, dimension: right.dimension, value: right.value, family, metric: name, direction, baseline: before, candidate: after }));
      }
    },
  );

  matchedGroupCounts.pathOutcome = compareGroups(
    'PATH_OUTCOME',
    baseline.pathOutcome.groups,
    candidate.pathOutcome.groups,
    () => null,
    (left, right, family) => {
      for (const [name, direction, before, after] of [
        ['executableOkx.mfe.mean', 'HIGHER_IS_BETTER', left.metrics.executableOkx.favorableExcursionPercent.mean, right.metrics.executableOkx.favorableExcursionPercent.mean],
        ['executableOkx.mae.mean', 'LOWER_IS_BETTER', left.metrics.executableOkx.adverseExcursionPercent.mean, right.metrics.executableOkx.adverseExcursionPercent.mean],
        ['executableExternal.mfe.mean', 'HIGHER_IS_BETTER', left.metrics.executableExternal.favorableExcursionPercent.mean, right.metrics.executableExternal.favorableExcursionPercent.mean],
        ['executableExternal.mae.mean', 'LOWER_IS_BETTER', left.metrics.executableExternal.adverseExcursionPercent.mean, right.metrics.executableExternal.adverseExcursionPercent.mean],
      ] as const) {
        metrics.push(metric({ section: 'PATH_OUTCOME', groupKey: right.groupKey, dimension: right.dimension, value: right.value, family, metric: name, direction, baseline: before, candidate: after }));
      }
    },
  );

  matchedGroupCounts.targetStop = compareGroups(
    'TARGET_STOP',
    baseline.targetStop.groups,
    candidate.targetStop.groups,
    (group) => group.family,
    (left, right, family) => {
      for (const [name, direction, before, after] of [
        ['targetFirstRateAmongResolved', 'HIGHER_IS_BETTER', left.statistics.targetFirstRateAmongResolved, right.statistics.targetFirstRateAmongResolved],
        ['stopFirstRateAmongResolved', 'LOWER_IS_BETTER', left.statistics.stopFirstRateAmongResolved, right.statistics.stopFirstRateAmongResolved],
        ['ambiguityRateAmongEligible', 'LOWER_IS_BETTER', left.statistics.ambiguityRateAmongEligible, right.statistics.ambiguityRateAmongEligible],
      ] as const) {
        metrics.push(metric({ section: 'TARGET_STOP', groupKey: right.groupKey, dimension: right.dimension, value: right.value, family, metric: name, direction, baseline: before, candidate: after }));
      }
    },
  );

  metrics.sort((left, right) =>
    `${left.section}:${left.groupKey}:${left.metric}`.localeCompare(
      `${right.section}:${right.groupKey}:${right.metric}`,
    ),
  );

  return Object.freeze({
    schemaVersion: ALERT_QUALITY_UNIFIED_COMPARISON_SCHEMA_VERSION,
    generatorVersion: ALERT_QUALITY_UNIFIED_COMPARISON_GENERATOR_VERSION,
    baselineReportRunId: baseline.reportRunId,
    candidateReportRunId: candidate.reportRunId,
    baselineGeneratedAt: baseline.generatedAt,
    candidateGeneratedAt: candidate.generatedAt,
    groupingDimensions: Object.freeze([...baseline.groupingDimensions]),
    matchedGroupCounts: Object.freeze(matchedGroupCounts),
    addedGroupKeys: Object.freeze(addedGroupKeys.sort()),
    removedGroupKeys: Object.freeze(removedGroupKeys.sort()),
    metrics: Object.freeze(metrics),
    improvedMetricCount: metrics.filter((entry) => entry.change === 'IMPROVED').length,
    degradedMetricCount: metrics.filter((entry) => entry.change === 'DEGRADED').length,
    unchangedMetricCount: metrics.filter((entry) => entry.change === 'UNCHANGED').length,
    unavailableMetricCount: metrics.filter((entry) => entry.change === 'UNAVAILABLE').length,
  });
};
