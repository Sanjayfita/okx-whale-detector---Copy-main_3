import {
  ALPHA_FEATURE_NAMES,
  type AlphaFeatureExtractionConfig,
  type AlphaFeatureName,
  type AlphaRankingWeights,
  type AlphaResearchAnalysisConfig,
  type AlphaResearchConfig,
  type AlphaSessionWindow,
} from './alphaFeatureTypes';
import { isAlertOutcomeHorizonMinutes } from './alertOutcomeObservation';
import { ALPHA_FEATURE_REGISTRY } from './alphaFeatureRegistry';

const positiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
};

const nonNegativeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const finiteInRange = (
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): void => {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
};

const validateSession = (session: AlphaSessionWindow, name: string): void => {
  nonNegativeInteger(session.startMinuteUtc, `${name}.startMinuteUtc`);
  positiveInteger(session.endMinuteUtc, `${name}.endMinuteUtc`);
  if (session.startMinuteUtc >= 1_440 || session.endMinuteUtc > 1_440) {
    throw new Error(`${name} must use UTC minutes within one day`);
  }
  if (session.startMinuteUtc === session.endMinuteUtc) {
    throw new Error(`${name} must not cover an empty session`);
  }
};

const validateEnabledFeatures = (
  features: readonly AlphaFeatureName[],
): void => {
  if (features.length === 0) {
    throw new Error('At least one alpha feature must be enabled');
  }
  const allowed = new Set<AlphaFeatureName>(
    ALPHA_FEATURE_REGISTRY.map((definition) => definition.name),
  );
  const seen = new Set<AlphaFeatureName>();
  for (const feature of features) {
    if (!allowed.has(feature) || seen.has(feature)) {
      throw new Error(`Invalid or duplicate alpha feature: ${feature}`);
    }
    seen.add(feature);
  }
};

const validateRankingWeights = (weights: AlphaRankingWeights): void => {
  const values = Object.values(weights);
  for (const value of values) {
    finiteInRange(value, 0, 1, 'ranking weight');
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 1e-12) {
    throw new Error('Alpha ranking weights must total exactly 1');
  }
};

export const DEFAULT_ALPHA_FEATURE_EXTRACTION_CONFIG = Object.freeze({
  enabledFeatures: ALPHA_FEATURE_NAMES,
  emaFastPeriod: 20,
  emaMediumPeriod: 50,
  emaSlowPeriod: 200,
  higherTimeframeMultiplier: 5,
  emaSlopeLookback: 5,
  returnShortLookback: 5,
  returnLongLookback: 20,
  swingLookback: 5,
  structureLookback: 20,
  equalLevelLookback: 20,
  equalLevelTolerancePercent: 0.05,
  fvgLookback: 20,
  fvgMinimumGapPercent: 0.02,
  orderBlockLookback: 20,
  maximumCandleAgeMs: 120_000,
  tradeLookbackMs: 60_000,
  maximumOrderBookAgeMs: 5_000,
  orderBookDepthLevels: 5,
  atrPeriod: 14,
  realizedVolatilityPeriod: 20,
  volatilityShortPeriod: 10,
  volatilityLongPeriod: 50,
  volumePeriod: 20,
  vwapPeriod: 20,
  anchoredVwapPeriod: 50,
  adxPeriod: 14,
  rsiPeriod: 14,
  macdFastPeriod: 12,
  macdSlowPeriod: 26,
  macdSignalPeriod: 9,
  macdSlopeLookback: 3,
  trendEfficiencyPeriod: 20,
  asiaSession: Object.freeze({ startMinuteUtc: 0, endMinuteUtc: 480 }),
  londonSession: Object.freeze({ startMinuteUtc: 420, endMinuteUtc: 960 }),
  newYorkSession: Object.freeze({ startMinuteUtc: 780, endMinuteUtc: 1_320 }),
} satisfies AlphaFeatureExtractionConfig);

export const DEFAULT_ALPHA_RESEARCH_ANALYSIS_CONFIG = Object.freeze({
  targetHorizonMinutes: 15,
  roundTripCostPercent: 0.2,
  foldCount: 5,
  holdoutFraction: 0.2,
  purgeMs: 60 * 60_000,
  embargoMs: 15 * 60_000,
  episodeWindowMs: 60 * 60_000,
  minimumTrainingRows: 100,
  minimumFeatureSamples: 40,
  minimumIndependentEpisodes: 30,
  minimumInstruments: 2,
  minimumInstrumentSamples: 10,
  minimumPositiveInstrumentFraction: 0.6,
  minimumHoldoutSamples: 30,
  minimumHoldoutEpisodes: 20,
  conditionalQuantile: 0.25,
  bootstrapIterations: 2_000,
  bayesianBootstrapIterations: 2_000,
  monteCarloIterations: 2_000,
  confidenceLevel: 0.95,
  statisticalPower: 0.8,
  trimmedMeanFraction: 0.1,
  minimumDriftSamples: 30,
  driftBins: 10,
  moderateDriftPsi: 0.1,
  materialDriftPsi: 0.25,
  partialDependenceGridPoints: 5,
  partialDependenceLowerQuantile: 0.05,
  partialDependenceUpperQuantile: 0.95,
  calibrationBins: 10,
  minimumCalibrationSamples: 30,
  mutualInformationBins: 5,
  permutationRepeats: 10,
  ridgeLambda: 1,
  falseDiscoveryRate: 0.05,
  minimumPositiveFoldFraction: 0.6,
  maximumInteractionFeatures: 10,
  neutralEffectPercent: 0.02,
  correlationThreshold: 0.8,
  randomSeed: 0x51a7e,
  rankingWeights: Object.freeze({
    informationCoefficient: 0.25,
    mutualInformation: 0.15,
    permutationImportance: 0.2,
    linearShap: 0.1,
    conditionalEffect: 0.3,
  }),
} satisfies AlphaResearchAnalysisConfig);

export const validateAlphaFeatureExtractionConfig = (
  config: AlphaFeatureExtractionConfig,
): void => {
  validateEnabledFeatures(config.enabledFeatures);
  const periods = [
    ['emaFastPeriod', config.emaFastPeriod],
    ['emaMediumPeriod', config.emaMediumPeriod],
    ['emaSlowPeriod', config.emaSlowPeriod],
    ['higherTimeframeMultiplier', config.higherTimeframeMultiplier],
    ['emaSlopeLookback', config.emaSlopeLookback],
    ['returnShortLookback', config.returnShortLookback],
    ['returnLongLookback', config.returnLongLookback],
    ['swingLookback', config.swingLookback],
    ['structureLookback', config.structureLookback],
    ['equalLevelLookback', config.equalLevelLookback],
    ['fvgLookback', config.fvgLookback],
    ['orderBlockLookback', config.orderBlockLookback],
    ['maximumCandleAgeMs', config.maximumCandleAgeMs],
    ['tradeLookbackMs', config.tradeLookbackMs],
    ['maximumOrderBookAgeMs', config.maximumOrderBookAgeMs],
    ['orderBookDepthLevels', config.orderBookDepthLevels],
    ['atrPeriod', config.atrPeriod],
    ['realizedVolatilityPeriod', config.realizedVolatilityPeriod],
    ['volatilityShortPeriod', config.volatilityShortPeriod],
    ['volatilityLongPeriod', config.volatilityLongPeriod],
    ['volumePeriod', config.volumePeriod],
    ['vwapPeriod', config.vwapPeriod],
    ['anchoredVwapPeriod', config.anchoredVwapPeriod],
    ['adxPeriod', config.adxPeriod],
    ['rsiPeriod', config.rsiPeriod],
    ['macdFastPeriod', config.macdFastPeriod],
    ['macdSlowPeriod', config.macdSlowPeriod],
    ['macdSignalPeriod', config.macdSignalPeriod],
    ['macdSlopeLookback', config.macdSlopeLookback],
    ['trendEfficiencyPeriod', config.trendEfficiencyPeriod],
  ] as const;
  for (const [name, value] of periods) {
    positiveInteger(value, name);
  }
  if (
    config.emaFastPeriod >= config.emaMediumPeriod ||
    config.emaMediumPeriod >= config.emaSlowPeriod
  ) {
    throw new Error('EMA periods must be strictly increasing');
  }
  if (config.macdFastPeriod >= config.macdSlowPeriod) {
    throw new Error('MACD fast period must be lower than its slow period');
  }
  if (config.volatilityShortPeriod >= config.volatilityLongPeriod) {
    throw new Error(
      'Volatility short period must be lower than its long period',
    );
  }
  finiteInRange(
    config.equalLevelTolerancePercent,
    0,
    100,
    'equalLevelTolerancePercent',
  );
  finiteInRange(config.fvgMinimumGapPercent, 0, 100, 'fvgMinimumGapPercent');
  validateSession(config.asiaSession, 'asiaSession');
  validateSession(config.londonSession, 'londonSession');
  validateSession(config.newYorkSession, 'newYorkSession');
};

export const validateAlphaResearchAnalysisConfig = (
  config: AlphaResearchAnalysisConfig,
): void => {
  if (!isAlertOutcomeHorizonMinutes(config.targetHorizonMinutes)) {
    throw new Error('targetHorizonMinutes is not supported');
  }
  finiteInRange(config.roundTripCostPercent, 0, 100, 'roundTripCostPercent');
  positiveInteger(config.foldCount, 'foldCount');
  if (config.foldCount < 2) {
    throw new Error('foldCount must be at least 2');
  }
  finiteInRange(
    config.holdoutFraction,
    Number.EPSILON,
    0.49,
    'holdoutFraction',
  );
  nonNegativeInteger(config.purgeMs, 'purgeMs');
  nonNegativeInteger(config.embargoMs, 'embargoMs');
  positiveInteger(config.episodeWindowMs, 'episodeWindowMs');
  positiveInteger(config.minimumTrainingRows, 'minimumTrainingRows');
  positiveInteger(config.minimumFeatureSamples, 'minimumFeatureSamples');
  positiveInteger(
    config.minimumIndependentEpisodes,
    'minimumIndependentEpisodes',
  );
  positiveInteger(config.minimumInstruments, 'minimumInstruments');
  positiveInteger(config.minimumInstrumentSamples, 'minimumInstrumentSamples');
  finiteInRange(
    config.minimumPositiveInstrumentFraction,
    0.5,
    1,
    'minimumPositiveInstrumentFraction',
  );
  positiveInteger(config.minimumHoldoutSamples, 'minimumHoldoutSamples');
  positiveInteger(config.minimumHoldoutEpisodes, 'minimumHoldoutEpisodes');
  finiteInRange(config.conditionalQuantile, 0.05, 0.5, 'conditionalQuantile');
  if (
    !Number.isSafeInteger(config.bootstrapIterations) ||
    config.bootstrapIterations < 100 ||
    config.bootstrapIterations > 1_000_000
  ) {
    throw new Error('bootstrapIterations must be between 100 and 1,000,000');
  }
  if (
    !Number.isSafeInteger(config.monteCarloIterations) ||
    config.monteCarloIterations < 100 ||
    config.monteCarloIterations > 1_000_000
  ) {
    throw new Error('monteCarloIterations must be between 100 and 1,000,000');
  }
  if (
    !Number.isSafeInteger(config.bayesianBootstrapIterations) ||
    config.bayesianBootstrapIterations < 100 ||
    config.bayesianBootstrapIterations > 1_000_000
  ) {
    throw new Error(
      'bayesianBootstrapIterations must be between 100 and 1,000,000',
    );
  }
  finiteInRange(
    config.confidenceLevel,
    0.500_001,
    0.999_999,
    'confidenceLevel',
  );
  finiteInRange(
    config.statisticalPower,
    0.500_001,
    0.999_999,
    'statisticalPower',
  );
  finiteInRange(config.trimmedMeanFraction, 0, 0.49, 'trimmedMeanFraction');
  positiveInteger(config.minimumDriftSamples, 'minimumDriftSamples');
  if (
    !Number.isSafeInteger(config.driftBins) ||
    config.driftBins < 2 ||
    config.driftBins > 100
  ) {
    throw new Error('driftBins must be between 2 and 100');
  }
  finiteInRange(config.moderateDriftPsi, 0, 100, 'moderateDriftPsi');
  finiteInRange(config.materialDriftPsi, 0, 100, 'materialDriftPsi');
  if (config.materialDriftPsi <= config.moderateDriftPsi) {
    throw new Error('materialDriftPsi must be greater than moderateDriftPsi');
  }
  if (
    !Number.isSafeInteger(config.partialDependenceGridPoints) ||
    config.partialDependenceGridPoints < 2 ||
    config.partialDependenceGridPoints > 100
  ) {
    throw new Error('partialDependenceGridPoints must be between 2 and 100');
  }
  finiteInRange(
    config.partialDependenceLowerQuantile,
    0,
    0.49,
    'partialDependenceLowerQuantile',
  );
  finiteInRange(
    config.partialDependenceUpperQuantile,
    0.51,
    1,
    'partialDependenceUpperQuantile',
  );
  if (
    config.partialDependenceUpperQuantile <=
    config.partialDependenceLowerQuantile
  ) {
    throw new Error(
      'partialDependenceUpperQuantile must exceed its lower quantile',
    );
  }
  if (
    !Number.isSafeInteger(config.calibrationBins) ||
    config.calibrationBins < 2 ||
    config.calibrationBins > 100
  ) {
    throw new Error('calibrationBins must be between 2 and 100');
  }
  positiveInteger(
    config.minimumCalibrationSamples,
    'minimumCalibrationSamples',
  );
  if (
    !Number.isSafeInteger(config.mutualInformationBins) ||
    config.mutualInformationBins < 2 ||
    config.mutualInformationBins > 20
  ) {
    throw new Error('mutualInformationBins must be between 2 and 20');
  }
  if (
    !Number.isSafeInteger(config.permutationRepeats) ||
    config.permutationRepeats < 1 ||
    config.permutationRepeats > 1_000
  ) {
    throw new Error('permutationRepeats must be between 1 and 1,000');
  }
  finiteInRange(config.ridgeLambda, Number.EPSILON, 1_000_000, 'ridgeLambda');
  finiteInRange(
    config.falseDiscoveryRate,
    Number.EPSILON,
    0.5,
    'falseDiscoveryRate',
  );
  finiteInRange(
    config.minimumPositiveFoldFraction,
    0.5,
    1,
    'minimumPositiveFoldFraction',
  );
  positiveInteger(
    config.maximumInteractionFeatures,
    'maximumInteractionFeatures',
  );
  finiteInRange(config.neutralEffectPercent, 0, 100, 'neutralEffectPercent');
  finiteInRange(config.correlationThreshold, 0, 1, 'correlationThreshold');
  nonNegativeInteger(config.randomSeed, 'randomSeed');
  if (config.randomSeed > 0xffff_ffff) {
    throw new Error('randomSeed must be an unsigned 32-bit integer');
  }
  validateRankingWeights(config.rankingWeights);
};

export const createAlphaResearchConfig = (
  input: {
    readonly extraction?: Partial<AlphaFeatureExtractionConfig>;
    readonly analysis?: Partial<AlphaResearchAnalysisConfig>;
  } = {},
): AlphaResearchConfig => {
  const extraction: AlphaFeatureExtractionConfig = Object.freeze({
    ...DEFAULT_ALPHA_FEATURE_EXTRACTION_CONFIG,
    ...input.extraction,
    enabledFeatures: Object.freeze([
      ...(input.extraction?.enabledFeatures ??
        DEFAULT_ALPHA_FEATURE_EXTRACTION_CONFIG.enabledFeatures),
    ]),
    asiaSession: Object.freeze({
      ...DEFAULT_ALPHA_FEATURE_EXTRACTION_CONFIG.asiaSession,
      ...input.extraction?.asiaSession,
    }),
    londonSession: Object.freeze({
      ...DEFAULT_ALPHA_FEATURE_EXTRACTION_CONFIG.londonSession,
      ...input.extraction?.londonSession,
    }),
    newYorkSession: Object.freeze({
      ...DEFAULT_ALPHA_FEATURE_EXTRACTION_CONFIG.newYorkSession,
      ...input.extraction?.newYorkSession,
    }),
  });
  const analysis: AlphaResearchAnalysisConfig = Object.freeze({
    ...DEFAULT_ALPHA_RESEARCH_ANALYSIS_CONFIG,
    ...input.analysis,
    rankingWeights: Object.freeze({
      ...DEFAULT_ALPHA_RESEARCH_ANALYSIS_CONFIG.rankingWeights,
      ...input.analysis?.rankingWeights,
    }),
  });
  validateAlphaFeatureExtractionConfig(extraction);
  validateAlphaResearchAnalysisConfig(analysis);
  return Object.freeze({ extraction, analysis });
};
