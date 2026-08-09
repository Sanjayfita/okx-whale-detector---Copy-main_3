import { requireArrayElement } from '../core/arrayAccess';
import type { AlphaPartialDependencePoint } from './alphaAnalysisTypes';
import type {
  AlphaFeatureName,
  AlphaResearchDatasetRow,
} from './alphaFeatureTypes';
import {
  alphaMean,
  alphaPopulationStandardDeviation,
  alphaQuantile,
  alphaSampleStandardDeviation,
  createAlphaRandom,
  shuffledAlphaIndices,
} from './alphaStatistics';

export interface AlphaRidgeFeatureTransform {
  readonly feature: AlphaFeatureName;
  readonly median: number;
  readonly mean: number;
  readonly standardDeviation: number;
}

export interface AlphaRidgeModel {
  readonly targetMean: number;
  readonly transforms: readonly AlphaRidgeFeatureTransform[];
  readonly coefficients: readonly number[];
}

export interface AlphaLinearFoldEvaluation {
  readonly predictions: ReadonlyMap<string, number>;
  readonly permutationImportance: ReadonlyMap<AlphaFeatureName, number>;
  readonly meanAbsoluteShap: ReadonlyMap<AlphaFeatureName, number>;
}

const solveLinearSystem = (
  matrix: readonly (readonly number[])[],
  vector: readonly number[],
): readonly number[] => {
  if (matrix.length !== vector.length) {
    throw new Error('Ridge matrix and vector dimensions must match');
  }
  const size = matrix.length;
  const augmented = matrix.map((row, index) => {
    if (row.length !== size) {
      throw new Error('Ridge matrix must be square');
    }
    return [...row, requireArrayElement(vector, index, 'ridge target vector')];
  });
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      const candidateRow = requireArrayElement(
        augmented,
        row,
        'ridge candidate row',
      );
      const pivotRow = requireArrayElement(augmented, pivot, 'ridge pivot row');
      if (
        Math.abs(
          requireArrayElement(candidateRow, column, 'ridge candidate value'),
        ) > Math.abs(requireArrayElement(pivotRow, column, 'ridge pivot value'))
      ) {
        pivot = row;
      }
    }
    const pivotRow = requireArrayElement(
      augmented,
      pivot,
      'ridge selected pivot row',
    );
    if (
      Math.abs(
        requireArrayElement(pivotRow, column, 'ridge selected pivot value'),
      ) < 1e-12
    ) {
      throw new Error('Ridge matrix is numerically singular');
    }
    if (pivot !== column) {
      const temporary = requireArrayElement(
        augmented,
        column,
        'ridge swap column',
      );
      augmented[column] = pivotRow;
      augmented[pivot] = temporary;
    }
    const normalizedRow = requireArrayElement(
      augmented,
      column,
      'ridge normalized row',
    );
    const divisor = requireArrayElement(normalizedRow, column, 'ridge divisor');
    for (let entry = column; entry <= size; entry += 1) {
      normalizedRow[entry] =
        requireArrayElement(normalizedRow, entry, 'ridge normalized value') /
        divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const eliminationRow = requireArrayElement(
        augmented,
        row,
        'ridge elimination row',
      );
      const factor = requireArrayElement(
        eliminationRow,
        column,
        'ridge elimination factor',
      );
      if (factor === 0) continue;
      for (let entry = column; entry <= size; entry += 1) {
        eliminationRow[entry] =
          requireArrayElement(
            eliminationRow,
            entry,
            'ridge elimination value',
          ) -
          factor *
            requireArrayElement(normalizedRow, entry, 'ridge normalized value');
      }
    }
  }
  return Object.freeze(
    augmented.map((row) =>
      requireArrayElement(row, size, 'ridge solved coefficient'),
    ),
  );
};

const createTransform = (
  rows: readonly AlphaResearchDatasetRow[],
  feature: AlphaFeatureName,
): AlphaRidgeFeatureTransform => {
  const available = rows
    .map((row) => row.features[feature])
    .filter((value): value is number => value !== null);
  const median = alphaQuantile(available, 0.5) ?? 0;
  const imputed = rows.map((row) => row.features[feature] ?? median);
  const mean = alphaMean(imputed) ?? 0;
  const standardDeviation = alphaPopulationStandardDeviation(imputed) ?? 1;
  return Object.freeze({
    feature,
    median,
    mean,
    standardDeviation: standardDeviation === 0 ? 1 : standardDeviation,
  });
};

const transformedValue = (
  row: AlphaResearchDatasetRow,
  transform: AlphaRidgeFeatureTransform,
): number =>
  ((row.features[transform.feature] ?? transform.median) - transform.mean) /
  transform.standardDeviation;

export const fitAlphaRidgeModel = (input: {
  readonly rows: readonly AlphaResearchDatasetRow[];
  readonly features: readonly AlphaFeatureName[];
  readonly ridgeLambda: number;
}): AlphaRidgeModel => {
  if (input.rows.length < 2) {
    throw new Error('Ridge fitting requires at least two rows');
  }
  if (input.features.length === 0) {
    throw new Error('Ridge fitting requires at least one feature');
  }
  if (!Number.isFinite(input.ridgeLambda) || input.ridgeLambda <= 0) {
    throw new Error('ridgeLambda must be positive and finite');
  }
  const transforms = input.features.map((feature) =>
    createTransform(input.rows, feature),
  );
  const targetMean =
    alphaMean(input.rows.map((row) => row.netReturnPercent)) ?? 0;
  const featureCount = transforms.length;
  const matrix = Array.from({ length: featureCount }, () =>
    Array.from({ length: featureCount }, () => 0),
  );
  const vector = Array.from({ length: featureCount }, () => 0);
  for (const row of input.rows) {
    const transformed = transforms.map((transform) =>
      transformedValue(row, transform),
    );
    const centeredTarget = row.netReturnPercent - targetMean;
    for (let left = 0; left < featureCount; left += 1) {
      vector[left] =
        requireArrayElement(vector, left, 'ridge target accumulation') +
        requireArrayElement(transformed, left, 'ridge transformed feature') *
          centeredTarget;
      const matrixRow = requireArrayElement(
        matrix,
        left,
        'ridge covariance row',
      );
      for (let right = 0; right < featureCount; right += 1) {
        matrixRow[right] =
          requireArrayElement(matrixRow, right, 'ridge covariance value') +
          requireArrayElement(transformed, left, 'ridge left feature') *
            requireArrayElement(transformed, right, 'ridge right feature');
      }
    }
  }
  // Scale the penalty with n so ridgeLambda describes the normalized
  // mean-squared-error objective and does not weaken merely because a fold is larger.
  for (let index = 0; index < featureCount; index += 1) {
    const matrixRow = requireArrayElement(matrix, index, 'ridge diagonal row');
    matrixRow[index] =
      requireArrayElement(matrixRow, index, 'ridge diagonal value') +
      input.ridgeLambda * input.rows.length;
  }
  return Object.freeze({
    targetMean,
    transforms: Object.freeze(transforms),
    coefficients: solveLinearSystem(matrix, vector),
  });
};

const transformedRow = (
  model: AlphaRidgeModel,
  row: AlphaResearchDatasetRow,
): readonly number[] =>
  model.transforms.map((transform) => transformedValue(row, transform));

const predictTransformed = (
  model: AlphaRidgeModel,
  values: readonly number[],
): number => {
  if (values.length !== model.coefficients.length) {
    throw new Error('Ridge prediction dimensions do not match');
  }
  return (
    model.targetMean +
    values.reduce(
      (prediction, value, index) =>
        prediction +
        value *
          requireArrayElement(
            model.coefficients,
            index,
            'ridge prediction coefficient',
          ),
      0,
    )
  );
};

export const predictAlphaRidgeModel = (
  model: AlphaRidgeModel,
  row: AlphaResearchDatasetRow,
): number => predictTransformed(model, transformedRow(model, row));

export const createAlphaPartialDependence = (input: {
  readonly model: AlphaRidgeModel;
  readonly referenceRows: readonly AlphaResearchDatasetRow[];
  readonly feature: AlphaFeatureName;
  readonly gridPoints: number;
  readonly lowerQuantile: number;
  readonly upperQuantile: number;
}): readonly AlphaPartialDependencePoint[] => {
  if (
    !Number.isSafeInteger(input.gridPoints) ||
    input.gridPoints < 2 ||
    input.gridPoints > 100
  ) {
    throw new Error('Partial-dependence gridPoints must be between 2 and 100');
  }
  if (
    !Number.isFinite(input.lowerQuantile) ||
    !Number.isFinite(input.upperQuantile) ||
    input.lowerQuantile < 0 ||
    input.upperQuantile > 1 ||
    input.lowerQuantile >= input.upperQuantile
  ) {
    throw new Error('Partial-dependence quantiles are invalid');
  }
  const featureIndex = input.model.transforms.findIndex(
    (transform) => transform.feature === input.feature,
  );
  if (featureIndex < 0) {
    throw new Error(`Feature is not present in ridge model: ${input.feature}`);
  }
  const available = input.referenceRows
    .map((row) => row.features[input.feature])
    .filter((value): value is number => value !== null);
  if (available.length < 2 || input.referenceRows.length === 0) {
    return Object.freeze([]);
  }
  const transform = requireArrayElement(
    input.model.transforms,
    featureIndex,
    'partial-dependence transform',
  );
  const grid = Array.from({ length: input.gridPoints }, (_, index) => {
    const fraction = index / (input.gridPoints - 1);
    return alphaQuantile(
      available,
      input.lowerQuantile +
        (input.upperQuantile - input.lowerQuantile) * fraction,
    );
  }).filter((value): value is number => value !== null);
  const uniqueGrid = [...new Set(grid)];
  return Object.freeze(
    uniqueGrid.map((featureValue) => {
      const transformedOverride =
        (featureValue - transform.mean) / transform.standardDeviation;
      const predictions = input.referenceRows.map((row) => {
        const values = [...transformedRow(input.model, row)];
        values[featureIndex] = transformedOverride;
        return predictTransformed(input.model, values);
      });
      const meanPrediction = alphaMean(predictions);
      if (meanPrediction === null) {
        throw new Error('Partial-dependence prediction mean is unavailable');
      }
      return Object.freeze({
        featureValue,
        meanPredictedNetReturnPercent: meanPrediction,
      });
    }),
  );
};

const meanSquaredError = (
  predictions: readonly number[],
  targets: readonly number[],
): number => {
  if (predictions.length !== targets.length || predictions.length === 0) {
    throw new Error('MSE inputs must have equal non-zero lengths');
  }
  return (
    predictions.reduce(
      (sum, prediction, index) =>
        sum +
        (prediction -
          requireArrayElement(targets, index, 'mean-squared-error target')) **
          2,
      0,
    ) / predictions.length
  );
};

export const evaluateAlphaLinearFold = (input: {
  readonly model: AlphaRidgeModel;
  readonly testingRows: readonly AlphaResearchDatasetRow[];
  readonly permutationRepeats: number;
  readonly randomSeed: number;
}): AlphaLinearFoldEvaluation => {
  if (input.testingRows.length === 0) {
    throw new Error('Linear fold evaluation requires testing rows');
  }
  const transformed = input.testingRows.map((row) =>
    transformedRow(input.model, row),
  );
  const targets = input.testingRows.map((row) => row.netReturnPercent);
  const predictions = transformed.map((values) =>
    predictTransformed(input.model, values),
  );
  const baselineMse = meanSquaredError(predictions, targets);
  const targetDeviation = alphaSampleStandardDeviation(targets);
  const targetVariance = targetDeviation === null ? 0 : targetDeviation ** 2;
  const random = createAlphaRandom(input.randomSeed);
  const permutationImportance = new Map<AlphaFeatureName, number>();
  const meanAbsoluteShap = new Map<AlphaFeatureName, number>();

  for (
    let featureIndex = 0;
    featureIndex < input.model.transforms.length;
    featureIndex += 1
  ) {
    const transform = requireArrayElement(
      input.model.transforms,
      featureIndex,
      'ridge feature transform',
    );
    let totalIncrease = 0;
    for (let repeat = 0; repeat < input.permutationRepeats; repeat += 1) {
      const shuffled = shuffledAlphaIndices(transformed.length, random);
      const permutedPredictions = transformed.map((values, rowIndex) => {
        const permuted = [...values];
        const shuffledRowIndex = requireArrayElement(
          shuffled,
          rowIndex,
          'permutation row index',
        );
        const shuffledRow = requireArrayElement(
          transformed,
          shuffledRowIndex,
          'permutation source row',
        );
        permuted[featureIndex] = requireArrayElement(
          shuffledRow,
          featureIndex,
          'permutation source value',
        );
        return predictTransformed(input.model, permuted);
      });
      totalIncrease +=
        meanSquaredError(permutedPredictions, targets) - baselineMse;
    }
    const averageIncrease = totalIncrease / input.permutationRepeats;
    permutationImportance.set(
      transform.feature,
      targetVariance > 0 ? averageIncrease / targetVariance : 0,
    );
    const coefficient = requireArrayElement(
      input.model.coefficients,
      featureIndex,
      'ridge SHAP coefficient',
    );
    meanAbsoluteShap.set(
      transform.feature,
      transformed.reduce(
        (sum, values) =>
          sum +
          Math.abs(
            coefficient *
              requireArrayElement(values, featureIndex, 'ridge SHAP value'),
          ),
        0,
      ) / transformed.length,
    );
  }
  return Object.freeze({
    predictions: new Map(
      input.testingRows.map((row, index) => [
        row.alertId,
        requireArrayElement(predictions, index, 'ridge fold prediction'),
      ]),
    ),
    permutationImportance,
    meanAbsoluteShap,
  });
};
