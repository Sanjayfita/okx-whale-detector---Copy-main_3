import type {
  AlphaFeatureName,
  AlphaResearchConfig,
  AlphaResearchDatasetRow,
} from './alphaFeatureTypes';

export const ALPHA_RESEARCH_REPORT_SCHEMA_VERSION = 2 as const;

export type AlphaResearchStatus =
  'COMPLETE' | 'INSUFFICIENT_DATA' | 'INCOMPLETE_DATA' | 'NO_EMPIRICAL_DATA';

export type AlphaFeatureConclusion =
  'IMPROVES_EXPECTANCY' | 'NEUTRAL' | 'HARMFUL' | 'INCONCLUSIVE';

export type AlphaFeatureOrientation = 'HIGH' | 'LOW';

export interface AlphaBootstrapEstimate {
  readonly sampleSize: number;
  readonly independentEpisodeCount: number;
  readonly meanPercent: number | null;
  readonly medianPercent: number | null;
  readonly trimmedMeanPercent: number | null;
  readonly eventSharpe: number | null;
  readonly clusterRobustStandardErrorPercent: number | null;
  readonly minimumDetectableEffectPercent: number | null;
  readonly lowerConfidencePercent: number | null;
  readonly upperConfidencePercent: number | null;
  readonly probabilityPositive: number | null;
  readonly oneSidedPValue: number | null;
}

export interface AlphaConditionalEffectEstimate {
  readonly availableSampleSize: number;
  readonly selectedSampleSize: number;
  readonly independentEpisodeCount: number;
  readonly selectedIndependentEpisodeCount: number;
  readonly effectiveIterations: number;
  readonly effectPercent: number | null;
  readonly lowerConfidencePercent: number | null;
  readonly upperConfidencePercent: number | null;
  readonly probabilityPositive: number | null;
  readonly oneSidedPValue: number | null;
}

export interface AlphaBayesianBootstrapEstimate {
  readonly sampleSize: number;
  readonly independentEpisodeCount: number;
  readonly iterations: number;
  readonly posteriorMeanPercent: number | null;
  readonly lowerCrediblePercent: number | null;
  readonly upperCrediblePercent: number | null;
  readonly posteriorProbabilityPositive: number | null;
}

export interface AlphaMonteCarloEstimate {
  readonly sampleSize: number;
  readonly independentEpisodeCount: number;
  readonly iterations: number;
  readonly cumulativeReturnP05Percent: number | null;
  readonly cumulativeReturnP50Percent: number | null;
  readonly cumulativeReturnP95Percent: number | null;
  readonly maximumDrawdownP50Percent: number | null;
  readonly maximumDrawdownP95Percent: number | null;
}

export interface AlphaCalibrationBin {
  readonly sampleSize: number;
  readonly meanPredictedNetReturnPercent: number;
  readonly meanObservedNetReturnPercent: number;
}

export interface AlphaRegressionCalibration {
  readonly sampleSize: number;
  readonly sufficientSamples: boolean;
  readonly meanPredictedNetReturnPercent: number | null;
  readonly meanObservedNetReturnPercent: number | null;
  readonly meanAbsoluteErrorPercent: number | null;
  readonly rootMeanSquaredErrorPercent: number | null;
  readonly calibrationInterceptPercent: number | null;
  readonly calibrationSlope: number | null;
  readonly predictionObservedCorrelation: number | null;
  readonly bins: readonly AlphaCalibrationBin[];
}

export interface AlphaWalkForwardFold {
  readonly foldId: string;
  readonly trainingRows: readonly AlphaResearchDatasetRow[];
  readonly testingRows: readonly AlphaResearchDatasetRow[];
  readonly testStartedAt: number;
  readonly testEndedAt: number;
}

export interface AlphaWalkForwardFoldSummary {
  readonly foldId: string;
  readonly trainingSampleSize: number;
  readonly testingSampleSize: number;
  readonly testStartedAt: number;
  readonly testEndedAt: number;
}

export interface AlphaFeatureFoldEvaluation {
  readonly foldId: string;
  readonly orientation: AlphaFeatureOrientation;
  readonly threshold: number;
  readonly availableTestSamples: number;
  readonly selectedTestSamples: number;
  readonly conditionalExpectancyPercent: number | null;
}

export interface AlphaPartialDependencePoint {
  readonly featureValue: number;
  readonly meanPredictedNetReturnPercent: number;
}

export interface AlphaSubgroupPerformance {
  readonly group: string;
  readonly sampleSize: number;
  readonly expectancyPercent: number;
}

export interface AlphaFeatureRankingEntry {
  readonly rank: number;
  readonly feature: AlphaFeatureName;
  readonly conclusion: AlphaFeatureConclusion;
  readonly availableOutOfSampleRows: number;
  readonly selectedOutOfSampleRows: number;
  readonly missingFraction: number;
  readonly informationCoefficient: number | null;
  readonly mutualInformation: number | null;
  readonly permutationImportance: number | null;
  readonly meanAbsoluteLinearShap: number | null;
  readonly partialDependence: readonly AlphaPartialDependencePoint[];
  readonly conditionalEstimate: AlphaBootstrapEstimate;
  readonly conditionalEffectEstimate: AlphaConditionalEffectEstimate;
  readonly unconditionalDiscoveryExpectancyPercent: number | null;
  readonly conditionalEffectPercent: number | null;
  readonly positiveFoldFraction: number | null;
  readonly orientationStability: number | null;
  readonly dominantOrientation: AlphaFeatureOrientation | null;
  readonly instrumentPerformance: readonly AlphaSubgroupPerformance[];
  readonly positiveInstrumentFraction: number | null;
  readonly directionPerformance: readonly AlphaSubgroupPerformance[];
  readonly adjustedPValue: number | null;
  readonly holdoutEstimate: AlphaBootstrapEstimate;
  readonly holdoutConditionalEffectEstimate: AlphaConditionalEffectEstimate;
  readonly holdoutInstrumentPerformance: readonly AlphaSubgroupPerformance[];
  readonly holdoutPositiveInstrumentFraction: number | null;
  readonly holdoutAdjustedPValue: number | null;
  readonly compositeScore: number | null;
  readonly statisticallyEligible: boolean;
  readonly productionEnabled: false;
  readonly decisionReason: string;
  readonly folds: readonly AlphaFeatureFoldEvaluation[];
}

export interface AlphaFeatureInteractionEntry {
  readonly featureA: AlphaFeatureName;
  readonly featureB: AlphaFeatureName;
  readonly selectedOutOfSampleRows: number;
  readonly estimate: AlphaBootstrapEstimate;
  readonly incrementalEffectPercent: number | null;
  readonly incrementalEffectEstimate: AlphaConditionalEffectEstimate;
  readonly positiveFoldFraction: number | null;
  readonly adjustedPValue: number | null;
  readonly conclusion: AlphaFeatureConclusion;
}

export interface AlphaFeatureCorrelationEntry {
  readonly featureA: AlphaFeatureName;
  readonly featureB: AlphaFeatureName;
  readonly sampleSize: number;
  readonly correlation: number;
}

export type AlphaFeatureDriftClassification =
  'STABLE' | 'MODERATE_DRIFT' | 'MATERIAL_DRIFT' | 'INCONCLUSIVE';

export interface AlphaFeatureDriftEntry {
  readonly feature: AlphaFeatureName;
  readonly discoverySamples: number;
  readonly holdoutSamples: number;
  readonly discoveryMissingFraction: number;
  readonly holdoutMissingFraction: number;
  readonly populationStabilityIndex: number | null;
  readonly classification: AlphaFeatureDriftClassification;
}

export interface AlphaResearchReport {
  readonly schemaVersion: typeof ALPHA_RESEARCH_REPORT_SCHEMA_VERSION;
  readonly methodologyVersion: 'whale-alpha-v2';
  readonly featureRegistryVersion: 'alpha-feature-registry-v1';
  readonly configurationFingerprint: string;
  readonly datasetFingerprint: string;
  readonly researchConfig: AlphaResearchConfig;
  readonly evaluationId: string;
  readonly status: AlphaResearchStatus;
  readonly datasetStartedAt: number | null;
  readonly datasetEndedAt: number | null;
  readonly totalRows: number;
  readonly inputAlertCount: number;
  readonly inputSnapshotCount: number;
  readonly inputOutcomeCount: number;
  readonly unmatchedSnapshots: number;
  readonly missingSnapshots: number;
  readonly unmatchedOutcomes: number;
  readonly ignoredOtherHorizonOutcomes: number;
  readonly discoveryRows: number;
  readonly finalHoldoutRows: number;
  readonly targetHorizonMinutes: number;
  readonly roundTripCostPercent: number;
  readonly synthetic: boolean;
  readonly discoveryBaseline: AlphaBootstrapEstimate;
  readonly finalHoldoutBaseline: AlphaBootstrapEstimate;
  readonly discoveryBayesianBootstrap: AlphaBayesianBootstrapEstimate;
  readonly finalHoldoutBayesianBootstrap: AlphaBayesianBootstrapEstimate;
  readonly discoveryMonteCarlo: AlphaMonteCarloEstimate;
  readonly finalHoldoutMonteCarlo: AlphaMonteCarloEstimate;
  readonly discoveryModelCalibration: AlphaRegressionCalibration;
  readonly finalHoldoutModelCalibration: AlphaRegressionCalibration;
  readonly folds: readonly AlphaWalkForwardFoldSummary[];
  readonly featureRanking: readonly AlphaFeatureRankingEntry[];
  readonly interactions: readonly AlphaFeatureInteractionEntry[];
  readonly highCorrelations: readonly AlphaFeatureCorrelationEntry[];
  readonly featureDrift: readonly AlphaFeatureDriftEntry[];
  readonly productionFeaturesEnabled: readonly AlphaFeatureName[];
  readonly notes: readonly string[];
  readonly liveOrderExecutionAllowed: false;
}
