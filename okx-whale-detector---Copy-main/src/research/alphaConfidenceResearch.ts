import type { AlphaProbabilityCalibration } from './alphaProbabilityModel';
import {
  alphaProbabilityLogitScore,
  analyzeAlphaProbabilityCalibration,
  calibrateAlphaProbability,
  fitAlphaLogisticModel,
  fitAlphaPlattCalibrator,
  predictAlphaSuccessProbability,
  type AlphaPlattScoreObservation,
  type AlphaProbabilityObservation,
} from './alphaProbabilityModel';
import type {
  AlphaFeatureName,
  AlphaResearchConfig,
  AlphaResearchDataset,
  AlphaResearchDatasetRow,
} from './alphaFeatureTypes';
import {
  validateAlphaFeatureExtractionConfig,
  validateAlphaResearchAnalysisConfig,
} from './alphaResearchConfig';
import { validateAlphaResearchDataset } from './alphaResearchDataset';
import {
  createAlphaResearchConfigurationFingerprint,
  createAlphaResearchDatasetFingerprint,
} from './alphaResearchFingerprint';
import { createAlphaPurgedWalkForwardSplit } from './alphaWalkForward';

export const ALPHA_CONFIDENCE_REPORT_SCHEMA_VERSION = 1 as const;

export type AlphaConfidenceResearchStatus =
  | 'COMPLETE'
  | 'INSUFFICIENT_DATA'
  | 'INCOMPLETE_DATA'
  | 'NO_EMPIRICAL_DATA';

export interface AlphaConfidenceModelConfig {
  readonly successThresholdPercent: number;
  readonly l2Lambda: number;
  readonly iterations: number;
  readonly learningRate: number;
  readonly plattL2Lambda: number;
  readonly plattIterations: number;
  readonly plattLearningRate: number;
  readonly calibrationBins: number;
  readonly minimumCalibrationSamples: number;
}

export interface AlphaConfidenceFoldSummary {
  readonly foldId: string;
  readonly trainingSampleSize: number;
  readonly testingSampleSize: number;
  readonly predictedSampleSize: number;
  readonly priorCalibrationSampleSize: number;
  readonly calibratedSampleSize: number;
  readonly skippedReason: string | null;
}

export interface AlphaConfidenceResearchReport {
  readonly schemaVersion: typeof ALPHA_CONFIDENCE_REPORT_SCHEMA_VERSION;
  readonly methodologyVersion: 'whale-confidence-v1';
  readonly evaluationId: string;
  readonly status: AlphaConfidenceResearchStatus;
  readonly alphaConfigurationFingerprint: string;
  readonly datasetFingerprint: string;
  readonly confidenceConfig: AlphaConfidenceModelConfig;
  readonly features: readonly AlphaFeatureName[];
  readonly successDefinition: string;
  readonly totalRows: number;
  readonly discoveryRows: number;
  readonly finalTrainingRows: number;
  readonly finalHoldoutRows: number;
  readonly foldSummaries: readonly AlphaConfidenceFoldSummary[];
  readonly discoveryUncalibrated: AlphaProbabilityCalibration;
  readonly discoverySequentiallyCalibrated: AlphaProbabilityCalibration;
  readonly finalHoldoutUncalibrated: AlphaProbabilityCalibration;
  readonly finalHoldoutCalibrated: AlphaProbabilityCalibration;
  readonly productionEnabled: false;
  readonly liveOrderExecutionAllowed: false;
  readonly notes: readonly string[];
}

export const DEFAULT_ALPHA_CONFIDENCE_MODEL_CONFIG = Object.freeze({
  successThresholdPercent: 0,
  l2Lambda: 0.1,
  iterations: 2_000,
  learningRate: 0.05,
  plattL2Lambda: 0.01,
  plattIterations: 2_000,
  plattLearningRate: 0.05,
  calibrationBins: 10,
  minimumCalibrationSamples: 30,
} satisfies AlphaConfidenceModelConfig);

const validateConfidenceConfig = (config: AlphaConfidenceModelConfig): void => {
  if (!Number.isFinite(config.successThresholdPercent)) {
    throw new Error('successThresholdPercent must be finite');
  }
  const nonNegativeFinite = [
    ['l2Lambda', config.l2Lambda],
    ['plattL2Lambda', config.plattL2Lambda],
  ] as const;
  for (const [name, value] of nonNegativeFinite) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative finite number`);
    }
  }
  const positiveIntegers = [
    ['iterations', config.iterations],
    ['plattIterations', config.plattIterations],
    ['calibrationBins', config.calibrationBins],
    ['minimumCalibrationSamples', config.minimumCalibrationSamples],
  ] as const;
  for (const [name, value] of positiveIntegers) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
  if (config.calibrationBins < 2 || config.calibrationBins > 100) {
    throw new Error('calibrationBins must be between 2 and 100');
  }
  const learningRates = [
    ['learningRate', config.learningRate],
    ['plattLearningRate', config.plattLearningRate],
  ] as const;
  for (const [name, value] of learningRates) {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new Error(`${name} must be greater than 0 and at most 1`);
    }
  }
};

const hasBothClasses = (
  rows: readonly AlphaResearchDatasetRow[],
  threshold: number,
): boolean => {
  const successCount = rows.filter(
    (row) => row.netReturnPercent > threshold,
  ).length;
  return successCount > 0 && successCount < rows.length;
};

const scorePairsHaveBothClasses = (
  pairs: readonly AlphaPlattScoreObservation[],
): boolean => {
  const successCount = pairs.filter((pair) => pair.success).length;
  return successCount > 0 && successCount < pairs.length;
};

const probabilityCalibration = (
  pairs: readonly AlphaProbabilityObservation[],
  config: AlphaConfidenceModelConfig,
): AlphaProbabilityCalibration =>
  analyzeAlphaProbabilityCalibration({
    pairs,
    binCount: config.calibrationBins,
    minimumSamples: config.minimumCalibrationSamples,
  });

const emptyReport = (input: {
  readonly dataset: AlphaResearchDataset;
  readonly alphaConfig: AlphaResearchConfig;
  readonly confidenceConfig: AlphaConfidenceModelConfig;
  readonly status: Exclude<AlphaConfidenceResearchStatus, 'COMPLETE'>;
  readonly reason: string;
}): AlphaConfidenceResearchReport => {
  const split = createAlphaPurgedWalkForwardSplit(
    input.dataset.rows,
    input.alphaConfig.analysis,
  );
  const empty = probabilityCalibration([], input.confidenceConfig);
  return Object.freeze({
    schemaVersion: ALPHA_CONFIDENCE_REPORT_SCHEMA_VERSION,
    methodologyVersion: 'whale-confidence-v1',
    evaluationId: input.dataset.evaluationId,
    status: input.status,
    alphaConfigurationFingerprint: createAlphaResearchConfigurationFingerprint(
      input.alphaConfig,
    ),
    datasetFingerprint: createAlphaResearchDatasetFingerprint(input.dataset),
    confidenceConfig: Object.freeze({ ...input.confidenceConfig }),
    features: Object.freeze([...input.alphaConfig.extraction.enabledFeatures]),
    successDefinition: `netReturnPercent > ${input.confidenceConfig.successThresholdPercent}`,
    totalRows: input.dataset.rows.length,
    discoveryRows: split.discoveryRows.length,
    finalTrainingRows: split.finalTrainingRows.length,
    finalHoldoutRows: split.finalHoldoutRows.length,
    foldSummaries: Object.freeze([]),
    discoveryUncalibrated: empty,
    discoverySequentiallyCalibrated: empty,
    finalHoldoutUncalibrated: empty,
    finalHoldoutCalibrated: empty,
    productionEnabled: false,
    liveOrderExecutionAllowed: false,
    notes: Object.freeze([
      input.reason,
      'No probability is authorized for production confidence or order execution.',
    ]),
  });
};

export const analyzeAlphaConfidenceResearch = (input: {
  readonly dataset: AlphaResearchDataset;
  readonly alphaConfig: AlphaResearchConfig;
  readonly confidenceConfig?: AlphaConfidenceModelConfig;
}): AlphaConfidenceResearchReport => {
  const confidenceConfig =
    input.confidenceConfig ?? DEFAULT_ALPHA_CONFIDENCE_MODEL_CONFIG;
  validateAlphaFeatureExtractionConfig(input.alphaConfig.extraction);
  validateAlphaResearchAnalysisConfig(input.alphaConfig.analysis);
  validateConfidenceConfig(confidenceConfig);
  validateAlphaResearchDataset(input.dataset);
  if (
    input.dataset.targetHorizonMinutes !==
      input.alphaConfig.analysis.targetHorizonMinutes ||
    input.dataset.roundTripCostPercent !==
      input.alphaConfig.analysis.roundTripCostPercent
  ) {
    throw new Error(
      'Confidence research target assumptions do not match alpha config',
    );
  }
  if (
    input.dataset.missingSnapshots > 0 ||
    input.dataset.unmatchedSnapshots > 0 ||
    input.dataset.unmatchedOutcomes > 0
  ) {
    return emptyReport({
      dataset: input.dataset,
      alphaConfig: input.alphaConfig,
      confidenceConfig,
      status: 'INCOMPLETE_DATA',
      reason:
        'Qualified alerts, event snapshots, and target outcomes must join completely before confidence modeling.',
    });
  }
  const split = createAlphaPurgedWalkForwardSplit(
    input.dataset.rows,
    input.alphaConfig.analysis,
  );
  if (
    split.folds.length < 2 ||
    split.finalTrainingRows.length <
      input.alphaConfig.analysis.minimumTrainingRows ||
    split.finalHoldoutRows.length <
      input.alphaConfig.analysis.minimumHoldoutSamples
  ) {
    return emptyReport({
      dataset: input.dataset,
      alphaConfig: input.alphaConfig,
      confidenceConfig,
      status: input.dataset.synthetic
        ? 'NO_EMPIRICAL_DATA'
        : 'INSUFFICIENT_DATA',
      reason:
        'The purged walk-forward split is too small for a probability model and untouched holdout.',
    });
  }

  const features = input.alphaConfig.extraction.enabledFeatures;
  const uncalibratedDiscoveryPairs: AlphaProbabilityObservation[] = [];
  const sequentiallyCalibratedPairs: AlphaProbabilityObservation[] = [];
  const priorScorePairs: AlphaPlattScoreObservation[] = [];
  const foldSummaries: AlphaConfidenceFoldSummary[] = [];

  for (const fold of split.folds) {
    if (
      !hasBothClasses(
        fold.trainingRows,
        confidenceConfig.successThresholdPercent,
      )
    ) {
      foldSummaries.push(
        Object.freeze({
          foldId: fold.foldId,
          trainingSampleSize: fold.trainingRows.length,
          testingSampleSize: fold.testingRows.length,
          predictedSampleSize: 0,
          priorCalibrationSampleSize: priorScorePairs.length,
          calibratedSampleSize: 0,
          skippedReason:
            'Training fold did not contain both success and failure outcomes.',
        }),
      );
      continue;
    }
    const model = fitAlphaLogisticModel({
      rows: fold.trainingRows,
      features,
      successThresholdPercent: confidenceConfig.successThresholdPercent,
      l2Lambda: confidenceConfig.l2Lambda,
      iterations: confidenceConfig.iterations,
      learningRate: confidenceConfig.learningRate,
    });
    const currentScorePairs = fold.testingRows.map((row) =>
      Object.freeze({
        score: alphaProbabilityLogitScore(model, row),
        success:
          row.netReturnPercent > confidenceConfig.successThresholdPercent,
      }),
    );
    for (let index = 0; index < fold.testingRows.length; index += 1) {
      const row = fold.testingRows[index];
      const scorePair = currentScorePairs[index];
      if (row === undefined || scorePair === undefined) {
        throw new Error('Confidence fold prediction indexing failed');
      }
      uncalibratedDiscoveryPairs.push(
        Object.freeze({
          probability: predictAlphaSuccessProbability(model, row),
          success: scorePair.success,
        }),
      );
    }
    let calibratedSampleSize = 0;
    if (
      priorScorePairs.length >= confidenceConfig.minimumCalibrationSamples &&
      scorePairsHaveBothClasses(priorScorePairs)
    ) {
      const calibrator = fitAlphaPlattCalibrator({
        pairs: priorScorePairs,
        l2Lambda: confidenceConfig.plattL2Lambda,
        iterations: confidenceConfig.plattIterations,
        learningRate: confidenceConfig.plattLearningRate,
      });
      for (const pair of currentScorePairs) {
        sequentiallyCalibratedPairs.push(
          Object.freeze({
            probability: calibrateAlphaProbability(calibrator, pair.score),
            success: pair.success,
          }),
        );
      }
      calibratedSampleSize = currentScorePairs.length;
    }
    foldSummaries.push(
      Object.freeze({
        foldId: fold.foldId,
        trainingSampleSize: fold.trainingRows.length,
        testingSampleSize: fold.testingRows.length,
        predictedSampleSize: currentScorePairs.length,
        priorCalibrationSampleSize: priorScorePairs.length,
        calibratedSampleSize,
        skippedReason: null,
      }),
    );
    priorScorePairs.push(...currentScorePairs);
  }

  if (
    uncalibratedDiscoveryPairs.length === 0 ||
    !hasBothClasses(
      split.finalTrainingRows,
      confidenceConfig.successThresholdPercent,
    )
  ) {
    return emptyReport({
      dataset: input.dataset,
      alphaConfig: input.alphaConfig,
      confidenceConfig,
      status: input.dataset.synthetic
        ? 'NO_EMPIRICAL_DATA'
        : 'INSUFFICIENT_DATA',
      reason:
        'Valid out-of-sample predictions and a two-class final training population are required.',
    });
  }

  const finalModel = fitAlphaLogisticModel({
    rows: split.finalTrainingRows,
    features,
    successThresholdPercent: confidenceConfig.successThresholdPercent,
    l2Lambda: confidenceConfig.l2Lambda,
    iterations: confidenceConfig.iterations,
    learningRate: confidenceConfig.learningRate,
  });
  const finalHoldoutScorePairs = split.finalHoldoutRows.map((row) =>
    Object.freeze({
      score: alphaProbabilityLogitScore(finalModel, row),
      success: row.netReturnPercent > confidenceConfig.successThresholdPercent,
    }),
  );
  const finalHoldoutUncalibratedPairs = split.finalHoldoutRows.map(
    (row, index) => {
      const scorePair = finalHoldoutScorePairs[index];
      if (scorePair === undefined) {
        throw new Error('Final holdout confidence indexing failed');
      }
      return Object.freeze({
        probability: predictAlphaSuccessProbability(finalModel, row),
        success: scorePair.success,
      });
    },
  );
  const finalHoldoutCalibratedPairs: AlphaProbabilityObservation[] = [];
  if (
    priorScorePairs.length >= confidenceConfig.minimumCalibrationSamples &&
    scorePairsHaveBothClasses(priorScorePairs)
  ) {
    const finalCalibrator = fitAlphaPlattCalibrator({
      pairs: priorScorePairs,
      l2Lambda: confidenceConfig.plattL2Lambda,
      iterations: confidenceConfig.plattIterations,
      learningRate: confidenceConfig.plattLearningRate,
    });
    for (const pair of finalHoldoutScorePairs) {
      finalHoldoutCalibratedPairs.push(
        Object.freeze({
          probability: calibrateAlphaProbability(finalCalibrator, pair.score),
          success: pair.success,
        }),
      );
    }
  }

  const status: AlphaConfidenceResearchStatus = input.dataset.synthetic
    ? 'NO_EMPIRICAL_DATA'
    : 'COMPLETE';
  return Object.freeze({
    schemaVersion: ALPHA_CONFIDENCE_REPORT_SCHEMA_VERSION,
    methodologyVersion: 'whale-confidence-v1',
    evaluationId: input.dataset.evaluationId,
    status,
    alphaConfigurationFingerprint: createAlphaResearchConfigurationFingerprint(
      input.alphaConfig,
    ),
    datasetFingerprint: createAlphaResearchDatasetFingerprint(input.dataset),
    confidenceConfig: Object.freeze({ ...confidenceConfig }),
    features: Object.freeze([...features]),
    successDefinition: `netReturnPercent > ${confidenceConfig.successThresholdPercent}`,
    totalRows: input.dataset.rows.length,
    discoveryRows: split.discoveryRows.length,
    finalTrainingRows: split.finalTrainingRows.length,
    finalHoldoutRows: split.finalHoldoutRows.length,
    foldSummaries: Object.freeze(foldSummaries),
    discoveryUncalibrated: probabilityCalibration(
      uncalibratedDiscoveryPairs,
      confidenceConfig,
    ),
    discoverySequentiallyCalibrated: probabilityCalibration(
      sequentiallyCalibratedPairs,
      confidenceConfig,
    ),
    finalHoldoutUncalibrated: probabilityCalibration(
      finalHoldoutUncalibratedPairs,
      confidenceConfig,
    ),
    finalHoldoutCalibrated: probabilityCalibration(
      finalHoldoutCalibratedPairs,
      confidenceConfig,
    ),
    productionEnabled: false,
    liveOrderExecutionAllowed: false,
    notes: Object.freeze([
      'Every logistic feature transform and coefficient is fitted on the training fold only.',
      'Sequential discovery calibration uses only score/outcome pairs from earlier folds.',
      'The final holdout calibrator is fitted only on discovery out-of-sample scores.',
      'Success is defined after the configured round-trip cost already embedded in netReturnPercent.',
      'Calibration quality and discrimination are reported separately; neither alone proves positive expectancy.',
      input.dataset.synthetic
        ? 'Synthetic output validates plumbing only and cannot authorize a confidence model.'
        : 'Production confidence remains disabled pending positive expectancy, calibration, stability, and execution review.',
    ]),
  });
};
