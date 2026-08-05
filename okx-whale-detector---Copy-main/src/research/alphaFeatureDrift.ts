import type {
  AlphaFeatureDriftClassification,
  AlphaFeatureDriftEntry,
} from './alphaAnalysisTypes';
import type {
  AlphaFeatureName,
  AlphaResearchDatasetRow,
} from './alphaFeatureTypes';
import { alphaQuantile } from './alphaStatistics';

const createCutPoints = (
  values: readonly number[],
  binCount: number,
): readonly number[] => {
  const cuts: number[] = [];
  for (let bin = 1; bin < binCount; bin += 1) {
    const cut = alphaQuantile(values, bin / binCount);
    const priorCut = cuts.at(-1);
    if (cut !== null && (priorCut === undefined || cut > priorCut)) {
      cuts.push(cut);
    }
  }
  if (cuts.length === 0) {
    const median = alphaQuantile(values, 0.5);
    if (median !== null) cuts.push(median);
  }
  return Object.freeze(cuts);
};

const valueBin = (value: number, cuts: readonly number[]): number => {
  for (let index = 0; index < cuts.length; index += 1) {
    const cut = cuts[index];
    if (cut !== undefined && value <= cut) return index;
  }
  return cuts.length;
};

export const calculatePopulationStabilityIndex = (input: {
  readonly discoveryValues: readonly (number | null)[];
  readonly holdoutValues: readonly (number | null)[];
  readonly binCount: number;
  readonly minimumSamples: number;
}): number | null => {
  if (!Number.isSafeInteger(input.binCount) || input.binCount < 2) {
    throw new Error('PSI binCount must be an integer of at least 2');
  }
  if (!Number.isSafeInteger(input.minimumSamples) || input.minimumSamples < 1) {
    throw new Error('PSI minimumSamples must be a positive integer');
  }
  if (
    input.discoveryValues.some(
      (value) => value !== null && !Number.isFinite(value),
    ) ||
    input.holdoutValues.some(
      (value) => value !== null && !Number.isFinite(value),
    )
  ) {
    throw new Error('PSI inputs must be finite or null');
  }
  const discoveryAvailable = input.discoveryValues.filter(
    (value): value is number => value !== null,
  );
  const holdoutAvailable = input.holdoutValues.filter(
    (value): value is number => value !== null,
  );
  if (
    discoveryAvailable.length < input.minimumSamples ||
    holdoutAvailable.length < input.minimumSamples
  ) {
    return null;
  }
  const cuts = createCutPoints(discoveryAvailable, input.binCount);
  const bucketCount = cuts.length + 2;
  const discoveryCounts = Array.from({ length: bucketCount }, () => 0);
  const holdoutCounts = Array.from({ length: bucketCount }, () => 0);
  const missingBucket = bucketCount - 1;
  for (const value of input.discoveryValues) {
    const bucket = value === null ? missingBucket : valueBin(value, cuts);
    discoveryCounts[bucket] = (discoveryCounts[bucket] ?? 0) + 1;
  }
  for (const value of input.holdoutValues) {
    const bucket = value === null ? missingBucket : valueBin(value, cuts);
    holdoutCounts[bucket] = (holdoutCounts[bucket] ?? 0) + 1;
  }
  const smoothing = 0.5;
  const discoveryDenominator =
    input.discoveryValues.length + smoothing * bucketCount;
  const holdoutDenominator =
    input.holdoutValues.length + smoothing * bucketCount;
  let stabilityIndex = 0;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const discoveryShare =
      ((discoveryCounts[bucket] ?? 0) + smoothing) / discoveryDenominator;
    const holdoutShare =
      ((holdoutCounts[bucket] ?? 0) + smoothing) / holdoutDenominator;
    stabilityIndex +=
      (holdoutShare - discoveryShare) * Math.log(holdoutShare / discoveryShare);
  }
  return stabilityIndex;
};

const classify = (
  psi: number | null,
  moderateThreshold: number,
  materialThreshold: number,
): AlphaFeatureDriftClassification =>
  psi === null
    ? 'INCONCLUSIVE'
    : psi >= materialThreshold
      ? 'MATERIAL_DRIFT'
      : psi >= moderateThreshold
        ? 'MODERATE_DRIFT'
        : 'STABLE';

export const analyzeAlphaFeatureDrift = (input: {
  readonly discoveryRows: readonly AlphaResearchDatasetRow[];
  readonly holdoutRows: readonly AlphaResearchDatasetRow[];
  readonly features: readonly AlphaFeatureName[];
  readonly binCount: number;
  readonly minimumSamples: number;
  readonly moderateThreshold: number;
  readonly materialThreshold: number;
}): readonly AlphaFeatureDriftEntry[] => {
  if (
    !Number.isFinite(input.moderateThreshold) ||
    !Number.isFinite(input.materialThreshold) ||
    input.moderateThreshold < 0 ||
    input.materialThreshold <= input.moderateThreshold
  ) {
    throw new Error('PSI thresholds must be finite and strictly increasing');
  }
  return Object.freeze(
    input.features.map((feature) => {
      const discoveryValues = input.discoveryRows.map(
        (row) => row.features[feature],
      );
      const holdoutValues = input.holdoutRows.map(
        (row) => row.features[feature],
      );
      const discoverySamples = discoveryValues.filter(
        (value) => value !== null,
      ).length;
      const holdoutSamples = holdoutValues.filter(
        (value) => value !== null,
      ).length;
      const populationStabilityIndex = calculatePopulationStabilityIndex({
        discoveryValues,
        holdoutValues,
        binCount: input.binCount,
        minimumSamples: input.minimumSamples,
      });
      return Object.freeze({
        feature,
        discoverySamples,
        holdoutSamples,
        discoveryMissingFraction:
          discoveryValues.length === 0
            ? 1
            : 1 - discoverySamples / discoveryValues.length,
        holdoutMissingFraction:
          holdoutValues.length === 0
            ? 1
            : 1 - holdoutSamples / holdoutValues.length,
        populationStabilityIndex,
        classification: classify(
          populationStabilityIndex,
          input.moderateThreshold,
          input.materialThreshold,
        ),
      });
    }),
  );
};
