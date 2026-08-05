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

const requireSafeTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const requireFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
};

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleStandardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
};

const sortedBefore = <T extends { readonly observedAt: number }>(
  records: readonly T[],
  asOf: number,
): readonly T[] =>
  records
    .filter((record) => record.observedAt <= asOf)
    .slice()
    .sort((left, right) => left.observedAt - right.observedAt);

const latest = <T>(records: readonly T[], name: string): T => {
  const value = records[records.length - 1];
  if (value === undefined) {
    throw new Error(`${name} requires at least one record`);
  }
  return value;
};

const first = <T>(records: readonly T[], name: string): T => {
  const value = records[0];
  if (value === undefined) {
    throw new Error(`${name} requires at least one record`);
  }
  return value;
};

const calculateAggressiveFlow = (
  trades: readonly HistoricalTradeRecord[],
): {
  readonly aggressiveDeltaContracts: number;
  readonly aggressiveDeltaNormalized: number;
  readonly cumulativeVolumeDelta: number;
  readonly vwap: number;
} => {
  let buyContracts = 0;
  let sellContracts = 0;
  let priceVolume = 0;
  let totalContracts = 0;
  for (const trade of trades) {
    if (trade.price <= 0 || trade.contracts <= 0) {
      throw new Error('Trade price and contracts must be positive');
    }
    if (trade.side === 'BUY') {
      buyContracts += trade.contracts;
    } else {
      sellContracts += trade.contracts;
    }
    totalContracts += trade.contracts;
    priceVolume += trade.price * trade.contracts;
  }
  const aggressiveDeltaContracts = buyContracts - sellContracts;
  return {
    aggressiveDeltaContracts,
    aggressiveDeltaNormalized:
      totalContracts === 0 ? 0 : aggressiveDeltaContracts / totalContracts,
    cumulativeVolumeDelta: aggressiveDeltaContracts,
    vwap: totalContracts === 0 ? 0 : priceVolume / totalContracts,
  };
};

const calculateDepthImbalance = (
  book: OrderBookSnapshotRecord,
  depthLevels: number,
): { readonly orderBookImbalance: number; readonly liquidityImbalance: number } => {
  const bids = book.bids.slice(0, depthLevels);
  const asks = book.asks.slice(0, depthLevels);
  const bidContracts = bids.reduce((sum, level) => sum + level.contracts, 0);
  const askContracts = asks.reduce((sum, level) => sum + level.contracts, 0);
  const totalContracts = bidContracts + askContracts;

  const weightedBid = bids.reduce(
    (sum, level, index) => sum + level.contracts / (index + 1),
    0,
  );
  const weightedAsk = asks.reduce(
    (sum, level, index) => sum + level.contracts / (index + 1),
    0,
  );
  const totalWeighted = weightedBid + weightedAsk;

  return {
    orderBookImbalance:
      totalContracts === 0 ? 0 : (bidContracts - askContracts) / totalContracts,
    liquidityImbalance:
      totalWeighted === 0 ? 0 : (weightedBid - weightedAsk) / totalWeighted,
  };
};

const calculateAtr = (candles: readonly CandleRecord[]): number => {
  if (candles.length === 0) {
    return 0;
  }
  const trueRanges: number[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (candle === undefined) {
      continue;
    }
    const previousClose = candles[index - 1]?.close ?? candle.open;
    trueRanges.push(
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      ),
    );
  }
  return mean(trueRanges);
};

const calculateTrendEfficiency = (candles: readonly CandleRecord[]): number => {
  if (candles.length < 2) {
    return 0;
  }
  const start = first(candles, 'trend efficiency').close;
  const end = latest(candles, 'trend efficiency').close;
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

const calculateRealizedVolatilityPercent = (
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
  const intervalMs = latest(candles, 'realized volatility').intervalMs;
  const annualization = intervalMs > 0 ? Math.sqrt(YEAR_MS / intervalMs) : 0;
  return sampleStandardDeviation(returns) * annualization * 100;
};

const calculateFundingAcceleration = (
  funding: readonly FundingRateRecord[],
): number => {
  if (funding.length < 2) {
    return 0;
  }
  const start = first(funding, 'funding acceleration');
  const end = latest(funding, 'funding acceleration');
  const hours = (end.fundingTime - start.fundingTime) / (60 * 60 * 1_000);
  return hours <= 0 ? 0 : (end.fundingRate - start.fundingRate) / hours;
};

const calculateOpenInterestMomentumPercent = (
  openInterest: readonly OpenInterestRecord[],
): number => {
  if (openInterest.length < 2) {
    return 0;
  }
  const start = first(openInterest, 'open interest momentum').contracts;
  const end = latest(openInterest, 'open interest momentum').contracts;
  return start <= 0 ? 0 : ((end - start) / start) * 100;
};

export const calculateResearchFeatures = (
  input: FeaturePipelineInput,
): ResearchFeatureVector => {
  requireSafeTimestamp(input.asOf, 'asOf');
  const policy: FeaturePipelinePolicy = {
    ...DEFAULT_FEATURE_PIPELINE_POLICY,
    ...input.policy,
  };
  if (!Number.isSafeInteger(policy.depthLevels) || policy.depthLevels <= 0) {
    throw new Error('depthLevels must be a positive safe integer');
  }

  const trades = sortedBefore(input.trades, input.asOf);
  const books = sortedBefore(input.books, input.asOf);
  const candles = sortedBefore(input.candles, input.asOf).filter(
    (candle) => candle.confirmed,
  );
  const funding = sortedBefore(input.funding, input.asOf);
  const openInterest = sortedBefore(input.openInterest, input.asOf);
  const markIndex = sortedBefore(input.markIndex, input.asOf);

  const book = latest(books, 'feature pipeline order book');
  const currentCandle = latest(candles, 'feature pipeline candles');
  const currentFunding = latest(funding, 'feature pipeline funding');
  const currentMarkIndex = latest(markIndex, 'feature pipeline mark/index');
  latest(openInterest, 'feature pipeline open interest');

  const aggressiveFlow = calculateAggressiveFlow(trades);
  const depth = calculateDepthImbalance(book, policy.depthLevels);
  const atr = calculateAtr(candles);
  const atrPercent = currentCandle.close <= 0 ? 0 : (atr / currentCandle.close) * 100;
  const realizedVolatilityPercent = calculateRealizedVolatilityPercent(candles);
  const trendEfficiency = calculateTrendEfficiency(candles);
  const vwapDeviationAtr =
    aggressiveFlow.vwap <= 0 || atr <= 0
      ? 0
      : (currentCandle.close - aggressiveFlow.vwap) / atr;
  const basisBps =
    ((currentMarkIndex.markPrice - currentMarkIndex.indexPrice) /
      currentMarkIndex.indexPrice) *
    10_000;

  const sourceTimes = [
    ...trades.map((record) => record.observedAt),
    book.observedAt,
    ...candles.map((record) => record.observedAt),
    ...funding.map((record) => record.observedAt),
    ...openInterest.map((record) => record.observedAt),
    currentMarkIndex.observedAt,
  ];
  const sourceMaxObservedAt = Math.max(...sourceTimes);
  if (sourceMaxObservedAt > input.asOf) {
    throw new Error('Feature pipeline source timestamp exceeds asOf');
  }

  const trending = trendEfficiency >= policy.trendEfficiencyThreshold;
  const highVolatility = atrPercent >= policy.highVolatilityThresholdPercent;
  const regime: MarketRegime = trending
    ? highVolatility
      ? 'TRENDING_HIGH_VOLATILITY'
      : 'TRENDING_LOW_VOLATILITY'
    : highVolatility
      ? 'RANGE_HIGH_VOLATILITY'
      : 'RANGE_LOW_VOLATILITY';

  const output: ResearchFeatureVector = {
    instrumentId: input.instrumentId,
    observedAt: input.asOf,
    sourceMaxObservedAt,
    aggressiveDeltaContracts: aggressiveFlow.aggressiveDeltaContracts,
    aggressiveDeltaNormalized: aggressiveFlow.aggressiveDeltaNormalized,
    cumulativeVolumeDelta: aggressiveFlow.cumulativeVolumeDelta,
    orderBookImbalance: depth.orderBookImbalance,
    liquidityImbalance: depth.liquidityImbalance,
    fundingRate: currentFunding.fundingRate,
    fundingAccelerationPerHour: calculateFundingAcceleration(funding),
    openInterestMomentumPercent:
      calculateOpenInterestMomentumPercent(openInterest),
    basisBps,
    atrPercent,
    realizedVolatilityPercent,
    vwapDeviationAtr,
    trendEfficiency,
    regime,
  };

  for (const [name, value] of Object.entries(output)) {
    if (typeof value === 'number') {
      requireFinite(value, name);
    }
  }
  return output;
};
