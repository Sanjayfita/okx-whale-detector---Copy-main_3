import type {
  CandleRecord,
  FundingRateRecord,
  HistoricalTradeRecord,
  MarkIndexRecord,
  OpenInterestRecord,
  OrderBookSnapshotRecord,
} from '../data/ResearchMarketData';

export type MarketRegime =
  | 'TRENDING_HIGH_VOLATILITY'
  | 'TRENDING_LOW_VOLATILITY'
  | 'RANGE_HIGH_VOLATILITY'
  | 'RANGE_LOW_VOLATILITY';

export interface FeaturePipelinePolicy {
  readonly depthLevels: number;
  readonly trendEfficiencyThreshold: number;
  readonly highVolatilityThresholdPercent: number;
}

export interface ResearchFeatureVector {
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly sourceMaxObservedAt: number;
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

const before = <T extends { readonly observedAt: number }>(
  records: readonly T[],
  asOf: number,
): readonly T[] =>
  records
    .filter((record) => record.observedAt <= asOf)
    .slice()
    .sort((left, right) => left.observedAt - right.observedAt);

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
  const policy: FeaturePipelinePolicy = {
    ...DEFAULT_FEATURE_PIPELINE_POLICY,
    ...input.policy,
  };
  if (!Number.isSafeInteger(policy.depthLevels) || policy.depthLevels <= 0) {
    throw new Error('depthLevels must be a positive safe integer');
  }

  const trades = before(input.trades, input.asOf);
  const books = before(input.books, input.asOf);
  const candles = before(input.candles, input.asOf).filter(
    (candle) => candle.confirmed,
  );
  const funding = before(input.funding, input.asOf).filter(
    (record) => record.fundingTime <= input.asOf,
  );
  const openInterest = before(input.openInterest, input.asOf);
  const markIndex = before(input.markIndex, input.asOf);

  const currentBook = requiredLatest(books, 'feature pipeline order book');
  const currentCandle = requiredLatest(candles, 'feature pipeline candles');
  const currentFunding = requiredLatest(funding, 'feature pipeline funding');
  requiredLatest(openInterest, 'feature pipeline open interest');
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

  const sourceTimes = [
    ...trades.map((record) => record.observedAt),
    currentBook.observedAt,
    ...candles.map((record) => record.observedAt),
    ...funding.map((record) => record.observedAt),
    ...openInterest.map((record) => record.observedAt),
    currentMarkIndex.observedAt,
  ];
  const sourceMaxObservedAt = Math.max(...sourceTimes);
  if (sourceMaxObservedAt > input.asOf) {
    throw new Error('Feature pipeline source timestamp exceeds asOf');
  }

  const output: ResearchFeatureVector = {
    instrumentId: input.instrumentId,
    observedAt: input.asOf,
    sourceMaxObservedAt,
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
  };

  for (const [name, value] of Object.entries(output)) {
    if (typeof value === 'number') {
      requireFinite(value, name);
    }
  }
  return output;
};
