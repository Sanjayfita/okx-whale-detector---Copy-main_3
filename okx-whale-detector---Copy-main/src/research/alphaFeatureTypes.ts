import type { AlertOutcomeObservation } from './alertOutcomeObservation';
import type { QualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

export const ALPHA_FEATURE_NAMES = Object.freeze([
  'ema_fast_distance_directional_percent',
  'ema_medium_distance_directional_percent',
  'ema_slow_distance_directional_percent',
  'ema_fast_medium_spread_directional_percent',
  'ema_medium_slow_spread_directional_percent',
  'ema_fast_slope_directional_percent',
  'ema_medium_slope_directional_percent',
  'ema_alignment_directional',
  'ema_multi_timeframe_alignment_directional',
  'return_short_directional_percent',
  'return_long_directional_percent',
  'market_structure_directional',
  'break_of_structure_directional',
  'change_of_character_directional',
  'range_position_directional',
  'equal_high_distance_percent',
  'equal_low_distance_percent',
  'liquidity_sweep_directional',
  'swing_failure_directional',
  'fvg_directional',
  'order_block_directional',
  'cvd_notional_log_directional',
  'cvd_ratio_directional',
  'trade_count_log',
  'book_imbalance_l1_directional',
  'book_imbalance_depth_directional',
  'microprice_offset_directional_bps',
  'spread_bps',
  'atr_percent',
  'realized_volatility_percent',
  'volatility_compression_ratio',
  'relative_volume',
  'volume_zscore',
  'vwap_distance_directional_percent',
  'anchored_vwap_distance_directional_percent',
  'adx',
  'dmi_directional',
  'rsi_directional',
  'macd_histogram_directional_percent',
  'macd_slope_directional_percent',
  'session_asia',
  'session_london',
  'session_new_york',
  'trend_efficiency_ratio',
  'wall_persistence_seconds',
  'refill_count',
  'spoof_probability',
  'absorption_score',
  'execution_ratio',
  'whale_notional_log',
] as const);

export type AlphaFeatureName = (typeof ALPHA_FEATURE_NAMES)[number];
export type AlphaFeatureValueMap = Readonly<
  Record<AlphaFeatureName, number | null>
>;

export interface AlphaResearchCandle {
  readonly intervalStart: number;
  readonly intervalEnd: number;
  readonly availabilityTimestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface AlphaResearchOrderBookLevel {
  readonly price: number;
  readonly size: number;
}

export interface AlphaResearchOrderBookSnapshot {
  readonly eventTimestamp: number;
  readonly availabilityTimestamp: number;
  readonly bids: readonly AlphaResearchOrderBookLevel[];
  readonly asks: readonly AlphaResearchOrderBookLevel[];
}

export interface AlphaResearchTrade {
  readonly tradeId: string;
  readonly eventTimestamp: number;
  readonly availabilityTimestamp: number;
  readonly side: 'BUY' | 'SELL';
  readonly price: number;
  readonly size: number;
  readonly notionalQuote: number;
}

export interface AlphaWhaleFeatureContext {
  readonly availabilityTimestamp: number;
  readonly wallPersistenceMs: number | null;
  readonly refillCount: number | null;
  readonly spoofProbability: number | null;
  readonly absorptionScore: number | null;
  readonly executionRatio: number | null;
  readonly whaleNotionalQuote: number | null;
}

export interface AlphaMarketContextSnapshot {
  readonly instrumentId: string;
  readonly detectedAt: number;
  readonly candles: readonly AlphaResearchCandle[];
  readonly orderBook: AlphaResearchOrderBookSnapshot;
  readonly trades: readonly AlphaResearchTrade[];
  readonly whale: AlphaWhaleFeatureContext;
}

export const ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const ALPHA_CAPTURED_FEATURE_VALUES_SCHEMA_VERSION = 1 as const;

export interface AlphaCapturedFeatureValues {
  readonly schemaVersion: typeof ALPHA_CAPTURED_FEATURE_VALUES_SCHEMA_VERSION;
  readonly configurationFingerprint: string;
  readonly featureRegistryVersion: 'alpha-feature-registry-v1';
  readonly values: AlphaFeatureValueMap;
  readonly enabledFeatureCount: number;
  readonly availableFeatureCount: number;
  readonly missingFeatureCount: number;
}

export interface AlphaResearchEventSnapshot {
  readonly schemaVersion: typeof ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION;
  readonly evidence: QualifiedAlertEvidenceRecord;
  readonly candles: readonly AlphaResearchCandle[];
  readonly orderBook: AlphaResearchOrderBookSnapshot | null;
  readonly trades: readonly AlphaResearchTrade[];
  readonly whale: AlphaWhaleFeatureContext;
  /** Present on newly persisted evidence; absent only on legacy snapshots. */
  readonly capturedFeatures?: AlphaCapturedFeatureValues;
  readonly synthetic: boolean;
  readonly liveOrderExecutionAllowed: false;
}

export interface AlphaFeatureVector {
  readonly alertId: string;
  readonly instrumentId: string;
  readonly detectedAt: number;
  readonly direction: QualifiedAlertEvidenceRecord['direction'];
  readonly values: AlphaFeatureValueMap;
  readonly availableFeatureCount: number;
  readonly missingFeatureCount: number;
  readonly synthetic: boolean;
}

export interface AlphaResearchDatasetRow {
  readonly evaluationId: string;
  readonly alertId: string;
  readonly instrumentId: string;
  readonly detectedAt: number;
  readonly direction: QualifiedAlertEvidenceRecord['direction'];
  readonly outcomeObservedAt: number;
  readonly horizonMinutes: AlertOutcomeObservation['horizonMinutes'];
  readonly grossReturnPercent: number;
  readonly netReturnPercent: number;
  readonly features: AlphaFeatureValueMap;
  readonly synthetic: boolean;
}

export interface AlphaResearchDataset {
  readonly evaluationId: string;
  readonly targetHorizonMinutes: AlertOutcomeObservation['horizonMinutes'];
  readonly roundTripCostPercent: number;
  readonly rows: readonly AlphaResearchDatasetRow[];
  readonly inputAlertCount: number;
  readonly inputSnapshotCount: number;
  readonly inputOutcomeCount: number;
  readonly unmatchedSnapshots: number;
  readonly missingSnapshots: number;
  readonly unmatchedOutcomes: number;
  readonly ignoredOtherHorizonOutcomes: number;
  readonly synthetic: boolean;
  readonly liveOrderExecutionAllowed: false;
}

export interface AlphaSessionWindow {
  readonly startMinuteUtc: number;
  readonly endMinuteUtc: number;
}

export interface AlphaFeatureExtractionConfig {
  readonly enabledFeatures: readonly AlphaFeatureName[];
  readonly emaFastPeriod: number;
  readonly emaMediumPeriod: number;
  readonly emaSlowPeriod: number;
  readonly higherTimeframeMultiplier: number;
  readonly emaSlopeLookback: number;
  readonly returnShortLookback: number;
  readonly returnLongLookback: number;
  readonly swingLookback: number;
  readonly structureLookback: number;
  readonly equalLevelLookback: number;
  readonly equalLevelTolerancePercent: number;
  readonly fvgLookback: number;
  readonly fvgMinimumGapPercent: number;
  readonly orderBlockLookback: number;
  readonly maximumCandleAgeMs: number;
  readonly tradeLookbackMs: number;
  readonly maximumOrderBookAgeMs: number;
  readonly orderBookDepthLevels: number;
  readonly atrPeriod: number;
  readonly realizedVolatilityPeriod: number;
  readonly volatilityShortPeriod: number;
  readonly volatilityLongPeriod: number;
  readonly volumePeriod: number;
  readonly vwapPeriod: number;
  readonly anchoredVwapPeriod: number;
  readonly adxPeriod: number;
  readonly rsiPeriod: number;
  readonly macdFastPeriod: number;
  readonly macdSlowPeriod: number;
  readonly macdSignalPeriod: number;
  readonly macdSlopeLookback: number;
  readonly trendEfficiencyPeriod: number;
  readonly asiaSession: AlphaSessionWindow;
  readonly londonSession: AlphaSessionWindow;
  readonly newYorkSession: AlphaSessionWindow;
}

export interface AlphaRankingWeights {
  readonly informationCoefficient: number;
  readonly mutualInformation: number;
  readonly permutationImportance: number;
  readonly linearShap: number;
  readonly conditionalEffect: number;
}

export interface AlphaResearchAnalysisConfig {
  readonly targetHorizonMinutes: AlertOutcomeObservation['horizonMinutes'];
  readonly roundTripCostPercent: number;
  readonly foldCount: number;
  readonly holdoutFraction: number;
  readonly purgeMs: number;
  readonly embargoMs: number;
  readonly episodeWindowMs: number;
  readonly minimumTrainingRows: number;
  readonly minimumFeatureSamples: number;
  readonly minimumIndependentEpisodes: number;
  readonly minimumInstruments: number;
  readonly minimumInstrumentSamples: number;
  readonly minimumPositiveInstrumentFraction: number;
  readonly minimumHoldoutSamples: number;
  readonly minimumHoldoutEpisodes: number;
  readonly conditionalQuantile: number;
  readonly bootstrapIterations: number;
  readonly bayesianBootstrapIterations: number;
  readonly monteCarloIterations: number;
  readonly confidenceLevel: number;
  readonly statisticalPower: number;
  readonly trimmedMeanFraction: number;
  readonly minimumDriftSamples: number;
  readonly driftBins: number;
  readonly moderateDriftPsi: number;
  readonly materialDriftPsi: number;
  readonly partialDependenceGridPoints: number;
  readonly partialDependenceLowerQuantile: number;
  readonly partialDependenceUpperQuantile: number;
  readonly calibrationBins: number;
  readonly minimumCalibrationSamples: number;
  readonly mutualInformationBins: number;
  readonly permutationRepeats: number;
  readonly ridgeLambda: number;
  readonly falseDiscoveryRate: number;
  readonly minimumPositiveFoldFraction: number;
  readonly maximumInteractionFeatures: number;
  readonly neutralEffectPercent: number;
  readonly correlationThreshold: number;
  readonly randomSeed: number;
  readonly rankingWeights: AlphaRankingWeights;
}

export interface AlphaResearchConfig {
  readonly extraction: AlphaFeatureExtractionConfig;
  readonly analysis: AlphaResearchAnalysisConfig;
}
