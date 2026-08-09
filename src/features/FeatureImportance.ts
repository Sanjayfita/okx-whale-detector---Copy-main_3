export interface FeatureImportanceObservation {
  readonly features: Readonly<Record<string, number>>;
  readonly target: number;
  readonly blockId?: string;
}

export type FeaturePredictor = (
  features: Readonly<Record<string, number>>,
) => number;

export type PermutationScope = 'GLOBAL' | 'WITHIN_BLOCK';

export interface FeatureImportanceResult {
  readonly featureName: string;
  readonly baselineLoss: number;
  readonly permutedLoss: number;
  readonly importance: number;
  readonly permutationScope: PermutationScope;
  readonly blockCount: number;
  readonly permutableBlockCount: number;
}

export interface PermutationImportanceOptions {
  readonly repetitions?: number;
  readonly seed?: number;
  readonly permutationScope?: PermutationScope;
}

const meanSquaredError = (
  observations: readonly FeatureImportanceObservation[],
  predictor: FeaturePredictor,
): number => {
  if (observations.length === 0) {
    throw new Error('Feature importance requires observations');
  }
  return (
    observations.reduce((sum, observation) => {
      const prediction = predictor(observation.features);
      if (!Number.isFinite(prediction) || !Number.isFinite(observation.target)) {
        throw new Error('Feature importance values must be finite');
      }
      return sum + (prediction - observation.target) ** 2;
    }, 0) / observations.length
  );
};

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x9e3779b9;
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};

const shuffled = <T>(values: readonly T[], random: () => number): T[] => {
  const output = values.slice();
  for (let index = output.length - 1; index > 0; index -= 1) {
    const replacementIndex = Math.floor(random() * (index + 1));
    const current = output[index];
    const replacement = output[replacementIndex];
    if (current === undefined || replacement === undefined) {
      continue;
    }
    output[index] = replacement;
    output[replacementIndex] = current;
  }
  return output;
};

const validateObservations = (
  observations: readonly FeatureImportanceObservation[],
): readonly string[] => {
  const featureNames = [...new Set(
    observations.flatMap((observation) => Object.keys(observation.features)),
  )].sort();
  if (featureNames.length === 0) {
    throw new Error('Feature importance requires at least one feature');
  }
  for (const observation of observations) {
    if (!Number.isFinite(observation.target)) {
      throw new Error('Feature importance target must be finite');
    }
    for (const featureName of featureNames) {
      const value = observation.features[featureName];
      if (value === undefined || !Number.isFinite(value)) {
        throw new Error(`Missing or invalid feature ${featureName}`);
      }
    }
  }
  return featureNames;
};

const blockIndices = (input: {
  readonly observations: readonly FeatureImportanceObservation[];
  readonly scope: PermutationScope;
}): ReadonlyMap<string, readonly number[]> => {
  if (input.scope === 'GLOBAL') {
    return new Map([['GLOBAL', input.observations.map((_, index) => index)]]);
  }
  const blocks = new Map<string, number[]>();
  input.observations.forEach((observation, index) => {
    if (observation.blockId === undefined || observation.blockId.trim().length === 0) {
      throw new Error('WITHIN_BLOCK importance requires a non-empty blockId');
    }
    blocks.set(observation.blockId, [
      ...(blocks.get(observation.blockId) ?? []),
      index,
    ]);
  });
  if (![...blocks.values()].some((indices) => indices.length >= 2)) {
    throw new Error('WITHIN_BLOCK importance requires a permutable block');
  }
  return blocks;
};

const permuteFeature = (input: {
  readonly observations: readonly FeatureImportanceObservation[];
  readonly featureName: string;
  readonly blocks: ReadonlyMap<string, readonly number[]>;
  readonly random: () => number;
}): readonly FeatureImportanceObservation[] => {
  const replacementValues = new Map<number, number>();
  for (const indices of input.blocks.values()) {
    const values = indices.map((index) => {
      const value = input.observations[index]?.features[input.featureName];
      if (value === undefined) {
        throw new Error(`Missing feature ${input.featureName}`);
      }
      return value;
    });
    const permuted = shuffled(values, input.random);
    indices.forEach((observationIndex, localIndex) => {
      const replacement = permuted[localIndex];
      if (replacement !== undefined) {
        replacementValues.set(observationIndex, replacement);
      }
    });
  }
  return input.observations.map((observation, index) => ({
    ...observation,
    features: {
      ...observation.features,
      [input.featureName]:
        replacementValues.get(index) ?? observation.features[input.featureName] ?? 0,
    },
  }));
};

export const calculatePermutationImportance = (
  observations: readonly FeatureImportanceObservation[],
  predictor: FeaturePredictor,
  options: PermutationImportanceOptions = {},
): readonly FeatureImportanceResult[] => {
  const repetitions = options.repetitions ?? 20;
  const seed = options.seed ?? 42;
  const permutationScope = options.permutationScope ?? 'GLOBAL';
  if (!Number.isSafeInteger(repetitions) || repetitions <= 0) {
    throw new Error('repetitions must be a positive safe integer');
  }
  if (!Number.isSafeInteger(seed)) {
    throw new Error('seed must be a safe integer');
  }
  const featureNames = validateObservations(observations);
  const blocks = blockIndices({ observations, scope: permutationScope });
  const baselineLoss = meanSquaredError(observations, predictor);
  const random = createRandom(seed);
  const permutableBlockCount = [...blocks.values()].filter(
    (indices) => indices.length >= 2,
  ).length;

  return featureNames
    .map((featureName): FeatureImportanceResult => {
      let totalPermutedLoss = 0;
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        totalPermutedLoss += meanSquaredError(
          permuteFeature({
            observations,
            featureName,
            blocks,
            random,
          }),
          predictor,
        );
      }
      const permutedLoss = totalPermutedLoss / repetitions;
      return {
        featureName,
        baselineLoss,
        permutedLoss,
        importance: permutedLoss - baselineLoss,
        permutationScope,
        blockCount: blocks.size,
        permutableBlockCount,
      };
    })
    .sort(
      (left, right) =>
        right.importance - left.importance ||
        left.featureName.localeCompare(right.featureName),
    );
};
