import type {
  AlphaBayesianBootstrapEstimate,
  AlphaBootstrapEstimate,
  AlphaConditionalEffectEstimate,
} from './alphaAnalysisTypes';
import type { AlphaResearchDatasetRow } from './alphaFeatureTypes';
import { requireArrayElement } from '../core/arrayAccess';

const finiteCompensatedSum = (values: readonly number[]): number => {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error('Statistical inputs must contain only finite values');
    }
    const next = sum + value;
    compensation +=
      Math.abs(sum) >= Math.abs(value)
        ? sum - next + value
        : value - next + sum;
    sum = next;
  }
  return sum + compensation;
};

export const alphaMean = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  return finiteCompensatedSum(values) / values.length;
};

export const alphaSampleStandardDeviation = (
  values: readonly number[],
): number | null => {
  if (values.length < 2) return null;
  const average = alphaMean(values);
  if (average === null) return null;
  const squaredDifferenceSum = finiteCompensatedSum(
    values.map((value) => (value - average) ** 2),
  );
  const variance = squaredDifferenceSum / (values.length - 1);
  return Math.sqrt(variance);
};

export const alphaPopulationStandardDeviation = (
  values: readonly number[],
): number | null => {
  if (values.length === 0) return null;
  const average = alphaMean(values);
  if (average === null) return null;
  const squaredDifferenceSum = finiteCompensatedSum(
    values.map((value) => (value - average) ** 2),
  );
  return Math.sqrt(squaredDifferenceSum / values.length);
};

export const alphaEventSharpe = (values: readonly number[]): number | null => {
  const average = alphaMean(values);
  const deviation = alphaSampleStandardDeviation(values);
  return average === null || deviation === null || deviation === 0
    ? null
    : average / deviation;
};

export const alphaQuantile = (
  values: readonly number[],
  probability: number,
): number | null => {
  if (values.length === 0) return null;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('probability must be between 0 and 1');
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Quantile inputs must contain only finite values');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = requireArrayElement(sorted, lowerIndex, 'quantile lower');
  const upper = requireArrayElement(sorted, upperIndex, 'quantile upper');
  return lower + (upper - lower) * (position - lowerIndex);
};

export const alphaTrimmedMean = (
  values: readonly number[],
  trimFraction: number,
): number | null => {
  if (
    !Number.isFinite(trimFraction) ||
    trimFraction < 0 ||
    trimFraction >= 0.5
  ) {
    throw new Error('trimFraction must be between 0 (inclusive) and 0.5');
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const trimmedPerTail = Math.floor(sorted.length * trimFraction);
  return alphaMean(
    sorted.slice(trimmedPerTail, sorted.length - trimmedPerTail),
  );
};

export const alphaPearsonCorrelation = (
  left: readonly number[],
  right: readonly number[],
): number | null => {
  if (left.length !== right.length) {
    throw new Error('Correlation inputs must have the same length');
  }
  if (left.length < 3) return null;
  const leftMean = alphaMean(left);
  const rightMean = alphaMean(right);
  if (leftMean === null || rightMean === null) return null;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDifference =
      requireArrayElement(left, index, 'left correlation') - leftMean;
    const rightDifference =
      requireArrayElement(right, index, 'right correlation') - rightMean;
    covariance += leftDifference * rightDifference;
    leftVariance += leftDifference ** 2;
    rightVariance += rightDifference ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator === 0 ? null : covariance / denominator;
};

const averageRanks = (values: readonly number[]): readonly number[] => {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort(
    (left, right) => left.value - right.value || left.index - right.index,
  );
  const ranks = Array.from({ length: values.length }, () => 0);
  let start = 0;
  while (start < indexed.length) {
    const startEntry = requireArrayElement(indexed, start, 'rank start');
    let end = start + 1;
    while (
      end < indexed.length &&
      requireArrayElement(indexed, end, 'rank end').value === startEntry.value
    ) {
      end += 1;
    }
    const averageRank = (start + end - 1) / 2;
    for (let index = start; index < end; index += 1) {
      const rankIndex = requireArrayElement(indexed, index, 'rank entry').index;
      ranks[rankIndex] = averageRank;
    }
    start = end;
  }
  return Object.freeze(ranks);
};

export const alphaSpearmanCorrelation = (
  left: readonly number[],
  right: readonly number[],
): number | null => {
  if (left.length !== right.length) {
    throw new Error('Correlation inputs must have the same length');
  }
  if (left.length < 3) return null;
  return alphaPearsonCorrelation(averageRanks(left), averageRanks(right));
};

const binCutPoints = (
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
  return Object.freeze(cuts);
};

const binIndex = (value: number, cutPoints: readonly number[]): number => {
  for (let index = 0; index < cutPoints.length; index += 1) {
    if (value <= requireArrayElement(cutPoints, index, 'bin cut point')) {
      return index;
    }
  }
  return cutPoints.length;
};

export const alphaMutualInformation = (
  featureValues: readonly number[],
  targetValues: readonly number[],
  binCount: number,
): number | null => {
  if (featureValues.length !== targetValues.length) {
    throw new Error('Mutual-information inputs must have the same length');
  }
  if (!Number.isSafeInteger(binCount) || binCount < 2) {
    throw new Error('binCount must be an integer of at least 2');
  }
  if (featureValues.length < binCount * 2) return null;
  const featureCuts = binCutPoints(featureValues, binCount);
  const targetCuts = binCutPoints(targetValues, binCount);
  if (featureCuts.length === 0 || targetCuts.length === 0) return 0;

  const joint = new Map<string, number>();
  const featureCounts = new Map<number, number>();
  const targetCounts = new Map<number, number>();
  for (let index = 0; index < featureValues.length; index += 1) {
    const featureBin = binIndex(
      requireArrayElement(featureValues, index, 'mutual-information feature'),
      featureCuts,
    );
    const targetBin = binIndex(
      requireArrayElement(targetValues, index, 'mutual-information target'),
      targetCuts,
    );
    const key = `${featureBin}:${targetBin}`;
    joint.set(key, (joint.get(key) ?? 0) + 1);
    featureCounts.set(featureBin, (featureCounts.get(featureBin) ?? 0) + 1);
    targetCounts.set(targetBin, (targetCounts.get(targetBin) ?? 0) + 1);
  }
  let information = 0;
  const sampleSize = featureValues.length;
  for (const [key, count] of joint) {
    const [featureBinText, targetBinText] = key.split(':');
    const featureBin = Number(featureBinText);
    const targetBin = Number(targetBinText);
    const featureCount = featureCounts.get(featureBin) ?? 0;
    const targetCount = targetCounts.get(targetBin) ?? 0;
    if (featureCount === 0 || targetCount === 0) continue;
    const jointProbability = count / sampleSize;
    information +=
      jointProbability *
      Math.log(
        jointProbability /
          ((featureCount / sampleSize) * (targetCount / sampleSize)),
      );
  }
  return information;
};

export const createAlphaRandom = (seed: number): (() => number) => {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error('seed must be an unsigned 32-bit integer');
  }
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const inverseStandardNormal = (probability: number): number => {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new Error('Normal probability must be strictly between 0 and 1');
  }
  const a = [
    -39.696_830_286_653_76, 220.946_098_424_520_5, -275.928_510_446_968_7,
    138.357_751_867_269, -30.664_798_066_147_16, 2.506_628_277_459_239,
  ] as const;
  const b = [
    -54.476_098_798_224_06, 161.585_836_858_040_9, -155.698_979_859_886_6,
    66.801_311_887_719_72, -13.280_681_552_885_72,
  ] as const;
  const c = [
    -0.007_784_894_002_430_293, -0.322_396_458_041_136_5,
    -2.400_758_277_161_838, -2.549_732_539_343_734, 4.374_664_141_464_968,
    2.938_163_982_698_783,
  ] as const;
  const d = [
    0.007_784_695_709_041_462, 0.322_467_129_070_039_8, 2.445_134_137_142_996,
    3.754_408_661_907_416,
  ] as const;
  const lowerTail = 0.024_25;
  const upperTail = 1 - lowerTail;
  if (probability < lowerTail) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (probability > upperTail) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = probability - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
};

export const shuffledAlphaIndices = (
  length: number,
  random: () => number,
): readonly number[] => {
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = requireArrayElement(indices, index, 'shuffle source');
    indices[index] = requireArrayElement(
      indices,
      swapIndex,
      'shuffle destination',
    );
    indices[swapIndex] = value;
  }
  return Object.freeze(indices);
};

export const assignAlphaEpisodeIds = (
  rows: readonly AlphaResearchDatasetRow[],
  episodeWindowMs: number,
): ReadonlyMap<string, string> => {
  if (!Number.isSafeInteger(episodeWindowMs) || episodeWindowMs <= 0) {
    throw new Error('episodeWindowMs must be a positive safe integer');
  }
  const ordered = [...rows].sort(
    (left, right) =>
      left.detectedAt - right.detectedAt ||
      left.alertId.localeCompare(right.alertId),
  );
  const states = new Map<string, { lastTimestamp: number; episode: number }>();
  const ids = new Map<string, string>();
  for (const row of ordered) {
    const key = `${row.instrumentId}:${row.direction}`;
    const prior = states.get(key);
    const episode =
      prior === undefined ||
      row.detectedAt - prior.lastTimestamp > episodeWindowMs
        ? (prior?.episode ?? -1) + 1
        : prior.episode;
    states.set(key, { lastTimestamp: row.detectedAt, episode });
    ids.set(row.alertId, `${key}:${episode}`);
  }
  return ids;
};

export const bootstrapAlphaEstimate = (input: {
  readonly rows: readonly AlphaResearchDatasetRow[];
  readonly episodeIds: ReadonlyMap<string, string>;
  readonly iterations: number;
  readonly confidenceLevel: number;
  readonly seed: number;
  readonly targetPower?: number;
  readonly trimFraction?: number;
}): AlphaBootstrapEstimate => {
  if (!Number.isSafeInteger(input.iterations) || input.iterations < 1) {
    throw new Error('Bootstrap iterations must be a positive safe integer');
  }
  if (
    !Number.isFinite(input.confidenceLevel) ||
    input.confidenceLevel <= 0.5 ||
    input.confidenceLevel >= 1
  ) {
    throw new Error('Bootstrap confidenceLevel must be between 0.5 and 1');
  }
  const targetPower = input.targetPower ?? 0.8;
  if (!Number.isFinite(targetPower) || targetPower <= 0.5 || targetPower >= 1) {
    throw new Error('targetPower must be between 0.5 and 1');
  }
  const trimFraction = input.trimFraction ?? 0.1;
  const returns = input.rows.map((row) => row.netReturnPercent);
  const pointMean = alphaMean(returns);
  const median = alphaQuantile(returns, 0.5);
  const trimmedMean = alphaTrimmedMean(returns, trimFraction);
  const eventSharpe = alphaEventSharpe(returns);
  if (input.rows.length === 0) {
    return Object.freeze({
      sampleSize: 0,
      independentEpisodeCount: 0,
      meanPercent: null,
      medianPercent: null,
      trimmedMeanPercent: null,
      eventSharpe: null,
      clusterRobustStandardErrorPercent: null,
      minimumDetectableEffectPercent: null,
      lowerConfidencePercent: null,
      upperConfidencePercent: null,
      probabilityPositive: null,
      oneSidedPValue: null,
    });
  }
  if (pointMean === null) {
    throw new Error('Bootstrap point estimate could not be calculated');
  }

  const episodeRows = new Map<string, number[]>();
  for (const row of input.rows) {
    const episodeId = input.episodeIds.get(row.alertId);
    if (episodeId === undefined) {
      throw new Error(`Missing episode assignment for alert ${row.alertId}`);
    }
    const values = episodeRows.get(episodeId) ?? [];
    values.push(row.netReturnPercent);
    episodeRows.set(episodeId, values);
  }
  const episodes = [...episodeRows.values()];
  const clusterRobustStandardError =
    episodes.length < 2
      ? null
      : Math.sqrt(
          (episodes.length / (episodes.length - 1)) *
            episodes.reduce(
              (sum, episode) =>
                sum +
                episode.reduce(
                  (clusterSum, value) => clusterSum + value - pointMean,
                  0,
                ) **
                  2,
              0,
            ),
        ) / input.rows.length;
  const tailProbability = (1 - input.confidenceLevel) / 2;
  const minimumDetectableEffect =
    clusterRobustStandardError === null
      ? null
      : (inverseStandardNormal(1 - tailProbability) +
          inverseStandardNormal(targetPower)) *
        clusterRobustStandardError;
  const random = createAlphaRandom(input.seed);
  const bootstrapMeans: number[] = [];
  let nonPositive = 0;
  let nullAtLeastObserved = 0;
  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    let total = 0;
    let count = 0;
    for (let draw = 0; draw < episodes.length; draw += 1) {
      const episode = requireArrayElement(
        episodes,
        Math.floor(random() * episodes.length),
        'bootstrap episode',
      );
      total += episode.reduce((sum, value) => sum + value, 0);
      count += episode.length;
    }
    const bootstrapMean = total / count;
    bootstrapMeans.push(bootstrapMean);
    if (bootstrapMean <= 0) nonPositive += 1;
    const nullCenteredMean = (total - pointMean * count) / count;
    if (nullCenteredMean >= pointMean) nullAtLeastObserved += 1;
  }
  return Object.freeze({
    sampleSize: input.rows.length,
    independentEpisodeCount: episodes.length,
    meanPercent: pointMean,
    medianPercent: median,
    trimmedMeanPercent: trimmedMean,
    eventSharpe,
    clusterRobustStandardErrorPercent: clusterRobustStandardError,
    minimumDetectableEffectPercent: minimumDetectableEffect,
    lowerConfidencePercent: alphaQuantile(bootstrapMeans, tailProbability),
    upperConfidencePercent: alphaQuantile(bootstrapMeans, 1 - tailProbability),
    probabilityPositive: (input.iterations - nonPositive) / input.iterations,
    oneSidedPValue: (nullAtLeastObserved + 1) / (input.iterations + 1),
  });
};

export const bootstrapAlphaConditionalEffect = (input: {
  readonly availableRows: readonly AlphaResearchDatasetRow[];
  readonly selectedAlertIds: ReadonlySet<string>;
  readonly episodeIds: ReadonlyMap<string, string>;
  readonly iterations: number;
  readonly confidenceLevel: number;
  readonly seed: number;
}): AlphaConditionalEffectEstimate => {
  if (!Number.isSafeInteger(input.iterations) || input.iterations < 1) {
    throw new Error('Effect-bootstrap iterations must be positive');
  }
  if (
    !Number.isFinite(input.confidenceLevel) ||
    input.confidenceLevel <= 0.5 ||
    input.confidenceLevel >= 1
  ) {
    throw new Error(
      'Effect-bootstrap confidenceLevel must be between 0.5 and 1',
    );
  }
  const availableIds = new Set(input.availableRows.map((row) => row.alertId));
  for (const alertId of input.selectedAlertIds) {
    if (!availableIds.has(alertId)) {
      throw new Error(
        `Selected alert is outside the available sample: ${alertId}`,
      );
    }
  }
  const selectedRows = input.availableRows.filter((row) =>
    input.selectedAlertIds.has(row.alertId),
  );
  const availableMean = alphaMean(
    input.availableRows.map((row) => row.netReturnPercent),
  );
  const selectedMean = alphaMean(
    selectedRows.map((row) => row.netReturnPercent),
  );
  const pointEffect =
    availableMean === null || selectedMean === null
      ? null
      : selectedMean - availableMean;
  if (pointEffect === null) {
    return Object.freeze({
      availableSampleSize: input.availableRows.length,
      selectedSampleSize: selectedRows.length,
      independentEpisodeCount: 0,
      selectedIndependentEpisodeCount: 0,
      effectiveIterations: 0,
      effectPercent: null,
      lowerConfidencePercent: null,
      upperConfidencePercent: null,
      probabilityPositive: null,
      oneSidedPValue: null,
    });
  }
  const episodeRows = new Map<
    string,
    Array<Readonly<{ returnPercent: number; selected: boolean }>>
  >();
  const selectedEpisodeIds = new Set<string>();
  for (const row of input.availableRows) {
    const episodeId = input.episodeIds.get(row.alertId);
    if (episodeId === undefined) {
      throw new Error(`Missing episode assignment for alert ${row.alertId}`);
    }
    const selected = input.selectedAlertIds.has(row.alertId);
    if (selected) selectedEpisodeIds.add(episodeId);
    const observations = episodeRows.get(episodeId) ?? [];
    observations.push(
      Object.freeze({ returnPercent: row.netReturnPercent, selected }),
    );
    episodeRows.set(episodeId, observations);
  }
  const episodes = [...episodeRows.values()];
  const random = createAlphaRandom(input.seed);
  const effects: number[] = [];
  let positive = 0;
  let nullAtLeastObserved = 0;
  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    let availableTotal = 0;
    let availableCount = 0;
    let selectedTotal = 0;
    let selectedCount = 0;
    for (let draw = 0; draw < episodes.length; draw += 1) {
      const episode = requireArrayElement(
        episodes,
        Math.floor(random() * episodes.length),
        'effect-bootstrap episode',
      );
      for (const observation of episode) {
        availableTotal += observation.returnPercent;
        availableCount += 1;
        if (observation.selected) {
          selectedTotal += observation.returnPercent;
          selectedCount += 1;
        }
      }
    }
    if (availableCount === 0 || selectedCount === 0) continue;
    const effect =
      selectedTotal / selectedCount - availableTotal / availableCount;
    effects.push(effect);
    if (effect > 0) positive += 1;
    if (effect - pointEffect >= pointEffect) nullAtLeastObserved += 1;
  }
  if (effects.length === 0) {
    return Object.freeze({
      availableSampleSize: input.availableRows.length,
      selectedSampleSize: selectedRows.length,
      independentEpisodeCount: episodes.length,
      selectedIndependentEpisodeCount: selectedEpisodeIds.size,
      effectiveIterations: 0,
      effectPercent: pointEffect,
      lowerConfidencePercent: null,
      upperConfidencePercent: null,
      probabilityPositive: null,
      oneSidedPValue: null,
    });
  }
  const tailProbability = (1 - input.confidenceLevel) / 2;
  return Object.freeze({
    availableSampleSize: input.availableRows.length,
    selectedSampleSize: selectedRows.length,
    independentEpisodeCount: episodes.length,
    selectedIndependentEpisodeCount: selectedEpisodeIds.size,
    effectiveIterations: effects.length,
    effectPercent: pointEffect,
    lowerConfidencePercent: alphaQuantile(effects, tailProbability),
    upperConfidencePercent: alphaQuantile(effects, 1 - tailProbability),
    probabilityPositive: positive / effects.length,
    oneSidedPValue: (nullAtLeastObserved + 1) / (effects.length + 1),
  });
};

export const bayesianBootstrapAlphaEstimate = (input: {
  readonly rows: readonly AlphaResearchDatasetRow[];
  readonly episodeIds: ReadonlyMap<string, string>;
  readonly iterations: number;
  readonly credibleLevel: number;
  readonly seed: number;
}): AlphaBayesianBootstrapEstimate => {
  if (!Number.isSafeInteger(input.iterations) || input.iterations < 1) {
    throw new Error('Bayesian-bootstrap iterations must be positive');
  }
  if (
    !Number.isFinite(input.credibleLevel) ||
    input.credibleLevel <= 0.5 ||
    input.credibleLevel >= 1
  ) {
    throw new Error(
      'Bayesian-bootstrap credibleLevel must be between 0.5 and 1',
    );
  }
  if (input.rows.length === 0) {
    return Object.freeze({
      sampleSize: 0,
      independentEpisodeCount: 0,
      iterations: input.iterations,
      posteriorMeanPercent: null,
      lowerCrediblePercent: null,
      upperCrediblePercent: null,
      posteriorProbabilityPositive: null,
    });
  }
  const episodeRows = new Map<string, number[]>();
  for (const row of input.rows) {
    if (!Number.isFinite(row.netReturnPercent)) {
      throw new Error('Bayesian-bootstrap returns must be finite');
    }
    const episodeId = input.episodeIds.get(row.alertId);
    if (episodeId === undefined) {
      throw new Error(`Missing episode assignment for alert ${row.alertId}`);
    }
    const values = episodeRows.get(episodeId) ?? [];
    values.push(row.netReturnPercent);
    episodeRows.set(episodeId, values);
  }
  const episodes = [...episodeRows.values()].map((values) =>
    Object.freeze({
      total: finiteCompensatedSum(values),
      count: values.length,
    }),
  );
  const random = createAlphaRandom(input.seed);
  const posteriorMeans: number[] = [];
  let positive = 0;
  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    let weightedTotal = 0;
    let weightedCount = 0;
    for (const episode of episodes) {
      const exponentialWeight = -Math.log(Math.max(random(), Number.MIN_VALUE));
      weightedTotal += exponentialWeight * episode.total;
      weightedCount += exponentialWeight * episode.count;
    }
    const posteriorMean = weightedTotal / weightedCount;
    posteriorMeans.push(posteriorMean);
    if (posteriorMean > 0) positive += 1;
  }
  const tailProbability = (1 - input.credibleLevel) / 2;
  return Object.freeze({
    sampleSize: input.rows.length,
    independentEpisodeCount: episodes.length,
    iterations: input.iterations,
    posteriorMeanPercent: alphaMean(posteriorMeans),
    lowerCrediblePercent: alphaQuantile(posteriorMeans, tailProbability),
    upperCrediblePercent: alphaQuantile(posteriorMeans, 1 - tailProbability),
    posteriorProbabilityPositive: positive / posteriorMeans.length,
  });
};

export const benjaminiHochbergAdjustedPValues = <Key extends string>(
  entries: readonly Readonly<{ key: Key; pValue: number }>[],
): ReadonlyMap<Key, number> => {
  const keys = new Set<Key>();
  for (const entry of entries) {
    if (
      entry.key.trim().length === 0 ||
      keys.has(entry.key) ||
      !Number.isFinite(entry.pValue) ||
      entry.pValue < 0 ||
      entry.pValue > 1
    ) {
      throw new Error(
        'Adjusted p-values require unique non-empty keys and finite values in [0, 1]',
      );
    }
    keys.add(entry.key);
  }
  const ordered = [...entries].sort(
    (left, right) =>
      left.pValue - right.pValue || left.key.localeCompare(right.key),
  );
  const adjusted = new Map<Key, number>();
  let next = 1;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const entry = requireArrayElement(ordered, index, 'adjusted p-value');
    const rank = index + 1;
    const value = Math.min(next, (entry.pValue * ordered.length) / rank, 1);
    adjusted.set(entry.key, value);
    next = value;
  }
  return adjusted;
};
