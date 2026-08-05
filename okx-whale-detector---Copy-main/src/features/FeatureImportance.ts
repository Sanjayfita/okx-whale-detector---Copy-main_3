export interface FeatureImportanceObservation {
  readonly features: Readonly<Record<string, number>>;
  readonly target: number;
}

export type FeaturePredictor = (
  features: Readonly<Record<string, number>>,
) => number;

export interface FeatureImportanceResult {
  readonly featureName: string;
  readonly baselineLoss: number;
  readonly permutedLoss: number;
  readonly importance: number;
}

export interface PermutationImportanceOptions {
  readonly repetitions?: number;
  readonly seed?: number;
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
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const shuffled = <T>(values: readonly T[], random: () => number): readonly T[] => {
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

export const calculatePermutationImportance = (
  observations: readonly FeatureImportanceObservation[],
  predictor: FeaturePredictor,
  options: PermutationImportanceOptions = {},
): readonly FeatureImportanceResult[] => {
  const repetitions = options.repetitions ?? 20;
  const seed = options.seed ?? 42;
  if (!Number.isSafeInteger(repetitions) || repetitions <= 0) {
    throw new Error('repetitions must be a positive safe integer');
  }
  if (!Number.isSafeInteger(seed)) {
    throw new Error('seed must be a safe integer');
  }

  const featureNames = [...new Set(
    observations.flatMap((observation) => Object.keys(observation.features)),
  )].sort();
  const baselineLoss = meanSquaredError(observations, predictor);
  const random = createRandom(seed);

  return featureNames
    .map((featureName): FeatureImportanceResult => {
      const originalValues = observations.map((observation) => {
        const value = observation.features[featureName];
        if (value === undefined || !Number.isFinite(value)) {
          throw new Error(`Missing or invalid feature ${featureName}`);
        }
        return value;
      });
      let totalPermutedLoss = 0;
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        const permuted = shuffled(originalValues, random);
        const permutedObservations = observations.map((observation, index) => ({
          target: observation.target,
          features: {
            ...observation.features,
            [featureName]: permuted[index] ?? originalValues[index] ?? 0,
          },
        }));
        totalPermutedLoss += meanSquaredError(permutedObservations, predictor);
      }
      const permutedLoss = totalPermutedLoss / repetitions;
      return {
        featureName,
        baselineLoss,
        permutedLoss,
        importance: permutedLoss - baselineLoss,
      };
    })
    .sort(
      (left, right) =>
        right.importance - left.importance ||
        left.featureName.localeCompare(right.featureName),
    );
};
