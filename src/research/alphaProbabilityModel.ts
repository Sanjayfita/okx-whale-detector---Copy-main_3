import { requireArrayElement } from '../core/arrayAccess';
import type {
  AlphaFeatureName,
  AlphaResearchDatasetRow,
} from './alphaFeatureTypes';
import {
  alphaMean,
  alphaPopulationStandardDeviation,
  alphaQuantile,
} from './alphaStatistics';

export interface AlphaLogisticFeatureTransform {
  readonly feature: AlphaFeatureName;
  readonly median: number;
  readonly mean: number;
  readonly standardDeviation: number;
}

export interface AlphaLogisticModel {
  readonly successThresholdPercent: number;
  readonly intercept: number;
  readonly transforms: readonly AlphaLogisticFeatureTransform[];
  readonly coefficients: readonly number[];
  readonly l2Lambda: number;
  readonly iterations: number;
  readonly learningRate: number;
}

export interface AlphaProbabilityObservation {
  readonly probability: number;
  readonly success: boolean;
}

export interface AlphaProbabilityCalibrationBin {
  readonly lowerProbabilityInclusive: number;
  readonly upperProbabilityInclusive: number;
  readonly sampleSize: number;
  readonly meanPredictedProbability: number;
  readonly observedSuccessRate: number;
  readonly absoluteCalibrationError: number;
}

export interface AlphaProbabilityCalibration {
  readonly sampleSize: number;
  readonly positiveSampleSize: number;
  readonly negativeSampleSize: number;
  readonly sufficientSamples: boolean;
  readonly baseSuccessRate: number | null;
  readonly brierScore: number | null;
  readonly logarithmicLoss: number | null;
  readonly rocAuc: number | null;
  readonly accuracyAtHalf: number | null;
  readonly expectedCalibrationError: number | null;
  readonly maximumCalibrationError: number | null;
  readonly bins: readonly AlphaProbabilityCalibrationBin[];
}

export interface AlphaPlattScoreObservation {
  readonly score: number;
  readonly success: boolean;
}

export interface AlphaPlattCalibrator {
  readonly intercept: number;
  readonly slope: number;
  readonly l2Lambda: number;
  readonly iterations: number;
  readonly learningRate: number;
}

const MINIMUM_PROBABILITY = 1e-12;

const clipProbability = (probability: number): number =>
  Math.min(1 - MINIMUM_PROBABILITY, Math.max(MINIMUM_PROBABILITY, probability));

const sigmoid = (value: number): number => {
  if (value >= 0) {
    const exponential = Math.exp(-value);
    return 1 / (1 + exponential);
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
};

const logit = (probability: number): number => {
  const clipped = clipProbability(probability);
  return Math.log(clipped / (1 - clipped));
};

const validateOptimization = (input: {
  readonly l2Lambda: number;
  readonly iterations: number;
  readonly learningRate: number;
}): void => {
  if (!Number.isFinite(input.l2Lambda) || input.l2Lambda < 0) {
    throw new Error('l2Lambda must be a non-negative finite number');
  }
  if (
    !Number.isSafeInteger(input.iterations) ||
    input.iterations < 1 ||
    input.iterations > 1_000_000
  ) {
    throw new Error('iterations must be a positive safe integer');
  }
  if (
    !Number.isFinite(input.learningRate) ||
    input.learningRate <= 0 ||
    input.learningRate > 1
  ) {
    throw new Error('learningRate must be greater than 0 and at most 1');
  }
};

const requireBothClasses = (
  labels: readonly boolean[],
  context: string,
): void => {
  const positives = labels.filter(Boolean).length;
  if (positives === 0 || positives === labels.length) {
    throw new Error(`${context} requires both success and failure observations`);
  }
};

const createTransform = (
  rows: readonly AlphaResearchDatasetRow[],
  feature: AlphaFeatureName,
): AlphaLogisticFeatureTransform => {
  const available = rows
    .map((row) => row.features[feature])
    .filter((value): value is number => value !== null);
  const median = alphaQuantile(available, 0.5) ?? 0;
  const imputed = rows.map((row) => row.features[feature] ?? median);
  const mean = alphaMean(imputed) ?? 0;
  const deviation = alphaPopulationStandardDeviation(imputed) ?? 1;
  return Object.freeze({
    feature,
    median,
    mean,
    standardDeviation: deviation === 0 ? 1 : deviation,
  });
};

const transformedValue = (
  row: AlphaResearchDatasetRow,
  transform: AlphaLogisticFeatureTransform,
): number =>
  ((row.features[transform.feature] ?? transform.median) - transform.mean) /
  transform.standardDeviation;

const linearScore = (
  model: Pick<AlphaLogisticModel, 'intercept' | 'transforms' | 'coefficients'>,
  row: AlphaResearchDatasetRow,
): number => {
  if (model.transforms.length !== model.coefficients.length) {
    throw new Error('Logistic model dimensions do not match');
  }
  return model.transforms.reduce(
    (score, transform, index) =>
      score +
      transformedValue(row, transform) *
        requireArrayElement(
          model.coefficients,
          index,
          'logistic prediction coefficient',
        ),
    model.intercept,
  );
};

export const fitAlphaLogisticModel = (input: {
  readonly rows: readonly AlphaResearchDatasetRow[];
  readonly features: readonly AlphaFeatureName[];
  readonly successThresholdPercent?: number;
  readonly l2Lambda: number;
  readonly iterations: number;
  readonly learningRate: number;
}): AlphaLogisticModel => {
  if (input.rows.length < 2) {
    throw new Error('Logistic fitting requires at least two rows');
  }
  if (input.features.length === 0) {
    throw new Error('Logistic fitting requires at least one feature');
  }
  if (new Set(input.features).size !== input.features.length) {
    throw new Error('Logistic fitting features must be unique');
  }
  validateOptimization(input);
  const successThresholdPercent = input.successThresholdPercent ?? 0;
  if (!Number.isFinite(successThresholdPercent)) {
    throw new Error('successThresholdPercent must be finite');
  }
  const labels = input.rows.map(
    (row) => row.netReturnPercent > successThresholdPercent,
  );
  requireBothClasses(labels, 'Logistic fitting');
  const transforms = input.features.map((feature) =>
    createTransform(input.rows, feature),
  );
  const transformedRows = input.rows.map((row) =>
    transforms.map((transform) => transformedValue(row, transform)),
  );
  const positiveFraction = labels.filter(Boolean).length / labels.length;
  let intercept = logit(positiveFraction);
  const coefficients = Array.from({ length: transforms.length }, () => 0);

  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    let interceptGradient = 0;
    const coefficientGradients = Array.from(
      { length: coefficients.length },
      () => 0,
    );
    for (let rowIndex = 0; rowIndex < input.rows.length; rowIndex += 1) {
      const values = requireArrayElement(
        transformedRows,
        rowIndex,
        'logistic transformed row',
      );
      const label = requireArrayElement(labels, rowIndex, 'logistic label')
        ? 1
        : 0;
      const score = values.reduce(
        (total, value, coefficientIndex) =>
          total +
          value *
            requireArrayElement(
              coefficients,
              coefficientIndex,
              'logistic training coefficient',
            ),
        intercept,
      );
      const error = sigmoid(score) - label;
      interceptGradient += error;
      for (
        let coefficientIndex = 0;
        coefficientIndex < coefficients.length;
        coefficientIndex += 1
      ) {
        coefficientGradients[coefficientIndex] =
          requireArrayElement(
            coefficientGradients,
            coefficientIndex,
            'logistic coefficient gradient',
          ) +
          error *
            requireArrayElement(
              values,
              coefficientIndex,
              'logistic transformed value',
            );
      }
    }
    intercept -=
      input.learningRate * (interceptGradient / input.rows.length);
    for (let index = 0; index < coefficients.length; index += 1) {
      const coefficient = requireArrayElement(
        coefficients,
        index,
        'logistic regularized coefficient',
      );
      const gradient =
        requireArrayElement(
          coefficientGradients,
          index,
          'logistic averaged coefficient gradient',
        ) /
          input.rows.length +
        input.l2Lambda * coefficient;
      coefficients[index] = coefficient - input.learningRate * gradient;
    }
  }
  if (
    !Number.isFinite(intercept) ||
    coefficients.some((coefficient) => !Number.isFinite(coefficient))
  ) {
    throw new Error('Logistic fitting produced non-finite parameters');
  }
  return Object.freeze({
    successThresholdPercent,
    intercept,
    transforms: Object.freeze(transforms),
    coefficients: Object.freeze(coefficients),
    l2Lambda: input.l2Lambda,
    iterations: input.iterations,
    learningRate: input.learningRate,
  });
};

export const predictAlphaSuccessProbability = (
  model: AlphaLogisticModel,
  row: AlphaResearchDatasetRow,
): number => sigmoid(linearScore(model, row));

export const alphaProbabilityLogitScore = (
  model: AlphaLogisticModel,
  row: AlphaResearchDatasetRow,
): number => linearScore(model, row);

const rocAuc = (pairs: readonly AlphaProbabilityObservation[]): number | null => {
  const positives = pairs.filter((pair) => pair.success).length;
  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const ordered = [...pairs].sort(
    (left, right) => left.probability - right.probability,
  );
  let positiveRankSum = 0;
  let index = 0;
  while (index < ordered.length) {
    let end = index + 1;
    while (
      end < ordered.length &&
      requireArrayElement(ordered, end, 'AUC tied observation').probability ===
        requireArrayElement(ordered, index, 'AUC tie anchor').probability
    ) {
      end += 1;
    }
    const averageRank = (index + 1 + end) / 2;
    for (let tiedIndex = index; tiedIndex < end; tiedIndex += 1) {
      if (requireArrayElement(ordered, tiedIndex, 'AUC ranked observation').success) {
        positiveRankSum += averageRank;
      }
    }
    index = end;
  }
  return (
    (positiveRankSum - (positives * (positives + 1)) / 2) /
    (positives * negatives)
  );
};

export const analyzeAlphaProbabilityCalibration = (input: {
  readonly pairs: readonly AlphaProbabilityObservation[];
  readonly binCount: number;
  readonly minimumSamples: number;
}): AlphaProbabilityCalibration => {
  if (
    !Number.isSafeInteger(input.binCount) ||
    input.binCount < 2 ||
    input.binCount > 100
  ) {
    throw new Error('Probability calibration binCount must be between 2 and 100');
  }
  if (!Number.isSafeInteger(input.minimumSamples) || input.minimumSamples < 1) {
    throw new Error(
      'Probability calibration minimumSamples must be a positive integer',
    );
  }
  if (
    input.pairs.some(
      (pair) =>
        !Number.isFinite(pair.probability) ||
        pair.probability < 0 ||
        pair.probability > 1,
    )
  ) {
    throw new Error('Probability observations must be between 0 and 1');
  }
  if (input.pairs.length === 0) {
    return Object.freeze({
      sampleSize: 0,
      positiveSampleSize: 0,
      negativeSampleSize: 0,
      sufficientSamples: false,
      baseSuccessRate: null,
      brierScore: null,
      logarithmicLoss: null,
      rocAuc: null,
      accuracyAtHalf: null,
      expectedCalibrationError: null,
      maximumCalibrationError: null,
      bins: Object.freeze([]),
    });
  }
  const positiveSampleSize = input.pairs.filter((pair) => pair.success).length;
  const squaredErrors = input.pairs.map((pair) => {
    const target = pair.success ? 1 : 0;
    return (pair.probability - target) ** 2;
  });
  const losses = input.pairs.map((pair) => {
    const probability = clipProbability(pair.probability);
    return pair.success ? -Math.log(probability) : -Math.log(1 - probability);
  });
  const bins = Array.from({ length: input.binCount }, (_, binIndex) => {
    const lowerProbabilityInclusive = binIndex / input.binCount;
    const upperProbabilityInclusive = (binIndex + 1) / input.binCount;
    const observations = input.pairs.filter((pair) => {
      if (binIndex === input.binCount - 1) {
        return (
          pair.probability >= lowerProbabilityInclusive &&
          pair.probability <= upperProbabilityInclusive
        );
      }
      return (
        pair.probability >= lowerProbabilityInclusive &&
        pair.probability < upperProbabilityInclusive
      );
    });
    if (observations.length === 0) return null;
    const meanPredictedProbability =
      alphaMean(observations.map((pair) => pair.probability)) ?? 0;
    const observedSuccessRate =
      observations.filter((pair) => pair.success).length / observations.length;
    return Object.freeze({
      lowerProbabilityInclusive,
      upperProbabilityInclusive,
      sampleSize: observations.length,
      meanPredictedProbability,
      observedSuccessRate,
      absoluteCalibrationError: Math.abs(
        meanPredictedProbability - observedSuccessRate,
      ),
    });
  }).filter((bin): bin is AlphaProbabilityCalibrationBin => bin !== null);
  const expectedCalibrationError =
    bins.reduce(
      (sum, bin) =>
        sum +
        bin.absoluteCalibrationError * (bin.sampleSize / input.pairs.length),
      0,
    ) || 0;
  return Object.freeze({
    sampleSize: input.pairs.length,
    positiveSampleSize,
    negativeSampleSize: input.pairs.length - positiveSampleSize,
    sufficientSamples: input.pairs.length >= input.minimumSamples,
    baseSuccessRate: positiveSampleSize / input.pairs.length,
    brierScore: alphaMean(squaredErrors),
    logarithmicLoss: alphaMean(losses),
    rocAuc: rocAuc(input.pairs),
    accuracyAtHalf:
      input.pairs.filter(
        (pair) => (pair.probability >= 0.5) === pair.success,
      ).length / input.pairs.length,
    expectedCalibrationError,
    maximumCalibrationError:
      bins.length === 0
        ? null
        : Math.max(...bins.map((bin) => bin.absoluteCalibrationError)),
    bins: Object.freeze(bins),
  });
};

export const fitAlphaPlattCalibrator = (input: {
  readonly pairs: readonly AlphaPlattScoreObservation[];
  readonly l2Lambda: number;
  readonly iterations: number;
  readonly learningRate: number;
}): AlphaPlattCalibrator => {
  if (input.pairs.length < 2) {
    throw new Error('Platt calibration requires at least two observations');
  }
  if (input.pairs.some((pair) => !Number.isFinite(pair.score))) {
    throw new Error('Platt calibration scores must be finite');
  }
  validateOptimization(input);
  const labels = input.pairs.map((pair) => pair.success);
  requireBothClasses(labels, 'Platt calibration');
  const positiveFraction = labels.filter(Boolean).length / labels.length;
  let intercept = logit(positiveFraction);
  let slope = 0;
  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    for (const pair of input.pairs) {
      const error = sigmoid(intercept + slope * pair.score) -
        (pair.success ? 1 : 0);
      interceptGradient += error;
      slopeGradient += error * pair.score;
    }
    intercept -=
      input.learningRate * (interceptGradient / input.pairs.length);
    slope -=
      input.learningRate *
      (slopeGradient / input.pairs.length + input.l2Lambda * slope);
  }
  if (!Number.isFinite(intercept) || !Number.isFinite(slope)) {
    throw new Error('Platt calibration produced non-finite parameters');
  }
  return Object.freeze({
    intercept,
    slope,
    l2Lambda: input.l2Lambda,
    iterations: input.iterations,
    learningRate: input.learningRate,
  });
};

export const calibrateAlphaProbability = (
  calibrator: AlphaPlattCalibrator,
  score: number,
): number => {
  if (!Number.isFinite(score)) {
    throw new Error('Calibration score must be finite');
  }
  return sigmoid(calibrator.intercept + calibrator.slope * score);
};
