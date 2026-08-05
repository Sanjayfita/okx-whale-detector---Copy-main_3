import type {
  AlphaResearchCandle,
  AlphaResearchEventSnapshot,
  AlphaResearchOrderBookLevel,
  AlphaResearchOrderBookSnapshot,
  AlphaResearchTrade,
  AlphaCapturedFeatureValues,
  AlphaFeatureValueMap,
  AlphaWhaleFeatureContext,
} from './alphaFeatureTypes';
import {
  ALPHA_CAPTURED_FEATURE_VALUES_SCHEMA_VERSION,
  ALPHA_FEATURE_NAMES,
  ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
} from './alphaFeatureTypes';
import { parseQualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const numberOrNull = (value: unknown): value is number | null =>
  value === null || typeof value === 'number';

const isFeatureValueMap = (value: unknown): value is AlphaFeatureValueMap => {
  if (!isRecord(value)) return false;
  const names = new Set<string>(ALPHA_FEATURE_NAMES);
  const keys = Object.keys(value);
  return (
    keys.length === ALPHA_FEATURE_NAMES.length &&
    keys.every((key) => names.has(key)) &&
    ALPHA_FEATURE_NAMES.every((name) => {
      const featureValue = value[name];
      return (
        featureValue === null ||
        (typeof featureValue === 'number' && Number.isFinite(featureValue))
      );
    })
  );
};

const parseCapturedFeatures = (
  value: unknown,
): AlphaCapturedFeatureValues | undefined => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== ALPHA_CAPTURED_FEATURE_VALUES_SCHEMA_VERSION ||
    typeof value.configurationFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.configurationFingerprint) ||
    value.featureRegistryVersion !== 'alpha-feature-registry-v1' ||
    !isFeatureValueMap(value.values) ||
    typeof value.enabledFeatureCount !== 'number' ||
    !Number.isSafeInteger(value.enabledFeatureCount) ||
    value.enabledFeatureCount <= 0 ||
    value.enabledFeatureCount > ALPHA_FEATURE_NAMES.length ||
    typeof value.availableFeatureCount !== 'number' ||
    !Number.isSafeInteger(value.availableFeatureCount) ||
    value.availableFeatureCount < 0 ||
    typeof value.missingFeatureCount !== 'number' ||
    !Number.isSafeInteger(value.missingFeatureCount) ||
    value.missingFeatureCount < 0 ||
    value.availableFeatureCount + value.missingFeatureCount !==
      value.enabledFeatureCount
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: ALPHA_CAPTURED_FEATURE_VALUES_SCHEMA_VERSION,
    configurationFingerprint: value.configurationFingerprint,
    featureRegistryVersion: 'alpha-feature-registry-v1',
    values: Object.freeze({ ...value.values }),
    enabledFeatureCount: value.enabledFeatureCount,
    availableFeatureCount: value.availableFeatureCount,
    missingFeatureCount: value.missingFeatureCount,
  });
};

const parseCandle = (value: unknown): AlphaResearchCandle | undefined => {
  if (
    !isRecord(value) ||
    typeof value.intervalStart !== 'number' ||
    typeof value.intervalEnd !== 'number' ||
    typeof value.availabilityTimestamp !== 'number' ||
    typeof value.open !== 'number' ||
    typeof value.high !== 'number' ||
    typeof value.low !== 'number' ||
    typeof value.close !== 'number' ||
    typeof value.volume !== 'number'
  ) {
    return undefined;
  }
  return Object.freeze({
    intervalStart: value.intervalStart,
    intervalEnd: value.intervalEnd,
    availabilityTimestamp: value.availabilityTimestamp,
    open: value.open,
    high: value.high,
    low: value.low,
    close: value.close,
    volume: value.volume,
  });
};

const parseLevel = (
  value: unknown,
): AlphaResearchOrderBookLevel | undefined => {
  if (
    !isRecord(value) ||
    typeof value.price !== 'number' ||
    typeof value.size !== 'number'
  ) {
    return undefined;
  }
  return Object.freeze({ price: value.price, size: value.size });
};

const parseBook = (
  value: unknown,
): AlphaResearchOrderBookSnapshot | null | undefined => {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.eventTimestamp !== 'number' ||
    typeof value.availabilityTimestamp !== 'number' ||
    !Array.isArray(value.bids) ||
    !Array.isArray(value.asks)
  ) {
    return undefined;
  }
  const bids = value.bids.map(parseLevel);
  const asks = value.asks.map(parseLevel);
  if (
    bids.some((level) => level === undefined) ||
    asks.some((level) => level === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    eventTimestamp: value.eventTimestamp,
    availabilityTimestamp: value.availabilityTimestamp,
    bids: Object.freeze(
      bids.filter(
        (level): level is AlphaResearchOrderBookLevel => level !== undefined,
      ),
    ),
    asks: Object.freeze(
      asks.filter(
        (level): level is AlphaResearchOrderBookLevel => level !== undefined,
      ),
    ),
  });
};

const parseTrade = (value: unknown): AlphaResearchTrade | undefined => {
  if (
    !isRecord(value) ||
    typeof value.tradeId !== 'string' ||
    typeof value.eventTimestamp !== 'number' ||
    typeof value.availabilityTimestamp !== 'number' ||
    (value.side !== 'BUY' && value.side !== 'SELL') ||
    typeof value.price !== 'number' ||
    typeof value.size !== 'number' ||
    typeof value.notionalQuote !== 'number'
  ) {
    return undefined;
  }
  return Object.freeze({
    tradeId: value.tradeId,
    eventTimestamp: value.eventTimestamp,
    availabilityTimestamp: value.availabilityTimestamp,
    side: value.side,
    price: value.price,
    size: value.size,
    notionalQuote: value.notionalQuote,
  });
};

const parseWhale = (value: unknown): AlphaWhaleFeatureContext | undefined => {
  if (
    !isRecord(value) ||
    typeof value.availabilityTimestamp !== 'number' ||
    !numberOrNull(value.wallPersistenceMs) ||
    !numberOrNull(value.refillCount) ||
    !numberOrNull(value.spoofProbability) ||
    !numberOrNull(value.absorptionScore) ||
    !numberOrNull(value.executionRatio) ||
    !numberOrNull(value.whaleNotionalQuote)
  ) {
    return undefined;
  }
  return Object.freeze({
    availabilityTimestamp: value.availabilityTimestamp,
    wallPersistenceMs: value.wallPersistenceMs,
    refillCount: value.refillCount,
    spoofProbability: value.spoofProbability,
    absorptionScore: value.absorptionScore,
    executionRatio: value.executionRatio,
    whaleNotionalQuote: value.whaleNotionalQuote,
  });
};

export const parseAlphaResearchEventSnapshot = (
  value: unknown,
): AlphaResearchEventSnapshot | undefined => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION ||
    value.liveOrderExecutionAllowed !== false ||
    !Array.isArray(value.candles) ||
    !Array.isArray(value.trades) ||
    typeof value.synthetic !== 'boolean'
  ) {
    return undefined;
  }
  const evidence = parseQualifiedAlertEvidenceRecord(value.evidence);
  const candles = value.candles.map(parseCandle);
  const orderBook = parseBook(value.orderBook);
  const trades = value.trades.map(parseTrade);
  const whale = parseWhale(value.whale);
  const capturedFeatures =
    value.capturedFeatures === undefined
      ? undefined
      : parseCapturedFeatures(value.capturedFeatures);
  if (
    evidence === undefined ||
    candles.some((candle) => candle === undefined) ||
    orderBook === undefined ||
    trades.some((trade) => trade === undefined) ||
    whale === undefined ||
    (value.capturedFeatures !== undefined && capturedFeatures === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
    evidence,
    candles: Object.freeze(
      candles.filter(
        (candle): candle is AlphaResearchCandle => candle !== undefined,
      ),
    ),
    orderBook,
    trades: Object.freeze(
      trades.filter(
        (trade): trade is AlphaResearchTrade => trade !== undefined,
      ),
    ),
    whale,
    ...(capturedFeatures === undefined ? {} : { capturedFeatures }),
    synthetic: value.synthetic,
    liveOrderExecutionAllowed: false,
  });
};
