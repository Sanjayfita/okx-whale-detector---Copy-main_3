import type {
  CandleRecord,
  FundingRateRecord,
  HistoricalTradeRecord,
  MarkIndexRecord,
  OpenInterestRecord,
  OrderBookSnapshotRecord,
} from '../data/ResearchMarketData';
import {
  requirePointInTimeSelection,
  selectPointInTimeRecords,
  type PointInTimeSelectionQuality,
} from '../data/PointInTimeRecords';

export type MarketRegime =
  | 'TRENDING_HIGH_VOLATILITY'
  | 'TRENDING_LOW_VOLATILITY'
  | 'RANGE_HIGH_VOLATILITY'
  | 'RANGE_LOW_VOLATILITY';

export interface FeaturePipelinePolicy {
  readonly depthLevels: number;
  readonly trendEfficiencyThreshold: number;
  readonly highVolatilityThresholdPercent: number;
  readonly tradeLookbackMs: number;
  readonly bookLookbackMs: number;
  readonly candleLookbackMs: number;
  readonly fundingLookbackMs: number;
  readonly openInterestLookbackMs: number;
  readonly markIndexLookbackMs: number;
  readonly maximumTradeAgeMs: number;
  readonly maximumBookAgeMs: number;
  readonly maximumCandleAgeMs: number;
  readonly maximumFundingAgeMs: number;
  readonly maximumOpenInterestAgeMs: number;
  readonly maximumMarkIndexAgeMs: number;
}

export interface FeaturePipelineDataQuality {
  readonly status: 'PASSED';
  readonly trades: PointInTimeSelectionQuality;
  readonly books: PointInTimeSelectionQuality;
  readonly candles: PointInTimeSelectionQuality;
  readonly funding: PointInTimeSelectionQuality;
  readonly openInterest: PointInTimeSelectionQuality;
  readonly markIndex: PointInTimeSelectionQuality;
}

export interface ResearchFeatureVector {
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly sourceMaxObservedAt: number;
  readonly sourceMaxReceivedAt: number;
  readonly aggressiveDeltaContracts: number;
  readonly aggressiveDeltaNormalized: number;
  readonly cumulativeVolumeDelta: number;
  readonly orderBookImbalance: number;
  readonly liquidityImbalance: number;
  readonly fundingRate: number;
  readonly fundingAccelerationPerHour: number;
  readonly openInterestMomentumPercent: number;
  readonly basisBps: number;
  readonly atrPercent: number;
  readonly realizedVolatilityPercent: number;
  readonly vwapDeviationAtr: number;
  readonly trendEfficiency: number;
  readonly regime: MarketRegime;
  readonly dataQuality: FeaturePipelineDataQuality;
}

export interface FeaturePipelineInput {
  readonly instrumentId: string;
  readonly asOf: number;
  readonly trades: readonly HistoricalTradeRecord[];
  readonly books: readonly OrderBookSnapshotRecord[];
  readonly candles: readonly CandleRecord[];
  readonly funding: readonly FundingRateRecord[];
  readonly openInterest: readonly OpenInterestRecord[];
  readonly markIndex: readonly MarkIndexRecord[];
  readonly policy?: Partial<FeaturePipelinePolicy>;
}

export const DEFAULT_FEATURE_PIPELINE_POLICY: FeaturePipelinePolicy = {
  depthLevels: 20,
  trendEfficiencyThreshold: 0.35,
  highVolatilityThresholdPercent: 1.5,
  tradeLookbackMs: 15 * 60_000,
  bookLookbackMs: 60_000,
  candleLookbackMs: 24 * 60 * 60_000,
  fundingLookbackMs: 72 * 60 * 60_000,
  openInterestLookbackMs: 24 * 60 * 60_000,
  markIndexLookbackMs: 60_000,
  maximumTradeAgeMs: 5 * 60_000,
  maximumBookAgeMs: 5_000,
  maximumCandleAgeMs: 2 * 60 * 60_000,
  maximumFundingAgeMs: 12 * 60 * 60_000,
  maximumOpenInterestAgeMs: 30 * 60_000,
  maximumMarkIndexAgeMs: 5_000,
};

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1_000;

const requireTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const requireFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
};

const requireNonNegativeInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const validatePolicy = (policy: FeaturePipelinePolicy): void => {
  if (!Number.isSafeInteger(policy.depthLevels) || policy.depthLevels <= 0) {
    throw new Error('depthLevels must be a positive safe integer');
  }
  if (
    !Number.isFinite(policy.trendEfficiencyThreshold) ||
    policy.trendEfficiencyThreshold < 0 ||
    policy.trendEfficiencyThreshold > 1
  ) {
    throw new Error('trendEfficiencyThreshold must be in [0, 1]');
  }
  if (
    !Number.isFinite(policy.highVolatilityThresholdPercent) ||
    policy.highVolatilityThresholdPercent <= 0
  ) {
    throw new Error('highVolatilityThresholdPercent must be positive');
  }
  for (const [name, value] of Object.entries(policy)) {
    if (name.endsWith('Ms')) {
      requireNonNegativeInteger(value, name);
    }
  }
};

const average = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleStandardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) {
    return 0;
  }
  const mean = average(values);
  return Math.sqrt(
    Math.max(
      0,
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (values.length - 1),
    ),
  );
};

const requiredLatest = <T>(records: readonly T[], name: string): T => {
  const value = records[records.length - 1];
  if (value === undefined) {
    throw new Error(`${name} requires at least one record`);
  }
  return value;
};

const requiredFirst = <T>(records: readonly T[], name: string): T => {
  const value = records[0];
  if (value === undefined) {
    throw new Error(`${name} requires at least one record`);
  }
  return value;
};

const aggressiveFlow = (trades: readonly HistoricalTradeRecord[]) => {
  let buys = 0;
  let sells = 0;
  let priceVolume = 0;
  let total = 0;
  for (const trade of trades) {
    if (trade.price <= 0 || trade.contracts <= 0) {
      throw new Error('Trade price and contracts must be positive');
    }
    if (trade.side === 'BUY') {
      buys += trade.contracts;
    } else {
      sells += trade.contracts;
    }
    total += trade.contracts;
    priceVolume += trade.price * trade.contracts;
  }
  const delta = buys - sells;
  return {
    delta,
    normalized: total === 0 ? 0 : delta / total,
    vwap: total === 0 ? 0 : priceVolume / total,
  };
};

const depthFeatures = (
  book: OrderBookSnapshotRecord,
  depthLevels: number,
) => {
  const bids = book.bids.slice(0, depthLevels);
  const asks = book.asks.slice(0, depthLevels);
  const bidContracts = bids.reduce((sum, level) => sum + level.contracts, 0);
  const askContracts = asks.reduce((sum, level) => sum + level.contracts, 0);
  const total = bidContracts + askContracts;
  const weightedBid = bids.reduce(
    (sum, level, index) => sum + level.contracts / (index + 1),
    0,
  );
  const weightedAsk = asks.reduce(
    (sum, level, index) => sum + level.contracts / (index + 1),
    0,
  );
  const weightedTotal = weightedBid + weightedAsk;
  return {
    orderBookImbalance:
      total === 0 ? 0 : (bidContracts - askContracts) / total,
    liquidityImbalance:
      weightedTotal === 0
        ? 0
        : (weightedBid - weightedAsk) / weightedTotal,
  };
};

const atr = (candles: readonly CandleRecord[]): number =>
  average(
    candles.map((candle, index) => {
      const previousClose = candles[index - 1]?.close ?? candle.open;
      return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      );
    }),
  );

const trendEfficiency = (candles: readonly CandleRecord[]): number => {
  if (candles.length < 2) {
    return 0;
  }
  const start = requiredFirst(candles, 'trend efficiency').close;
  const end = requiredLatest(candles, 'trend efficiency').close;
  let path = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (current !== undefined && previous !== undefined) {
      path += Math.abs(current.close - previous.close);
    }
  }
  return path === 0 ? 0 : Math.min(1, Math.abs(end - start) / path);
};

const realizedVolatilityPercent = (
  candles: readonly CandleRecord[],
): number => {
  if (candles.length < 2) {
    return 0;
  }
  const returns: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (current === undefined || previous === undefined) {
      continue;
    }
    if (current.close <= 0 || previous.close <= 0) {
      throw new Error('Candle closes must be positive');
    }
    returns.push(Math.log(current.close / previous.close));
  }
  const intervalMs = requiredLatest(candles, 'realized volatility').intervalMs;
  return intervalMs <= 0
    ? 0
    : sampleStandardDeviation(returns) * Math.sqrt(YEAR_MS / intervalMs) * 100;
};

const fundingAcceleration = (
  funding: readonly FundingRateRecord[],
): number => {
  if (funding.length < 2) {
    return 0;
  }
  const start = requiredFirst(funding, 'funding acceleration');
  const end = requiredLatest(funding, 'funding acceleration');
  const hours = (end.fundingTime - start.fundingTime) / 3_600_000;
  return hours <= 0 ? 0 : (end.fundingRate - start.fundingRate) / hours;
};

const openInterestMomentumPercent = (
  values: readonly OpenInterestRecord[],
): number => {
  if (values.length < 2) {
    return 0;
  }
  const start = requiredFirst(values, 'open interest momentum').contracts;
  const end = requiredLatest(values, 'open interest momentum').contracts;
  return start <= 0 ? 0 : ((end - start) / start) * 100;
};

export const calculateResearchFeatures = (
  input: FeaturePipelineInput,
): ResearchFeatureVector => {
  requireTimestamp(input.asOf, 'asOf');
  if (input.instrumentId.trim().length === 0) {
    throw new Error('instrumentId must not be empty');
  }
  const policy: FeaturePipelinePolicy = {
    ...DEFAULT_FEATURE_PIPELINE_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);

  const tradeSelection = selectPointInTimeRecords({
    sourceName: 'feature pipeline trades',
    instrumentId: input.instrumentId,
    asOf: input.asOf,
    records: input.trades,
    policy: {
      lookbackMs: policy.tradeLookbackMs,
      maximumAgeMs: policy.maximumTradeAgeMs,
      minimumRecords: 1,
    },
  });
  const bookSelection = selectPointInTimeRecords({
    sourceName: 'feature pipeline books',
    instrumentId: input.instrumentId,
    asOf: input.asOf,
    records: input.books,
    policy: {
      lookbackMs: policy.bookLookbackMs,
      maximumAgeMs: policy.maximumBookAgeMs,
      minimumRecords: 1,
    },
  });
  const candleSelection = selectPointInTimeRecords({
    sourceName: 'feature pipeline candles',
    instrumentId: input.instrumentId,
    asOf: input.asOf,
    records: input.candles.filter((candle) => candle.confirmed),
    policy: {
      lookbackMs: policy.candleLookbackMs,
      maximumAgeMs: policy.maximumCandleAgeMs,
      minimumRecords: 1,
    },
  });
  const fundingSelection = selectPointInTimeRecords({
    sourceName: 'feature pipeline funding',
    instrumentId: input.instrumentId,
    asOf: input.asOf,
    records: input.funding.filter((record) => record.fundingTime <= input.asOf),
    policy: {
      lookbackMs: policy.fundingLookbackMs,
      maximumAgeMs: policy.maximumFundingAgeMs,
      minimumRecords: 1,
    },
  });
  const openInterestSelection = selectPointInTimeRecords({
    sourceName: 'feature pipeline open interest',
    instrumentId: input.instrumentId,
    asOf: input.asOf,
    records: input.openInterest,
    policy: {
      lookbackMs: policy.openInterestLookbackMs,
      maximumAgeMs: policy.maximumOpenInterestAgeMs,
      minimumRecords: 1,
    },
  });
  const markIndexSelection = selectPointInTimeRecords({
    sourceName: 'feature pipeline mark/index',
    instrumentId: input.instrumentId,
    asOf: input.asOf,
    records: input.markIndex,
    policy: {
      lookbackMs: policy.markIndexLookbackMs,
      maximumAgeMs: policy.maximumMarkIndexAgeMs,
      minimumRecords: 1,
    },
  });

  const trades = requirePointInTimeSelection(tradeSelection);
  const books = requirePointInTimeSelection(bookSelection);
  const candles = requirePointInTimeSelection(candleSelection);
  const funding = requirePointInTimeSelection(fundingSelection);
  const openInterest = requirePointInTimeSelection(openInterestSelection);
  const markIndex = requirePointInTimeSelection(markIndexSelection);

  const currentBook = requiredLatest(books, 'feature pipeline order book');
  const currentCandle = requiredLatest(candles, 'feature pipeline candles');
  const currentFunding = requiredLatest(funding, 'feature pipeline funding');
  const currentMarkIndex = requiredLatest(
    markIndex,
    'feature pipeline mark/index',
  );

  const flow = aggressiveFlow(trades);
  const depth = depthFeatures(currentBook, policy.depthLevels);
  const averageTrueRange = atr(candles);
  const atrPercent = (averageTrueRange / currentCandle.close) * 100;
  const efficiency = trendEfficiency(candles);
  const highVolatility =
    atrPercent >= policy.highVolatilityThresholdPercent;
  const trending = efficiency >= policy.trendEfficiencyThreshold;
  const regime: MarketRegime = trending
    ? highVolatility
      ? 'TRENDING_HIGH_VOLATILITY'
      : 'TRENDING_LOW_VOLATILITY'
    : highVolatility
      ? 'RANGE_HIGH_VOLATILITY'
      : 'RANGE_LOW_VOLATILITY';

  const selectedRecords = [
    ...trades,
    ...books,
    ...candles,
    ...funding,
    ...openInterest,
    ...markIndex,
  ];
  const sourceMaxObservedAt = Math.max(
    ...selectedRecords.map((record) => record.observedAt),
  );
  const sourceMaxReceivedAt = Math.max(
    ...selectedRecords.map((record) => record.receivedAt),
  );
  if (sourceMaxObservedAt > input.asOf || sourceMaxReceivedAt > input.asOf) {
    throw new Error('Feature pipeline source availability exceeds asOf');
  }

  const output: ResearchFeatureVector = {
    instrumentId: input.instrumentId,
    observedAt: input.asOf,
    sourceMaxObservedAt,
    sourceMaxReceivedAt,
    aggressiveDeltaContracts: flow.delta,
    aggressiveDeltaNormalized: flow.normalized,
    cumulativeVolumeDelta: flow.delta,
    orderBookImbalance: depth.orderBookImbalance,
    liquidityImbalance: depth.liquidityImbalance,
    fundingRate: currentFunding.fundingRate,
    fundingAccelerationPerHour: fundingAcceleration(funding),
    openInterestMomentumPercent: openInterestMomentumPercent(openInterest),
    basisBps:
      ((currentMarkIndex.markPrice - currentMarkIndex.indexPrice) /
        currentMarkIndex.indexPrice) *
      10_000,
    atrPercent,
    realizedVolatilityPercent: realizedVolatilityPercent(candles),
    vwapDeviationAtr:
      flow.vwap <= 0 || averageTrueRange <= 0
        ? 0
        : (currentCandle.close - flow.vwap) / averageTrueRange,
    trendEfficiency: efficiency,
    regime,
    dataQuality: {
      status: 'PASSED',
      trades: tradeSelection.quality,
      books: bookSelection.quality,
      candles: candleSelection.quality,
      funding: fundingSelection.quality,
      openInterest: openInterestSelection.quality,
      markIndex: markIndexSelection.quality,
    },
  };

  for (const [name, value] of Object.entries(output)) {
    if (typeof value === 'number') {
      requireFinite(value, name);
    }
  }
  return output;
};
