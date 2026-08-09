import type {
  AlphaBootstrapEstimate,
  AlphaConditionalEffectEstimate,
  AlphaFeatureConclusion,
  AlphaFeatureFoldEvaluation,
  AlphaFeatureInteractionEntry,
  AlphaFeatureOrientation,
  AlphaFeatureRankingEntry,
  AlphaResearchReport,
} from './alphaAnalysisTypes';
import { ALPHA_RESEARCH_REPORT_SCHEMA_VERSION } from './alphaAnalysisTypes';
import {
  ALPHA_FEATURE_NAMES,
  type AlphaFeatureName,
  type AlphaResearchConfig,
  type AlphaResearchDataset,
  type AlphaResearchDatasetRow,
} from './alphaFeatureTypes';
import {
  createAlphaPartialDependence,
  evaluateAlphaLinearFold,
  fitAlphaRidgeModel,
  predictAlphaRidgeModel,
} from './alphaLinearModel';
import { analyzeAlphaRegressionCalibration } from './alphaCalibration';
import { analyzeAlphaFeatureDrift } from './alphaFeatureDrift';
import { ALPHA_FEATURE_REGISTRY_VERSION } from './alphaFeatureRegistry';
import { simulateAlphaEpisodePaths } from './alphaMonteCarlo';
import {
  validateAlphaFeatureExtractionConfig,
  validateAlphaResearchAnalysisConfig,
} from './alphaResearchConfig';
import {
  alphaMean,
  alphaMutualInformation,
  alphaPearsonCorrelation,
  alphaQuantile,
  alphaSpearmanCorrelation,
  assignAlphaEpisodeIds,
  bayesianBootstrapAlphaEstimate,
  benjaminiHochbergAdjustedPValues,
  bootstrapAlphaEstimate,
  bootstrapAlphaConditionalEffect,
} from './alphaStatistics';
import { createAlphaPurgedWalkForwardSplit } from './alphaWalkForward';
import {
  createAlphaResearchConfigurationFingerprint,
  createAlphaResearchDatasetFingerprint,
} from './alphaResearchFingerprint';
import { validateAlphaResearchDataset } from './alphaResearchDataset';
import { requireArrayElement } from '../core/arrayAccess';

interface WeightedMetric {
  readonly value: number;
  readonly weight: number;
}

interface FeatureWorkingResult {
  readonly feature: AlphaFeatureName;
  readonly availableRows: readonly AlphaResearchDatasetRow[];
  readonly selectedRows: readonly AlphaResearchDatasetRow[];
  readonly selectedAlertIds: ReadonlySet<string>;
  readonly folds: readonly AlphaFeatureFoldEvaluation[];
  readonly informationCoefficient: number | null;
  readonly mutualInformation: number | null;
  readonly permutationImportance: number | null;
  readonly meanAbsoluteLinearShap: number | null;
  readonly partialDependence: AlphaFeatureRankingEntry['partialDependence'];
  readonly estimate: AlphaBootstrapEstimate;
  readonly effectEstimate: AlphaConditionalEffectEstimate;
  readonly unconditionalExpectancy: number | null;
  readonly conditionalEffect: number | null;
  readonly positiveFoldFraction: number | null;
  readonly orientationStability: number | null;
  readonly dominantOrientation: AlphaFeatureOrientation | null;
  readonly instrumentPerformance: AlphaFeatureRankingEntry['instrumentPerformance'];
  readonly positiveInstrumentFraction: number | null;
  readonly directionPerformance: AlphaFeatureRankingEntry['directionPerformance'];
  readonly holdoutEstimate: AlphaBootstrapEstimate;
  readonly holdoutEffectEstimate: AlphaConditionalEffectEstimate;
  readonly holdoutInstrumentPerformance: AlphaFeatureRankingEntry['holdoutInstrumentPerformance'];
  readonly holdoutPositiveInstrumentFraction: number | null;
}

const EMPTY_ESTIMATE: AlphaBootstrapEstimate = Object.freeze({
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

const EMPTY_EFFECT_ESTIMATE: AlphaConditionalEffectEstimate = Object.freeze({
  availableSampleSize: 0,
  selectedSampleSize: 0,
  independentEpisodeCount: 0,
  selectedIndependentEpisodeCount: 0,
  effectiveIterations: 0,
  effectPercent: null,
  lowerConfidencePercent: null,
  upperConfidencePercent: null,
  probabilityPositive: null,
  oneSidedPValue: null,
});

const weightedMean = (metrics: readonly WeightedMetric[]): number | null => {
  const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);
  return totalWeight === 0
    ? null
    : metrics.reduce((sum, metric) => sum + metric.value * metric.weight, 0) /
        totalWeight;
};

const subgroupPerformance = (
  rows: readonly AlphaResearchDatasetRow[],
  groupFor: (row: AlphaResearchDatasetRow) => string,
): AlphaFeatureRankingEntry['instrumentPerformance'] => {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const group = groupFor(row);
    const values = groups.get(group) ?? [];
    values.push(row.netReturnPercent);
    groups.set(group, values);
  }
  return Object.freeze(
    [...groups]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, values]) =>
        Object.freeze({
          group,
          sampleSize: values.length,
          expectancyPercent: alphaMean(values) ?? 0,
        }),
      ),
  );
};

const positiveSubgroupFraction = (
  groups: AlphaFeatureRankingEntry['instrumentPerformance'],
  minimumSamples: number,
): number | null => {
  const eligible = groups.filter((group) => group.sampleSize >= minimumSamples);
  return eligible.length === 0
    ? null
    : eligible.filter((group) => group.expectancyPercent > 0).length /
        eligible.length;
};

const featurePairs = (
  rows: readonly AlphaResearchDatasetRow[],
  feature: AlphaFeatureName,
): Readonly<{ values: readonly number[]; returns: readonly number[] }> => {
  const values: number[] = [];
  const returns: number[] = [];
  for (const row of rows) {
    const value = row.features[feature];
    if (value === null) continue;
    values.push(value);
    returns.push(row.netReturnPercent);
  }
  return Object.freeze({
    values: Object.freeze(values),
    returns: Object.freeze(returns),
  });
};

const learnFeatureRule = (
  rows: readonly AlphaResearchDatasetRow[],
  feature: AlphaFeatureName,
  conditionalQuantile: number,
  minimumSamples: number,
): Readonly<{
  orientation: AlphaFeatureOrientation;
  threshold: number;
}> | null => {
  const paired = featurePairs(rows, feature);
  if (paired.values.length < minimumSamples) return null;
  const correlation = alphaSpearmanCorrelation(paired.values, paired.returns);
  if (correlation === null) return null;
  const orientation: AlphaFeatureOrientation =
    correlation >= 0 ? 'HIGH' : 'LOW';
  const threshold = alphaQuantile(
    paired.values,
    orientation === 'HIGH' ? 1 - conditionalQuantile : conditionalQuantile,
  );
  return threshold === null ? null : Object.freeze({ orientation, threshold });
};

const ruleSelects = (
  row: AlphaResearchDatasetRow,
  feature: AlphaFeatureName,
  orientation: AlphaFeatureOrientation,
  threshold: number,
): boolean => {
  const value = row.features[feature];
  return (
    value !== null &&
    (orientation === 'HIGH' ? value >= threshold : value <= threshold)
  );
};

const featureSeed = (baseSeed: number, index: number, offset: number): number =>
  (baseSeed + (index + 1) * 104_729 + offset) >>> 0;

const offsetSeed = (baseSeed: number, offset: number): number =>
  (baseSeed + offset) >>> 0;

const classifyFeature = (input: {
  readonly estimate: AlphaBootstrapEstimate;
  readonly effectEstimate: AlphaConditionalEffectEstimate;
  readonly adjustedPValue: number | null;
  readonly falseDiscoveryRate: number;
  readonly neutralEffectPercent: number;
  readonly positiveFoldFraction: number | null;
  readonly minimumPositiveFoldFraction: number;
  readonly minimumSamples: number;
  readonly minimumEpisodes: number;
}): AlphaFeatureConclusion => {
  if (
    input.estimate.sampleSize < input.minimumSamples ||
    input.estimate.independentEpisodeCount < input.minimumEpisodes ||
    input.effectEstimate.effectPercent === null
  ) {
    return 'INCONCLUSIVE';
  }
  if (
    input.effectEstimate.lowerConfidencePercent !== null &&
    input.effectEstimate.lowerConfidencePercent > input.neutralEffectPercent &&
    input.estimate.meanPercent !== null &&
    input.estimate.meanPercent > 0 &&
    input.estimate.lowerConfidencePercent !== null &&
    input.estimate.lowerConfidencePercent > 0 &&
    input.adjustedPValue !== null &&
    input.adjustedPValue <= input.falseDiscoveryRate &&
    input.positiveFoldFraction !== null &&
    input.positiveFoldFraction >= input.minimumPositiveFoldFraction
  ) {
    return 'IMPROVES_EXPECTANCY';
  }
  if (
    input.effectEstimate.upperConfidencePercent !== null &&
    input.effectEstimate.upperConfidencePercent < -input.neutralEffectPercent
  ) {
    return 'HARMFUL';
  }
  if (
    input.effectEstimate.lowerConfidencePercent !== null &&
    input.effectEstimate.upperConfidencePercent !== null &&
    input.effectEstimate.lowerConfidencePercent >=
      -input.neutralEffectPercent &&
    input.effectEstimate.upperConfidencePercent <= input.neutralEffectPercent
  ) {
    return 'NEUTRAL';
  }
  return 'INCONCLUSIVE';
};

const normalizeMetric = (
  value: number | null,
  values: readonly number[],
): number => {
  if (value === null || values.length === 0) return 0;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return maximum === minimum
    ? maximum > 0
      ? 1
      : 0
    : (value - minimum) / (maximum - minimum);
};

const unavailableRanking = (
  enabledFeatures: readonly AlphaFeatureName[],
  reason: string,
): readonly AlphaFeatureRankingEntry[] =>
  Object.freeze(
    enabledFeatures.map((feature, index) =>
      Object.freeze({
        rank: index + 1,
        feature,
        conclusion: 'INCONCLUSIVE' as const,
        availableOutOfSampleRows: 0,
        selectedOutOfSampleRows: 0,
        missingFraction: 1,
        informationCoefficient: null,
        mutualInformation: null,
        permutationImportance: null,
        meanAbsoluteLinearShap: null,
        partialDependence: Object.freeze([]),
        conditionalEstimate: EMPTY_ESTIMATE,
        conditionalEffectEstimate: EMPTY_EFFECT_ESTIMATE,
        unconditionalDiscoveryExpectancyPercent: null,
        conditionalEffectPercent: null,
        positiveFoldFraction: null,
        orientationStability: null,
        dominantOrientation: null,
        instrumentPerformance: Object.freeze([]),
        positiveInstrumentFraction: null,
        directionPerformance: Object.freeze([]),
        adjustedPValue: null,
        holdoutEstimate: EMPTY_ESTIMATE,
        holdoutConditionalEffectEstimate: EMPTY_EFFECT_ESTIMATE,
        holdoutInstrumentPerformance: Object.freeze([]),
        holdoutPositiveInstrumentFraction: null,
        holdoutAdjustedPValue: null,
        compositeScore: null,
        statisticallyEligible: false,
        productionEnabled: false as const,
        decisionReason: reason,
        folds: Object.freeze([]),
      }),
    ),
  );

const createEmptyReport = (input: {
  readonly dataset: AlphaResearchDataset;
  readonly config: AlphaResearchConfig;
  readonly status:
    'INSUFFICIENT_DATA' | 'INCOMPLETE_DATA' | 'NO_EMPIRICAL_DATA';
  readonly reason: string;
  readonly split?: ReturnType<typeof createAlphaPurgedWalkForwardSplit>;
}): AlphaResearchReport => {
  const rows = input.dataset.rows;
  const episodeIds = assignAlphaEpisodeIds(
    rows,
    input.config.analysis.episodeWindowMs,
  );
  const split =
    input.split ??
    createAlphaPurgedWalkForwardSplit(rows, input.config.analysis);
  const featureDrift = analyzeAlphaFeatureDrift({
    discoveryRows: split.discoveryRows,
    holdoutRows: split.finalHoldoutRows,
    features: input.config.extraction.enabledFeatures,
    binCount: input.config.analysis.driftBins,
    minimumSamples: input.config.analysis.minimumDriftSamples,
    moderateThreshold: input.config.analysis.moderateDriftPsi,
    materialThreshold: input.config.analysis.materialDriftPsi,
  });
  return Object.freeze({
    schemaVersion: ALPHA_RESEARCH_REPORT_SCHEMA_VERSION,
    methodologyVersion: 'whale-alpha-v2',
    featureRegistryVersion: ALPHA_FEATURE_REGISTRY_VERSION,
    configurationFingerprint: createAlphaResearchConfigurationFingerprint(
      input.config,
    ),
    datasetFingerprint: createAlphaResearchDatasetFingerprint(input.dataset),
    researchConfig: input.config,
    evaluationId: input.dataset.evaluationId,
    status: input.status,
    datasetStartedAt: rows[0]?.detectedAt ?? null,
    datasetEndedAt: rows[rows.length - 1]?.detectedAt ?? null,
    totalRows: rows.length,
    inputAlertCount: input.dataset.inputAlertCount,
    inputSnapshotCount: input.dataset.inputSnapshotCount,
    inputOutcomeCount: input.dataset.inputOutcomeCount,
    unmatchedSnapshots: input.dataset.unmatchedSnapshots,
    missingSnapshots: input.dataset.missingSnapshots,
    unmatchedOutcomes: input.dataset.unmatchedOutcomes,
    ignoredOtherHorizonOutcomes: input.dataset.ignoredOtherHorizonOutcomes,
    discoveryRows: split.discoveryRows.length,
    finalHoldoutRows: split.finalHoldoutRows.length,
    targetHorizonMinutes: input.dataset.targetHorizonMinutes,
    roundTripCostPercent: input.dataset.roundTripCostPercent,
    synthetic: input.dataset.synthetic,
    discoveryBaseline: bootstrapAlphaEstimate({
      rows: split.discoveryRows,
      episodeIds,
      iterations: input.config.analysis.bootstrapIterations,
      confidenceLevel: input.config.analysis.confidenceLevel,
      targetPower: input.config.analysis.statisticalPower,
      trimFraction: input.config.analysis.trimmedMeanFraction,
      seed: input.config.analysis.randomSeed,
    }),
    finalHoldoutBaseline: bootstrapAlphaEstimate({
      rows: split.finalHoldoutRows,
      episodeIds,
      iterations: input.config.analysis.bootstrapIterations,
      confidenceLevel: input.config.analysis.confidenceLevel,
      targetPower: input.config.analysis.statisticalPower,
      trimFraction: input.config.analysis.trimmedMeanFraction,
      seed: offsetSeed(input.config.analysis.randomSeed, 1),
    }),
    discoveryBayesianBootstrap: bayesianBootstrapAlphaEstimate({
      rows: split.discoveryRows,
      episodeIds,
      iterations: input.config.analysis.bayesianBootstrapIterations,
      credibleLevel: input.config.analysis.confidenceLevel,
      seed: offsetSeed(input.config.analysis.randomSeed, 51),
    }),
    finalHoldoutBayesianBootstrap: bayesianBootstrapAlphaEstimate({
      rows: split.finalHoldoutRows,
      episodeIds,
      iterations: input.config.analysis.bayesianBootstrapIterations,
      credibleLevel: input.config.analysis.confidenceLevel,
      seed: offsetSeed(input.config.analysis.randomSeed, 52),
    }),
    discoveryMonteCarlo: simulateAlphaEpisodePaths({
      rows: split.discoveryRows,
      episodeIds,
      iterations: input.config.analysis.monteCarloIterations,
      seed: offsetSeed(input.config.analysis.randomSeed, 101),
    }),
    finalHoldoutMonteCarlo: simulateAlphaEpisodePaths({
      rows: split.finalHoldoutRows,
      episodeIds,
      iterations: input.config.analysis.monteCarloIterations,
      seed: offsetSeed(input.config.analysis.randomSeed, 102),
    }),
    discoveryModelCalibration: analyzeAlphaRegressionCalibration({
      pairs: Object.freeze([]),
      binCount: input.config.analysis.calibrationBins,
      minimumSamples: input.config.analysis.minimumCalibrationSamples,
    }),
    finalHoldoutModelCalibration: analyzeAlphaRegressionCalibration({
      pairs: Object.freeze([]),
      binCount: input.config.analysis.calibrationBins,
      minimumSamples: input.config.analysis.minimumCalibrationSamples,
    }),
    folds: Object.freeze(
      split.folds.map((fold) =>
        Object.freeze({
          foldId: fold.foldId,
          trainingSampleSize: fold.trainingRows.length,
          testingSampleSize: fold.testingRows.length,
          testStartedAt: fold.testStartedAt,
          testEndedAt: fold.testEndedAt,
        }),
      ),
    ),
    featureRanking: unavailableRanking(
      input.config.extraction.enabledFeatures,
      input.reason,
    ),
    interactions: Object.freeze([]),
    highCorrelations: Object.freeze([]),
    featureDrift,
    productionFeaturesEnabled: Object.freeze([]),
    notes: Object.freeze([
      input.reason,
      'No feature is enabled for production by this research report.',
    ]),
    liveOrderExecutionAllowed: false,
  });
};

export const analyzeAlphaResearchDataset = (input: {
  readonly dataset: AlphaResearchDataset;
  readonly config: AlphaResearchConfig;
}): AlphaResearchReport => {
  validateAlphaFeatureExtractionConfig(input.config.extraction);
  validateAlphaResearchAnalysisConfig(input.config.analysis);
  validateAlphaResearchDataset(input.dataset);
  if (
    input.dataset.targetHorizonMinutes !==
      input.config.analysis.targetHorizonMinutes ||
    input.dataset.roundTripCostPercent !==
      input.config.analysis.roundTripCostPercent
  ) {
    throw new Error(
      'Alpha dataset target assumptions do not match analysis config',
    );
  }
  const split = createAlphaPurgedWalkForwardSplit(
    input.dataset.rows,
    input.config.analysis,
  );
  if (
    input.dataset.missingSnapshots > 0 ||
    input.dataset.unmatchedSnapshots > 0 ||
    input.dataset.unmatchedOutcomes > 0
  ) {
    return createEmptyReport({
      dataset: input.dataset,
      config: input.config,
      status: 'INCOMPLETE_DATA',
      reason:
        'One or more qualified alerts, event snapshots, or target outcomes failed to join; subset analysis is blocked.',
      split,
    });
  }
  if (input.dataset.rows.length === 0) {
    return createEmptyReport({
      dataset: input.dataset,
      config: input.config,
      status: 'NO_EMPIRICAL_DATA',
      reason: 'No joined alert/outcome rows were available for alpha analysis.',
      split,
    });
  }
  if (
    split.folds.length < 2 ||
    split.finalTrainingRows.length <
      input.config.analysis.minimumTrainingRows ||
    split.finalHoldoutRows.length < input.config.analysis.minimumHoldoutSamples
  ) {
    return createEmptyReport({
      dataset: input.dataset,
      config: input.config,
      status: input.dataset.synthetic
        ? 'NO_EMPIRICAL_DATA'
        : 'INSUFFICIENT_DATA',
      reason:
        'The dataset is too small after chronological holdout, purge, and embargo constraints.',
      split,
    });
  }

  const features = input.config.extraction.enabledFeatures;
  const featureDrift = analyzeAlphaFeatureDrift({
    discoveryRows: split.discoveryRows,
    holdoutRows: split.finalHoldoutRows,
    features,
    binCount: input.config.analysis.driftBins,
    minimumSamples: input.config.analysis.minimumDriftSamples,
    moderateThreshold: input.config.analysis.moderateDriftPsi,
    materialThreshold: input.config.analysis.materialDriftPsi,
  });
  const driftByFeature = new Map(
    featureDrift.map((entry) => [entry.feature, entry]),
  );
  const allEpisodeIds = assignAlphaEpisodeIds(
    input.dataset.rows,
    input.config.analysis.episodeWindowMs,
  );
  const oosRowByAlertId = new Map<string, AlphaResearchDatasetRow>();
  const oosPredictionByAlertId = new Map<string, number>();
  const permutationByFeature = new Map<AlphaFeatureName, WeightedMetric[]>();
  const shapByFeature = new Map<AlphaFeatureName, WeightedMetric[]>();
  for (const feature of features) {
    permutationByFeature.set(feature, []);
    shapByFeature.set(feature, []);
  }

  split.folds.forEach((fold, foldIndex) => {
    for (const row of fold.testingRows) oosRowByAlertId.set(row.alertId, row);
    const model = fitAlphaRidgeModel({
      rows: fold.trainingRows,
      features,
      ridgeLambda: input.config.analysis.ridgeLambda,
    });
    const linear = evaluateAlphaLinearFold({
      model,
      testingRows: fold.testingRows,
      permutationRepeats: input.config.analysis.permutationRepeats,
      randomSeed: featureSeed(
        input.config.analysis.randomSeed,
        foldIndex,
        9_001,
      ),
    });
    for (const [alertId, prediction] of linear.predictions) {
      if (oosPredictionByAlertId.has(alertId)) {
        throw new Error(`Duplicate OOS prediction for alert ${alertId}`);
      }
      oosPredictionByAlertId.set(alertId, prediction);
    }
    for (const feature of features) {
      const permutation = linear.permutationImportance.get(feature);
      if (permutation !== undefined) {
        permutationByFeature.get(feature)?.push({
          value: permutation,
          weight: fold.testingRows.length,
        });
      }
      const shap = linear.meanAbsoluteShap.get(feature);
      if (shap !== undefined) {
        shapByFeature.get(feature)?.push({
          value: shap,
          weight: fold.testingRows.length,
        });
      }
    }
  });
  const oosRows = Object.freeze([...oosRowByAlertId.values()]);
  const finalModel = fitAlphaRidgeModel({
    rows: split.finalTrainingRows,
    features,
    ridgeLambda: input.config.analysis.ridgeLambda,
  });
  const discoveryModelCalibration = analyzeAlphaRegressionCalibration({
    pairs: oosRows.map((row) => {
      const prediction = oosPredictionByAlertId.get(row.alertId);
      if (prediction === undefined) {
        throw new Error(`Missing OOS prediction for alert ${row.alertId}`);
      }
      return Object.freeze({
        prediction,
        observation: row.netReturnPercent,
      });
    }),
    binCount: input.config.analysis.calibrationBins,
    minimumSamples: input.config.analysis.minimumCalibrationSamples,
  });
  const finalHoldoutModelCalibration = analyzeAlphaRegressionCalibration({
    pairs: split.finalHoldoutRows.map((row) =>
      Object.freeze({
        prediction: predictAlphaRidgeModel(finalModel, row),
        observation: row.netReturnPercent,
      }),
    ),
    binCount: input.config.analysis.calibrationBins,
    minimumSamples: input.config.analysis.minimumCalibrationSamples,
  });

  const workingResults: FeatureWorkingResult[] = [];
  features.forEach((feature, featureIndex) => {
    const foldEvaluations: AlphaFeatureFoldEvaluation[] = [];
    const selectedByAlertId = new Map<string, AlphaResearchDatasetRow>();
    const availableByAlertId = new Map<string, AlphaResearchDatasetRow>();
    let highOrientations = 0;
    let lowOrientations = 0;
    for (const fold of split.folds) {
      const rule = learnFeatureRule(
        fold.trainingRows,
        feature,
        input.config.analysis.conditionalQuantile,
        input.config.analysis.minimumFeatureSamples,
      );
      if (rule === null) continue;
      if (rule.orientation === 'HIGH') highOrientations += 1;
      else lowOrientations += 1;
      const available = fold.testingRows.filter(
        (row) => row.features[feature] !== null,
      );
      const selected = available.filter((row) =>
        ruleSelects(row, feature, rule.orientation, rule.threshold),
      );
      for (const row of available) availableByAlertId.set(row.alertId, row);
      for (const row of selected) selectedByAlertId.set(row.alertId, row);
      foldEvaluations.push(
        Object.freeze({
          foldId: fold.foldId,
          orientation: rule.orientation,
          threshold: rule.threshold,
          availableTestSamples: available.length,
          selectedTestSamples: selected.length,
          conditionalExpectancyPercent: alphaMean(
            selected.map((row) => row.netReturnPercent),
          ),
        }),
      );
    }
    const availableRows = Object.freeze([...availableByAlertId.values()]);
    const selectedRows = Object.freeze([...selectedByAlertId.values()]);
    const selectedAlertIds = new Set(selectedRows.map((row) => row.alertId));
    const paired = featurePairs(availableRows, feature);
    const informationCoefficient = alphaSpearmanCorrelation(
      paired.values,
      paired.returns,
    );
    const mutualInformation = alphaMutualInformation(
      paired.values,
      paired.returns,
      input.config.analysis.mutualInformationBins,
    );
    const estimate = bootstrapAlphaEstimate({
      rows: selectedRows,
      episodeIds: allEpisodeIds,
      iterations: input.config.analysis.bootstrapIterations,
      confidenceLevel: input.config.analysis.confidenceLevel,
      targetPower: input.config.analysis.statisticalPower,
      trimFraction: input.config.analysis.trimmedMeanFraction,
      seed: featureSeed(input.config.analysis.randomSeed, featureIndex, 17_003),
    });
    const effectEstimate = bootstrapAlphaConditionalEffect({
      availableRows,
      selectedAlertIds,
      episodeIds: allEpisodeIds,
      iterations: input.config.analysis.bootstrapIterations,
      confidenceLevel: input.config.analysis.confidenceLevel,
      seed: featureSeed(input.config.analysis.randomSeed, featureIndex, 19_009),
    });
    const unconditionalExpectancy = alphaMean(
      availableRows.map((row) => row.netReturnPercent),
    );
    const conditionalEffect = effectEstimate.effectPercent;
    const foldExpectancies = foldEvaluations
      .map((fold) => fold.conditionalExpectancyPercent)
      .filter((value): value is number => value !== null);
    const orientationCount = highOrientations + lowOrientations;
    const dominantOrientation: AlphaFeatureOrientation | null =
      orientationCount === 0
        ? null
        : highOrientations >= lowOrientations
          ? 'HIGH'
          : 'LOW';

    const finalRule = learnFeatureRule(
      split.finalTrainingRows,
      feature,
      input.config.analysis.conditionalQuantile,
      input.config.analysis.minimumFeatureSamples,
    );
    const selectedHoldout =
      finalRule === null
        ? Object.freeze([])
        : Object.freeze(
            split.finalHoldoutRows.filter((row) =>
              ruleSelects(
                row,
                feature,
                finalRule.orientation,
                finalRule.threshold,
              ),
            ),
          );
    const availableHoldout = Object.freeze(
      split.finalHoldoutRows.filter((row) => row.features[feature] !== null),
    );
    const selectedHoldoutIds = new Set(
      selectedHoldout.map((row) => row.alertId),
    );
    const holdoutEstimate = bootstrapAlphaEstimate({
      rows: selectedHoldout,
      episodeIds: allEpisodeIds,
      iterations: input.config.analysis.bootstrapIterations,
      confidenceLevel: input.config.analysis.confidenceLevel,
      targetPower: input.config.analysis.statisticalPower,
      trimFraction: input.config.analysis.trimmedMeanFraction,
      seed: featureSeed(input.config.analysis.randomSeed, featureIndex, 31_337),
    });
    const holdoutEffectEstimate = bootstrapAlphaConditionalEffect({
      availableRows: availableHoldout,
      selectedAlertIds: selectedHoldoutIds,
      episodeIds: allEpisodeIds,
      iterations: input.config.analysis.bootstrapIterations,
      confidenceLevel: input.config.analysis.confidenceLevel,
      seed: featureSeed(input.config.analysis.randomSeed, featureIndex, 37_111),
    });
    const instrumentPerformance = subgroupPerformance(
      selectedRows,
      (row) => row.instrumentId,
    );
    const holdoutInstrumentPerformance = subgroupPerformance(
      selectedHoldout,
      (row) => row.instrumentId,
    );
    workingResults.push(
      Object.freeze({
        feature,
        availableRows,
        selectedRows,
        selectedAlertIds,
        folds: Object.freeze(foldEvaluations),
        informationCoefficient,
        mutualInformation,
        permutationImportance: weightedMean(
          permutationByFeature.get(feature) ?? [],
        ),
        meanAbsoluteLinearShap: weightedMean(shapByFeature.get(feature) ?? []),
        partialDependence: createAlphaPartialDependence({
          model: finalModel,
          referenceRows: split.finalTrainingRows,
          feature,
          gridPoints: input.config.analysis.partialDependenceGridPoints,
          lowerQuantile: input.config.analysis.partialDependenceLowerQuantile,
          upperQuantile: input.config.analysis.partialDependenceUpperQuantile,
        }),
        estimate,
        effectEstimate,
        unconditionalExpectancy,
        conditionalEffect,
        positiveFoldFraction:
          foldExpectancies.length === 0
            ? null
            : foldExpectancies.filter((value) => value > 0).length /
              foldExpectancies.length,
        orientationStability:
          orientationCount === 0
            ? null
            : Math.max(highOrientations, lowOrientations) / orientationCount,
        dominantOrientation,
        instrumentPerformance,
        positiveInstrumentFraction: positiveSubgroupFraction(
          instrumentPerformance,
          input.config.analysis.minimumInstrumentSamples,
        ),
        directionPerformance: subgroupPerformance(
          selectedRows,
          (row) => row.direction,
        ),
        holdoutEstimate,
        holdoutEffectEstimate,
        holdoutInstrumentPerformance,
        holdoutPositiveInstrumentFraction: positiveSubgroupFraction(
          holdoutInstrumentPerformance,
          input.config.analysis.minimumInstrumentSamples,
        ),
      }),
    );
  });

  const eligibleDiscoveryPValues = workingResults.flatMap((result) =>
    result.effectEstimate.oneSidedPValue !== null &&
    result.estimate.sampleSize >= input.config.analysis.minimumFeatureSamples &&
    result.estimate.independentEpisodeCount >=
      input.config.analysis.minimumIndependentEpisodes
      ? [{ key: result.feature, pValue: result.effectEstimate.oneSidedPValue }]
      : [],
  );
  const adjustedDiscovery = benjaminiHochbergAdjustedPValues(
    eligibleDiscoveryPValues,
  );
  const eligibleHoldoutPValues = workingResults.flatMap((result) =>
    result.holdoutEffectEstimate.oneSidedPValue !== null &&
    result.holdoutEstimate.sampleSize >=
      input.config.analysis.minimumHoldoutSamples &&
    result.holdoutEstimate.independentEpisodeCount >=
      input.config.analysis.minimumHoldoutEpisodes
      ? [
          {
            key: result.feature,
            pValue: result.holdoutEffectEstimate.oneSidedPValue,
          },
        ]
      : [],
  );
  const adjustedHoldout = benjaminiHochbergAdjustedPValues(
    eligibleHoldoutPValues,
  );

  const absoluteInformationCoefficients = workingResults.flatMap((result) =>
    result.informationCoefficient === null
      ? []
      : [Math.abs(result.informationCoefficient)],
  );
  const mutualInformations = workingResults.flatMap((result) =>
    result.mutualInformation === null ? [] : [result.mutualInformation],
  );
  const positivePermutationImportances = workingResults.flatMap((result) =>
    result.permutationImportance === null
      ? []
      : [Math.max(0, result.permutationImportance)],
  );
  const shapValues = workingResults.flatMap((result) =>
    result.meanAbsoluteLinearShap === null
      ? []
      : [result.meanAbsoluteLinearShap],
  );
  const positiveEffects = workingResults.flatMap((result) =>
    result.conditionalEffect === null
      ? []
      : [Math.max(0, result.conditionalEffect)],
  );

  const rankedDrafts = workingResults.map((result) => {
    const adjustedPValue = adjustedDiscovery.get(result.feature) ?? null;
    const holdoutAdjustedPValue = adjustedHoldout.get(result.feature) ?? null;
    const empiricalConclusion = classifyFeature({
      estimate: result.estimate,
      effectEstimate: result.effectEstimate,
      adjustedPValue,
      falseDiscoveryRate: input.config.analysis.falseDiscoveryRate,
      neutralEffectPercent: input.config.analysis.neutralEffectPercent,
      positiveFoldFraction: result.positiveFoldFraction,
      minimumPositiveFoldFraction:
        input.config.analysis.minimumPositiveFoldFraction,
      minimumSamples: input.config.analysis.minimumFeatureSamples,
      minimumEpisodes: input.config.analysis.minimumIndependentEpisodes,
    });
    const conclusion: AlphaFeatureConclusion = input.dataset.synthetic
      ? 'INCONCLUSIVE'
      : empiricalConclusion;
    const weights = input.config.analysis.rankingWeights;
    const informationCoefficientScore = normalizeMetric(
      result.informationCoefficient === null
        ? null
        : Math.abs(result.informationCoefficient),
      absoluteInformationCoefficients,
    );
    const mutualInformationScore = normalizeMetric(
      result.mutualInformation,
      mutualInformations,
    );
    const permutationScore = normalizeMetric(
      result.permutationImportance === null
        ? null
        : Math.max(0, result.permutationImportance),
      positivePermutationImportances,
    );
    const shapScore = normalizeMetric(
      result.meanAbsoluteLinearShap,
      shapValues,
    );
    const effectScore = normalizeMetric(
      result.conditionalEffect === null
        ? null
        : Math.max(0, result.conditionalEffect),
      positiveEffects,
    );
    const missingFraction =
      oosRows.length === 0
        ? 1
        : 1 - result.availableRows.length / oosRows.length;
    const stabilityPenalty = result.orientationStability ?? 0;
    const compositeScore =
      (informationCoefficientScore * weights.informationCoefficient +
        mutualInformationScore * weights.mutualInformation +
        permutationScore * weights.permutationImportance +
        shapScore * weights.linearShap +
        effectScore * weights.conditionalEffect) *
      (1 - missingFraction) *
      stabilityPenalty;
    const statisticallyEligible =
      !input.dataset.synthetic &&
      conclusion === 'IMPROVES_EXPECTANCY' &&
      driftByFeature.get(result.feature)?.classification === 'STABLE' &&
      result.holdoutEstimate.sampleSize >=
        input.config.analysis.minimumHoldoutSamples &&
      result.holdoutEstimate.independentEpisodeCount >=
        input.config.analysis.minimumHoldoutEpisodes &&
      result.holdoutEstimate.meanPercent !== null &&
      result.holdoutEstimate.meanPercent > 0 &&
      result.holdoutEstimate.lowerConfidencePercent !== null &&
      result.holdoutEstimate.lowerConfidencePercent > 0 &&
      result.holdoutEffectEstimate.lowerConfidencePercent !== null &&
      result.holdoutEffectEstimate.lowerConfidencePercent >
        input.config.analysis.neutralEffectPercent &&
      result.instrumentPerformance.filter(
        (group) =>
          group.sampleSize >= input.config.analysis.minimumInstrumentSamples,
      ).length >= input.config.analysis.minimumInstruments &&
      result.positiveInstrumentFraction !== null &&
      result.positiveInstrumentFraction >=
        input.config.analysis.minimumPositiveInstrumentFraction &&
      result.holdoutInstrumentPerformance.filter(
        (group) =>
          group.sampleSize >= input.config.analysis.minimumInstrumentSamples,
      ).length >= input.config.analysis.minimumInstruments &&
      result.holdoutPositiveInstrumentFraction !== null &&
      result.holdoutPositiveInstrumentFraction >=
        input.config.analysis.minimumPositiveInstrumentFraction &&
      holdoutAdjustedPValue !== null &&
      holdoutAdjustedPValue <= input.config.analysis.falseDiscoveryRate;
    const decisionReason = input.dataset.synthetic
      ? 'Disabled: synthetic data cannot support production promotion.'
      : statisticallyEligible
        ? 'Statistical gates passed; the flag remains disabled pending an explicit mechanism and execution review.'
        : 'Disabled: one or more discovery, stability, sample-size, cost, or final-holdout gates failed.';
    return {
      result,
      adjustedPValue,
      holdoutAdjustedPValue,
      conclusion,
      missingFraction,
      compositeScore,
      statisticallyEligible,
      decisionReason,
    };
  });
  rankedDrafts.sort(
    (left, right) =>
      right.compositeScore - left.compositeScore ||
      left.result.feature.localeCompare(right.result.feature),
  );
  const featureRanking: AlphaFeatureRankingEntry[] = rankedDrafts.map(
    (draft, index) =>
      Object.freeze({
        rank: index + 1,
        feature: draft.result.feature,
        conclusion: draft.conclusion,
        availableOutOfSampleRows: draft.result.availableRows.length,
        selectedOutOfSampleRows: draft.result.selectedRows.length,
        missingFraction: draft.missingFraction,
        informationCoefficient: draft.result.informationCoefficient,
        mutualInformation: draft.result.mutualInformation,
        permutationImportance: draft.result.permutationImportance,
        meanAbsoluteLinearShap: draft.result.meanAbsoluteLinearShap,
        partialDependence: draft.result.partialDependence,
        conditionalEstimate: draft.result.estimate,
        conditionalEffectEstimate: draft.result.effectEstimate,
        unconditionalDiscoveryExpectancyPercent:
          draft.result.unconditionalExpectancy,
        conditionalEffectPercent: draft.result.conditionalEffect,
        positiveFoldFraction: draft.result.positiveFoldFraction,
        orientationStability: draft.result.orientationStability,
        dominantOrientation: draft.result.dominantOrientation,
        instrumentPerformance: draft.result.instrumentPerformance,
        positiveInstrumentFraction: draft.result.positiveInstrumentFraction,
        directionPerformance: draft.result.directionPerformance,
        adjustedPValue: draft.adjustedPValue,
        holdoutEstimate: draft.result.holdoutEstimate,
        holdoutConditionalEffectEstimate: draft.result.holdoutEffectEstimate,
        holdoutInstrumentPerformance: draft.result.holdoutInstrumentPerformance,
        holdoutPositiveInstrumentFraction:
          draft.result.holdoutPositiveInstrumentFraction,
        holdoutAdjustedPValue: draft.holdoutAdjustedPValue,
        compositeScore: draft.compositeScore,
        statisticallyEligible: draft.statisticallyEligible,
        productionEnabled: false,
        decisionReason: draft.decisionReason,
        folds: draft.result.folds,
      }),
  );

  const resultByFeature = new Map(
    workingResults.map((result) => [result.feature, result]),
  );
  const interactionFeatures = featureRanking
    .slice(0, input.config.analysis.maximumInteractionFeatures)
    .map((entry) => entry.feature);
  const interactionDrafts: Array<{
    featureA: AlphaFeatureName;
    featureB: AlphaFeatureName;
    selectedRows: readonly AlphaResearchDatasetRow[];
    estimate: AlphaBootstrapEstimate;
    effectEstimate: AlphaConditionalEffectEstimate;
    incrementalEffect: number | null;
    positiveFoldFraction: number | null;
  }> = [];
  for (let left = 0; left < interactionFeatures.length - 1; left += 1) {
    for (let right = left + 1; right < interactionFeatures.length; right += 1) {
      const featureA = requireArrayElement(
        interactionFeatures,
        left,
        'interaction feature A',
      );
      const featureB = requireArrayElement(
        interactionFeatures,
        right,
        'interaction feature B',
      );
      const resultA = resultByFeature.get(featureA);
      const resultB = resultByFeature.get(featureB);
      if (resultA === undefined || resultB === undefined) continue;
      const selected = resultA.selectedRows.filter((row) =>
        resultB.selectedAlertIds.has(row.alertId),
      );
      const estimate = bootstrapAlphaEstimate({
        rows: selected,
        episodeIds: allEpisodeIds,
        iterations: input.config.analysis.bootstrapIterations,
        confidenceLevel: input.config.analysis.confidenceLevel,
        targetPower: input.config.analysis.statisticalPower,
        trimFraction: input.config.analysis.trimmedMeanFraction,
        seed: featureSeed(
          input.config.analysis.randomSeed,
          left * interactionFeatures.length + right,
          70_001,
        ),
      });
      const baselineResult =
        (resultA.estimate.meanPercent ?? Number.NEGATIVE_INFINITY) >=
        (resultB.estimate.meanPercent ?? Number.NEGATIVE_INFINITY)
          ? resultA
          : resultB;
      const effectEstimate = bootstrapAlphaConditionalEffect({
        availableRows: baselineResult.selectedRows,
        selectedAlertIds: new Set(selected.map((row) => row.alertId)),
        episodeIds: allEpisodeIds,
        iterations: input.config.analysis.bootstrapIterations,
        confidenceLevel: input.config.analysis.confidenceLevel,
        seed: featureSeed(
          input.config.analysis.randomSeed,
          left * interactionFeatures.length + right,
          73_009,
        ),
      });
      const incrementalEffect = effectEstimate.effectPercent;
      const foldExpectancies = split.folds
        .map((fold) =>
          alphaMean(
            fold.testingRows
              .filter(
                (row) =>
                  resultA.selectedAlertIds.has(row.alertId) &&
                  resultB.selectedAlertIds.has(row.alertId),
              )
              .map((row) => row.netReturnPercent),
          ),
        )
        .filter((value): value is number => value !== null);
      interactionDrafts.push({
        featureA,
        featureB,
        selectedRows: selected,
        estimate,
        effectEstimate,
        incrementalEffect,
        positiveFoldFraction:
          foldExpectancies.length === 0
            ? null
            : foldExpectancies.filter((value) => value > 0).length /
              foldExpectancies.length,
      });
    }
  }
  const interactionPValues = interactionDrafts.flatMap((draft) =>
    draft.effectEstimate.oneSidedPValue !== null &&
    draft.estimate.sampleSize >= input.config.analysis.minimumFeatureSamples &&
    draft.estimate.independentEpisodeCount >=
      input.config.analysis.minimumIndependentEpisodes
      ? [
          {
            key: `${draft.featureA}|${draft.featureB}`,
            pValue: draft.effectEstimate.oneSidedPValue,
          },
        ]
      : [],
  );
  const adjustedInteractions =
    benjaminiHochbergAdjustedPValues(interactionPValues);
  const interactions: AlphaFeatureInteractionEntry[] = interactionDrafts.map(
    (draft) => {
      const key = `${draft.featureA}|${draft.featureB}`;
      const adjustedPValue = adjustedInteractions.get(key) ?? null;
      const empiricalConclusion: AlphaFeatureConclusion =
        draft.estimate.sampleSize <
          input.config.analysis.minimumFeatureSamples ||
        draft.estimate.independentEpisodeCount <
          input.config.analysis.minimumIndependentEpisodes
          ? 'INCONCLUSIVE'
          : draft.estimate.lowerConfidencePercent !== null &&
              draft.estimate.lowerConfidencePercent > 0 &&
              draft.effectEstimate.lowerConfidencePercent !== null &&
              draft.effectEstimate.lowerConfidencePercent >
                input.config.analysis.neutralEffectPercent &&
              adjustedPValue !== null &&
              adjustedPValue <= input.config.analysis.falseDiscoveryRate &&
              draft.positiveFoldFraction !== null &&
              draft.positiveFoldFraction >=
                input.config.analysis.minimumPositiveFoldFraction
            ? 'IMPROVES_EXPECTANCY'
            : draft.effectEstimate.upperConfidencePercent !== null &&
                draft.effectEstimate.upperConfidencePercent <
                  -input.config.analysis.neutralEffectPercent
              ? 'HARMFUL'
              : draft.effectEstimate.lowerConfidencePercent !== null &&
                  draft.effectEstimate.upperConfidencePercent !== null &&
                  draft.effectEstimate.lowerConfidencePercent >=
                    -input.config.analysis.neutralEffectPercent &&
                  draft.effectEstimate.upperConfidencePercent <=
                    input.config.analysis.neutralEffectPercent
                ? 'NEUTRAL'
                : 'INCONCLUSIVE';
      const conclusion: AlphaFeatureConclusion = input.dataset.synthetic
        ? 'INCONCLUSIVE'
        : empiricalConclusion;
      return Object.freeze({
        featureA: draft.featureA,
        featureB: draft.featureB,
        selectedOutOfSampleRows: draft.selectedRows.length,
        estimate: draft.estimate,
        incrementalEffectPercent: draft.incrementalEffect,
        incrementalEffectEstimate: draft.effectEstimate,
        positiveFoldFraction: draft.positiveFoldFraction,
        adjustedPValue,
        conclusion,
      });
    },
  );
  interactions.sort(
    (left, right) =>
      (right.estimate.meanPercent ?? Number.NEGATIVE_INFINITY) -
        (left.estimate.meanPercent ?? Number.NEGATIVE_INFINITY) ||
      left.featureA.localeCompare(right.featureA) ||
      left.featureB.localeCompare(right.featureB),
  );

  const highCorrelations: AlphaResearchReport['highCorrelations'][number][] =
    [];
  for (let left = 0; left < features.length - 1; left += 1) {
    for (let right = left + 1; right < features.length; right += 1) {
      const featureA = requireArrayElement(
        features,
        left,
        'correlation feature A',
      );
      const featureB = requireArrayElement(
        features,
        right,
        'correlation feature B',
      );
      const leftValues: number[] = [];
      const rightValues: number[] = [];
      for (const row of oosRows) {
        const leftValue = row.features[featureA];
        const rightValue = row.features[featureB];
        if (leftValue === null || rightValue === null) continue;
        leftValues.push(leftValue);
        rightValues.push(rightValue);
      }
      const correlation = alphaPearsonCorrelation(leftValues, rightValues);
      if (
        correlation !== null &&
        Math.abs(correlation) >= input.config.analysis.correlationThreshold
      ) {
        highCorrelations.push(
          Object.freeze({
            featureA,
            featureB,
            sampleSize: leftValues.length,
            correlation,
          }),
        );
      }
    }
  }
  highCorrelations.sort(
    (left, right) => Math.abs(right.correlation) - Math.abs(left.correlation),
  );

  const discoveryBaseline = bootstrapAlphaEstimate({
    rows: split.discoveryRows,
    episodeIds: allEpisodeIds,
    iterations: input.config.analysis.bootstrapIterations,
    confidenceLevel: input.config.analysis.confidenceLevel,
    targetPower: input.config.analysis.statisticalPower,
    trimFraction: input.config.analysis.trimmedMeanFraction,
    seed: offsetSeed(input.config.analysis.randomSeed, 2),
  });
  const finalHoldoutBaseline = bootstrapAlphaEstimate({
    rows: split.finalHoldoutRows,
    episodeIds: allEpisodeIds,
    iterations: input.config.analysis.bootstrapIterations,
    confidenceLevel: input.config.analysis.confidenceLevel,
    targetPower: input.config.analysis.statisticalPower,
    trimFraction: input.config.analysis.trimmedMeanFraction,
    seed: offsetSeed(input.config.analysis.randomSeed, 3),
  });
  const discoveryBayesianBootstrap = bayesianBootstrapAlphaEstimate({
    rows: split.discoveryRows,
    episodeIds: allEpisodeIds,
    iterations: input.config.analysis.bayesianBootstrapIterations,
    credibleLevel: input.config.analysis.confidenceLevel,
    seed: offsetSeed(input.config.analysis.randomSeed, 53),
  });
  const finalHoldoutBayesianBootstrap = bayesianBootstrapAlphaEstimate({
    rows: split.finalHoldoutRows,
    episodeIds: allEpisodeIds,
    iterations: input.config.analysis.bayesianBootstrapIterations,
    credibleLevel: input.config.analysis.confidenceLevel,
    seed: offsetSeed(input.config.analysis.randomSeed, 54),
  });
  const discoveryMonteCarlo = simulateAlphaEpisodePaths({
    rows: split.discoveryRows,
    episodeIds: allEpisodeIds,
    iterations: input.config.analysis.monteCarloIterations,
    seed: offsetSeed(input.config.analysis.randomSeed, 103),
  });
  const finalHoldoutMonteCarlo = simulateAlphaEpisodePaths({
    rows: split.finalHoldoutRows,
    episodeIds: allEpisodeIds,
    iterations: input.config.analysis.monteCarloIterations,
    seed: offsetSeed(input.config.analysis.randomSeed, 104),
  });
  const status = input.dataset.synthetic ? 'NO_EMPIRICAL_DATA' : 'COMPLETE';
  return Object.freeze({
    schemaVersion: ALPHA_RESEARCH_REPORT_SCHEMA_VERSION,
    methodologyVersion: 'whale-alpha-v2',
    featureRegistryVersion: ALPHA_FEATURE_REGISTRY_VERSION,
    configurationFingerprint: createAlphaResearchConfigurationFingerprint(
      input.config,
    ),
    datasetFingerprint: createAlphaResearchDatasetFingerprint(input.dataset),
    researchConfig: input.config,
    evaluationId: input.dataset.evaluationId,
    status,
    datasetStartedAt: input.dataset.rows[0]?.detectedAt ?? null,
    datasetEndedAt:
      input.dataset.rows[input.dataset.rows.length - 1]?.detectedAt ?? null,
    totalRows: input.dataset.rows.length,
    inputAlertCount: input.dataset.inputAlertCount,
    inputSnapshotCount: input.dataset.inputSnapshotCount,
    inputOutcomeCount: input.dataset.inputOutcomeCount,
    unmatchedSnapshots: input.dataset.unmatchedSnapshots,
    missingSnapshots: input.dataset.missingSnapshots,
    unmatchedOutcomes: input.dataset.unmatchedOutcomes,
    ignoredOtherHorizonOutcomes: input.dataset.ignoredOtherHorizonOutcomes,
    discoveryRows: split.discoveryRows.length,
    finalHoldoutRows: split.finalHoldoutRows.length,
    targetHorizonMinutes: input.dataset.targetHorizonMinutes,
    roundTripCostPercent: input.dataset.roundTripCostPercent,
    synthetic: input.dataset.synthetic,
    discoveryBaseline,
    finalHoldoutBaseline,
    discoveryBayesianBootstrap,
    finalHoldoutBayesianBootstrap,
    discoveryMonteCarlo,
    finalHoldoutMonteCarlo,
    discoveryModelCalibration,
    finalHoldoutModelCalibration,
    folds: Object.freeze(
      split.folds.map((fold) =>
        Object.freeze({
          foldId: fold.foldId,
          trainingSampleSize: fold.trainingRows.length,
          testingSampleSize: fold.testingRows.length,
          testStartedAt: fold.testStartedAt,
          testEndedAt: fold.testEndedAt,
        }),
      ),
    ),
    featureRanking: Object.freeze(featureRanking),
    interactions: Object.freeze(interactions),
    highCorrelations: Object.freeze(highCorrelations),
    featureDrift,
    productionFeaturesEnabled: Object.freeze([]),
    notes: Object.freeze([
      'Feature orientation and thresholds are learned on each training fold only.',
      'The final chronological holdout is excluded from ranking and threshold selection.',
      'Confidence intervals use an episode-cluster bootstrap by instrument and alert direction.',
      'Event Sharpe is unannualized because alert arrival times are irregular.',
      'Linear SHAP values are exact contributions for the fitted ridge model, not tree-model SHAP.',
      'Population stability index compares discovery with the one-time final holdout; it is a promotion gate and never changes ranking or thresholds.',
      'Monte Carlo diagnostics resample dependency-aware alert episodes and report additive event-return path dispersion; they are not a capital or liquidation model.',
      'The episode-weighted Bayesian bootstrap is a prior-light sensitivity analysis; it does not replace the frequentist promotion gates.',
      'Calibration diagnostics evaluate continuous net-return predictions out of sample; no win-probability model is inferred from regression scores.',
      input.dataset.synthetic
        ? 'Synthetic results validate plumbing only and cannot support an alpha or profitability claim.'
        : 'No feature is automatically enabled; statistical eligibility still requires explicit market-mechanism and execution review.',
    ]),
    liveOrderExecutionAllowed: false,
  });
};

export { ALPHA_FEATURE_NAMES };
