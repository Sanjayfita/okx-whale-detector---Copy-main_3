import type { AlphaRegressionCalibration } from './alphaAnalysisTypes';
import { alphaMean, alphaPearsonCorrelation } from './alphaStatistics';

export interface AlphaPredictionObservation {
  readonly prediction: number;
  readonly observation: number;
}

export const analyzeAlphaRegressionCalibration = (input: {
  readonly pairs: readonly AlphaPredictionObservation[];
  readonly binCount: number;
  readonly minimumSamples: number;
}): AlphaRegressionCalibration => {
  if (
    !Number.isSafeInteger(input.binCount) ||
    input.binCount < 2 ||
    input.binCount > 100
  ) {
    throw new Error('Calibration binCount must be between 2 and 100');
  }
  if (!Number.isSafeInteger(input.minimumSamples) || input.minimumSamples < 1) {
    throw new Error('Calibration minimumSamples must be a positive integer');
  }
  if (
    input.pairs.some(
      (pair) =>
        !Number.isFinite(pair.prediction) || !Number.isFinite(pair.observation),
    )
  ) {
    throw new Error('Calibration pairs must be finite');
  }
  if (input.pairs.length === 0) {
    return Object.freeze({
      sampleSize: 0,
      sufficientSamples: false,
      meanPredictedNetReturnPercent: null,
      meanObservedNetReturnPercent: null,
      meanAbsoluteErrorPercent: null,
      rootMeanSquaredErrorPercent: null,
      calibrationInterceptPercent: null,
      calibrationSlope: null,
      predictionObservedCorrelation: null,
      bins: Object.freeze([]),
    });
  }
  const predictions = input.pairs.map((pair) => pair.prediction);
  const observations = input.pairs.map((pair) => pair.observation);
  const meanPrediction = alphaMean(predictions);
  const meanObservation = alphaMean(observations);
  if (meanPrediction === null || meanObservation === null) {
    throw new Error('Calibration means are unavailable');
  }
  let covariance = 0;
  let predictionVariance = 0;
  for (const pair of input.pairs) {
    const predictionDifference = pair.prediction - meanPrediction;
    covariance += predictionDifference * (pair.observation - meanObservation);
    predictionVariance += predictionDifference ** 2;
  }
  const slope =
    predictionVariance === 0 ? null : covariance / predictionVariance;
  const intercept =
    slope === null ? null : meanObservation - slope * meanPrediction;
  const ordered = [...input.pairs].sort(
    (left, right) => left.prediction - right.prediction,
  );
  const actualBinCount = Math.min(input.binCount, ordered.length);
  const bins = Array.from({ length: actualBinCount }, (_, binIndex) => {
    const start = Math.floor((binIndex * ordered.length) / actualBinCount);
    const end = Math.floor(((binIndex + 1) * ordered.length) / actualBinCount);
    const bin = ordered.slice(start, end);
    const predicted = alphaMean(bin.map((pair) => pair.prediction));
    const observed = alphaMean(bin.map((pair) => pair.observation));
    if (predicted === null || observed === null) {
      throw new Error(`Calibration bin ${binIndex} is unexpectedly empty`);
    }
    return Object.freeze({
      sampleSize: bin.length,
      meanPredictedNetReturnPercent: predicted,
      meanObservedNetReturnPercent: observed,
    });
  });
  const absoluteErrors = input.pairs.map((pair) =>
    Math.abs(pair.prediction - pair.observation),
  );
  const squaredErrors = input.pairs.map(
    (pair) => (pair.prediction - pair.observation) ** 2,
  );
  const meanSquaredError = alphaMean(squaredErrors);
  return Object.freeze({
    sampleSize: input.pairs.length,
    sufficientSamples: input.pairs.length >= input.minimumSamples,
    meanPredictedNetReturnPercent: meanPrediction,
    meanObservedNetReturnPercent: meanObservation,
    meanAbsoluteErrorPercent: alphaMean(absoluteErrors),
    rootMeanSquaredErrorPercent:
      meanSquaredError === null ? null : Math.sqrt(meanSquaredError),
    calibrationInterceptPercent: intercept,
    calibrationSlope: slope,
    predictionObservedCorrelation: alphaPearsonCorrelation(
      predictions,
      observations,
    ),
    bins: Object.freeze(bins),
  });
};
