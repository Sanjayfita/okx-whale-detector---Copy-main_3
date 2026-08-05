import {
  ALPHA_FEATURE_NAMES,
  ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
  type AlphaFeatureExtractionConfig,
  type AlphaFeatureName,
  type AlphaFeatureValueMap,
  type AlphaFeatureVector,
  type AlphaResearchCandle,
  type AlphaResearchEventSnapshot,
  type AlphaResearchOrderBookSnapshot,
  type AlphaResearchTrade,
  type AlphaSessionWindow,
  type AlphaWhaleFeatureContext,
} from './alphaFeatureTypes';
import { validateAlphaFeatureExtractionConfig } from './alphaResearchConfig';
import { parseQualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';
import { requireArrayElement } from '../core/arrayAccess';

type MutableAlphaFeatureValues = {
  -readonly [Name in AlphaFeatureName]: number | null;
};

export const createMissingAlphaFeatureValues = (): AlphaFeatureValueMap =>
  Object.freeze({
    ema_fast_distance_directional_percent: null,
    ema_medium_distance_directional_percent: null,
    ema_slow_distance_directional_percent: null,
    ema_fast_medium_spread_directional_percent: null,
    ema_medium_slow_spread_directional_percent: null,
    ema_fast_slope_directional_percent: null,
    ema_medium_slope_directional_percent: null,
    ema_alignment_directional: null,
    ema_multi_timeframe_alignment_directional: null,
    return_short_directional_percent: null,
    return_long_directional_percent: null,
    market_structure_directional: null,
    break_of_structure_directional: null,
    change_of_character_directional: null,
    range_position_directional: null,
    equal_high_distance_percent: null,
    equal_low_distance_percent: null,
    liquidity_sweep_directional: null,
    swing_failure_directional: null,
    fvg_directional: null,
    order_block_directional: null,
    cvd_notional_log_directional: null,
    cvd_ratio_directional: null,
    trade_count_log: null,
    book_imbalance_l1_directional: null,
    book_imbalance_depth_directional: null,
    microprice_offset_directional_bps: null,
    spread_bps: null,
    atr_percent: null,
    realized_volatility_percent: null,
    volatility_compression_ratio: null,
    relative_volume: null,
    volume_zscore: null,
    vwap_distance_directional_percent: null,
    anchored_vwap_distance_directional_percent: null,
    adx: null,
    dmi_directional: null,
    rsi_directional: null,
    macd_histogram_directional_percent: null,
    macd_slope_directional_percent: null,
    session_asia: null,
    session_london: null,
    session_new_york: null,
    trend_efficiency_ratio: null,
    wall_persistence_seconds: null,
    refill_count: null,
    spoof_probability: null,
    absorption_score: null,
    execution_ratio: null,
    whale_notional_log: null,
  });

const requireSafeTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const requireFinitePositive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
};

const requireFiniteNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
};

const directionMultiplier = (direction: 'BULLISH' | 'BEARISH'): number =>
  direction === 'BULLISH' ? 1 : -1;

const mean = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const sampleStandardDeviation = (values: readonly number[]): number | null => {
  if (values.length < 2) return null;
  const average = mean(values);
  if (average === null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const percentageDifference = (left: number, right: number): number | null =>
  right > 0 ? ((left - right) / right) * 100 : null;

const directionalPercentageDifference = (
  left: number,
  right: number,
  direction: number,
): number | null => {
  const difference = percentageDifference(left, right);
  return difference === null ? null : difference * direction;
};

const last = <Value>(values: readonly Value[]): Value | undefined =>
  values[values.length - 1];

const lastFinite = (values: readonly (number | null)[]): number | null => {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
};

const exponentialMovingAverage = (
  values: readonly number[],
  period: number,
): readonly (number | null)[] => {
  const result: (number | null)[] = Array.from(
    { length: values.length },
    () => null,
  );
  if (values.length < period) return result;
  const seed = mean(values.slice(0, period));
  if (seed === null) return result;
  result[period - 1] = seed;
  const multiplier = 2 / (period + 1);
  let previous = seed;
  for (let index = period; index < values.length; index += 1) {
    previous =
      (requireArrayElement(values, index, 'EMA input') - previous) *
        multiplier +
      previous;
    result[index] = previous;
  }
  return result;
};

const higherTimeframeCloses = (
  candles: readonly AlphaResearchCandle[],
  multiplier: number,
): readonly number[] => {
  const latest = last(candles);
  if (latest === undefined) return Object.freeze([]);
  const baseIntervalMs = latest.intervalEnd - latest.intervalStart;
  const higherIntervalMs = baseIntervalMs * multiplier;
  if (!Number.isSafeInteger(higherIntervalMs)) {
    throw new Error('higher-timeframe interval exceeds the safe integer range');
  }
  const buckets = new Map<number, AlphaResearchCandle[]>();
  for (const candle of candles) {
    const bucketStart =
      Math.floor(candle.intervalStart / higherIntervalMs) * higherIntervalMs;
    const bucket = buckets.get(bucketStart) ?? [];
    bucket.push(candle);
    buckets.set(bucketStart, bucket);
  }
  const closes: number[] = [];
  for (const [bucketStart, bucket] of [...buckets].sort(
    ([left], [right]) => left - right,
  )) {
    const first = bucket.at(0);
    const final = last(bucket);
    const complete =
      bucket.length === multiplier &&
      first !== undefined &&
      first.intervalStart === bucketStart &&
      final !== undefined &&
      final.intervalEnd === bucketStart + higherIntervalMs &&
      bucket.every(
        (candle, index) =>
          index === 0 ||
          requireArrayElement(bucket, index - 1, 'higher-timeframe candle')
            .intervalEnd === candle.intervalStart,
      );
    if (complete && final !== undefined) closes.push(final.close);
  }
  return Object.freeze(closes);
};

const directionalReturn = (
  closes: readonly number[],
  lookback: number,
  direction: number,
): number | null => {
  if (closes.length <= lookback) return null;
  const current = requireArrayElement(
    closes,
    closes.length - 1,
    'directional return current close',
  );
  const previous = requireArrayElement(
    closes,
    closes.length - 1 - lookback,
    'directional return prior close',
  );
  const result = percentageDifference(current, previous);
  return result === null ? null : result * direction;
};

const validateCandle = (
  candle: AlphaResearchCandle,
  detectedAt: number,
  index: number,
): void => {
  requireSafeTimestamp(candle.intervalStart, `candles[${index}].intervalStart`);
  requireSafeTimestamp(candle.intervalEnd, `candles[${index}].intervalEnd`);
  requireSafeTimestamp(
    candle.availabilityTimestamp,
    `candles[${index}].availabilityTimestamp`,
  );
  if (candle.intervalStart >= candle.intervalEnd) {
    throw new Error(`candles[${index}] has an invalid interval`);
  }
  if (candle.availabilityTimestamp < candle.intervalEnd) {
    throw new Error(`candles[${index}] was available before it was confirmed`);
  }
  if (
    candle.intervalEnd > detectedAt ||
    candle.availabilityTimestamp > detectedAt
  ) {
    throw new Error(`candles[${index}] contains future information`);
  }
  requireFinitePositive(candle.open, `candles[${index}].open`);
  requireFinitePositive(candle.high, `candles[${index}].high`);
  requireFinitePositive(candle.low, `candles[${index}].low`);
  requireFinitePositive(candle.close, `candles[${index}].close`);
  requireFiniteNonNegative(candle.volume, `candles[${index}].volume`);
  if (
    candle.high < Math.max(candle.open, candle.close) ||
    candle.low > Math.min(candle.open, candle.close) ||
    candle.low > candle.high
  ) {
    throw new Error(`candles[${index}] has inconsistent OHLC prices`);
  }
};

const validatedContiguousCandles = (
  candles: readonly AlphaResearchCandle[],
  detectedAt: number,
  maximumAgeMs: number,
): readonly AlphaResearchCandle[] => {
  const sorted = [...candles].sort(
    (left, right) => left.intervalEnd - right.intervalEnd,
  );
  sorted.forEach((candle, index) => validateCandle(candle, detectedAt, index));
  for (let index = 1; index < sorted.length; index += 1) {
    if (
      requireArrayElement(sorted, index - 1, 'prior sorted candle')
        .intervalEnd ===
      requireArrayElement(sorted, index, 'current sorted candle').intervalEnd
    ) {
      throw new Error('candles contains duplicate confirmed intervals');
    }
  }
  const latest = last(sorted);
  if (
    latest === undefined ||
    detectedAt - latest.intervalEnd > maximumAgeMs ||
    detectedAt - latest.availabilityTimestamp > maximumAgeMs
  ) {
    return Object.freeze([]);
  }

  const intervalMs = latest.intervalEnd - latest.intervalStart;
  let startIndex = sorted.length - 1;
  while (startIndex > 0) {
    const current = requireArrayElement(
      sorted,
      startIndex,
      'contiguous current candle',
    );
    const previous = requireArrayElement(
      sorted,
      startIndex - 1,
      'contiguous prior candle',
    );
    if (
      current.intervalStart !== previous.intervalEnd ||
      previous.intervalEnd - previous.intervalStart !== intervalMs
    ) {
      break;
    }
    startIndex -= 1;
  }
  return Object.freeze(sorted.slice(startIndex));
};

const validateOrderBook = (
  orderBook: AlphaResearchOrderBookSnapshot,
  detectedAt: number,
): void => {
  requireSafeTimestamp(orderBook.eventTimestamp, 'orderBook.eventTimestamp');
  requireSafeTimestamp(
    orderBook.availabilityTimestamp,
    'orderBook.availabilityTimestamp',
  );
  if (orderBook.eventTimestamp > orderBook.availabilityTimestamp) {
    throw new Error('orderBook event timestamp cannot follow availability');
  }
  if (orderBook.availabilityTimestamp > detectedAt) {
    throw new Error('orderBook contains future information');
  }
  if (orderBook.bids.length === 0 || orderBook.asks.length === 0) {
    throw new Error('orderBook must contain both bids and asks');
  }
  const validateSide = (
    levels: AlphaResearchOrderBookSnapshot['bids'],
    side: 'bids' | 'asks',
  ): void => {
    levels.forEach((level, index) => {
      requireFinitePositive(level.price, `orderBook.${side}[${index}].price`);
      requireFinitePositive(level.size, `orderBook.${side}[${index}].size`);
      if (index === 0) return;
      const previous = requireArrayElement(
        levels,
        index - 1,
        `orderBook.${side}`,
      );
      const correctlyOrdered =
        side === 'bids'
          ? previous.price > level.price
          : previous.price < level.price;
      if (!correctlyOrdered) {
        throw new Error(`orderBook ${side} must be strictly price ordered`);
      }
    });
  };
  validateSide(orderBook.bids, 'bids');
  validateSide(orderBook.asks, 'asks');
  const bestBid = requireArrayElement(orderBook.bids, 0, 'best bid');
  const bestAsk = requireArrayElement(orderBook.asks, 0, 'best ask');
  if (bestBid.price >= bestAsk.price) {
    throw new Error('orderBook is crossed or locked');
  }
};

const validateTrade = (
  trade: AlphaResearchTrade,
  detectedAt: number,
  index: number,
): void => {
  if (trade.tradeId.trim().length === 0) {
    throw new Error(`trades[${index}].tradeId must not be empty`);
  }
  requireSafeTimestamp(trade.eventTimestamp, `trades[${index}].eventTimestamp`);
  requireSafeTimestamp(
    trade.availabilityTimestamp,
    `trades[${index}].availabilityTimestamp`,
  );
  if (trade.eventTimestamp > trade.availabilityTimestamp) {
    throw new Error(`trades[${index}] was available before its event time`);
  }
  if (trade.availabilityTimestamp > detectedAt) {
    throw new Error(`trades[${index}] contains future information`);
  }
  if (trade.side !== 'BUY' && trade.side !== 'SELL') {
    throw new Error(`trades[${index}].side is invalid`);
  }
  requireFinitePositive(trade.price, `trades[${index}].price`);
  requireFinitePositive(trade.size, `trades[${index}].size`);
  requireFinitePositive(trade.notionalQuote, `trades[${index}].notionalQuote`);
};

const validatedTrades = (
  trades: readonly AlphaResearchTrade[],
  detectedAt: number,
  lookbackMs: number,
): readonly AlphaResearchTrade[] => {
  const seen = new Set<string>();
  trades.forEach((trade, index) => {
    validateTrade(trade, detectedAt, index);
    if (seen.has(trade.tradeId)) {
      throw new Error(`trades contains duplicate tradeId ${trade.tradeId}`);
    }
    seen.add(trade.tradeId);
  });
  return Object.freeze(
    trades
      .filter(
        (trade) =>
          trade.eventTimestamp >= detectedAt - lookbackMs &&
          trade.availabilityTimestamp >= detectedAt - lookbackMs,
      )
      .sort((left, right) => {
        const timestampDifference =
          left.availabilityTimestamp - right.availabilityTimestamp;
        return timestampDifference !== 0
          ? timestampDifference
          : left.tradeId.localeCompare(right.tradeId);
      }),
  );
};

const validateWhaleContext = (
  whale: AlphaWhaleFeatureContext,
  detectedAt: number,
): void => {
  requireSafeTimestamp(
    whale.availabilityTimestamp,
    'whale.availabilityTimestamp',
  );
  if (whale.availabilityTimestamp > detectedAt) {
    throw new Error('whale context contains future information');
  }
  const validateNullable = (
    value: number | null,
    name: string,
    minimum: number,
    maximum: number,
    integer = false,
  ): void => {
    if (value === null) return;
    if (
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum ||
      (integer && !Number.isSafeInteger(value))
    ) {
      throw new Error(`whale.${name} is outside its supported range`);
    }
  };
  validateNullable(
    whale.wallPersistenceMs,
    'wallPersistenceMs',
    0,
    Number.MAX_SAFE_INTEGER,
    true,
  );
  validateNullable(
    whale.refillCount,
    'refillCount',
    0,
    Number.MAX_SAFE_INTEGER,
    true,
  );
  validateNullable(whale.spoofProbability, 'spoofProbability', 0, 1);
  validateNullable(whale.absorptionScore, 'absorptionScore', 0, 1);
  validateNullable(whale.executionRatio, 'executionRatio', 0, 1);
  validateNullable(
    whale.whaleNotionalQuote,
    'whaleNotionalQuote',
    Number.EPSILON,
    Number.MAX_VALUE,
  );
};

const structureDirection = (
  candles: readonly AlphaResearchCandle[],
  lookback: number,
): number | null => {
  if (candles.length < lookback || lookback < 4) return null;
  const window = candles.slice(-lookback);
  const split = Math.floor(window.length / 2);
  const earlier = window.slice(0, split);
  const later = window.slice(split);
  const earlierHigh = Math.max(...earlier.map((candle) => candle.high));
  const earlierLow = Math.min(...earlier.map((candle) => candle.low));
  const laterHigh = Math.max(...later.map((candle) => candle.high));
  const laterLow = Math.min(...later.map((candle) => candle.low));
  if (laterHigh > earlierHigh && laterLow > earlierLow) return 1;
  if (laterHigh < earlierHigh && laterLow < earlierLow) return -1;
  return 0;
};

const breakOfStructure = (
  candles: readonly AlphaResearchCandle[],
  lookback: number,
): number | null => {
  if (candles.length <= lookback) return null;
  const current = requireArrayElement(
    candles,
    candles.length - 1,
    'break-of-structure candle',
  );
  const prior = candles.slice(-lookback - 1, -1);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  if (current.close > priorHigh) return 1;
  if (current.close < priorLow) return -1;
  return 0;
};

const nearestEqualLevelDistance = (
  prices: readonly number[],
  referencePrice: number,
  tolerancePercent: number,
): number | null => {
  if (prices.length < 2) return null;
  let nearest: number | null = null;
  for (let left = 0; left < prices.length - 1; left += 1) {
    const leftPrice = requireArrayElement(prices, left, 'equal-level price');
    for (let right = left + 1; right < prices.length; right += 1) {
      const rightPrice = requireArrayElement(
        prices,
        right,
        'equal-level price',
      );
      const midpoint = (leftPrice + rightPrice) / 2;
      const separation = Math.abs(leftPrice - rightPrice);
      if ((separation / midpoint) * 100 > tolerancePercent) continue;
      const distance =
        (Math.abs(referencePrice - midpoint) / referencePrice) * 100;
      nearest = nearest === null ? distance : Math.min(nearest, distance);
    }
  }
  return nearest;
};

const liquiditySignals = (
  candles: readonly AlphaResearchCandle[],
  lookback: number,
): Readonly<{ sweep: number | null; swingFailure: number | null }> => {
  if (candles.length <= lookback) {
    return Object.freeze({ sweep: null, swingFailure: null });
  }
  const current = requireArrayElement(
    candles,
    candles.length - 1,
    'liquidity-signal candle',
  );
  const prior = candles.slice(-lookback - 1, -1);
  const priorHigh = Math.max(...prior.map((candle) => candle.high));
  const priorLow = Math.min(...prior.map((candle) => candle.low));
  const sweptHigh = current.high > priorHigh;
  const sweptLow = current.low < priorLow;
  const sweep = sweptLow === sweptHigh ? 0 : sweptLow ? 1 : -1;
  const bullishFailure =
    sweptLow && current.close > priorLow && current.close > current.open;
  const bearishFailure =
    sweptHigh && current.close < priorHigh && current.close < current.open;
  const swingFailure =
    bullishFailure === bearishFailure ? 0 : bullishFailure ? 1 : -1;
  return Object.freeze({ sweep, swingFailure });
};

const fairValueGapDirection = (
  candles: readonly AlphaResearchCandle[],
  lookback: number,
  minimumGapPercent: number,
): number | null => {
  if (candles.length < 3) return null;
  const start = Math.max(2, candles.length - lookback);
  for (let index = candles.length - 1; index >= start; index -= 1) {
    const first = requireArrayElement(
      candles,
      index - 2,
      'fair-value-gap first candle',
    );
    const third = requireArrayElement(
      candles,
      index,
      'fair-value-gap third candle',
    );
    const bullishGap = percentageDifference(third.low, first.high);
    if (bullishGap !== null && bullishGap >= minimumGapPercent) return 1;
    const bearishGap = percentageDifference(first.low, third.high);
    if (bearishGap !== null && bearishGap >= minimumGapPercent) return -1;
  }
  return 0;
};

const orderBlockDirection = (
  candles: readonly AlphaResearchCandle[],
  lookback: number,
  breakDirection: number | null,
): number | null => {
  if (breakDirection === null || candles.length < 2) return null;
  if (breakDirection === 0) return 0;
  const window = candles.slice(-lookback - 1, -1);
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const candle = requireArrayElement(window, index, 'order-block candle');
    if (breakDirection > 0 && candle.close < candle.open) return 1;
    if (breakDirection < 0 && candle.close > candle.open) return -1;
  }
  return 0;
};

const averageTrueRangePercent = (
  candles: readonly AlphaResearchCandle[],
  period: number,
): number | null => {
  if (candles.length <= period) return null;
  const trueRanges: number[] = [];
  for (
    let index = candles.length - period;
    index < candles.length;
    index += 1
  ) {
    const candle = requireArrayElement(candles, index, 'ATR candle');
    const previousClose = requireArrayElement(
      candles,
      index - 1,
      'ATR prior candle',
    ).close;
    trueRanges.push(
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      ),
    );
  }
  const average = mean(trueRanges);
  const close = last(candles)?.close;
  return average === null || close === undefined
    ? null
    : (average / close) * 100;
};

const realizedVolatility = (
  closes: readonly number[],
  period: number,
): number | null => {
  if (closes.length <= period) return null;
  const returns: number[] = [];
  for (let index = closes.length - period; index < closes.length; index += 1) {
    returns.push(
      Math.log(
        requireArrayElement(closes, index, 'volatility close') /
          requireArrayElement(closes, index - 1, 'volatility prior close'),
      ),
    );
  }
  const deviation = sampleStandardDeviation(returns);
  return deviation === null ? null : deviation * Math.sqrt(period) * 100;
};

const volumeFeatures = (
  candles: readonly AlphaResearchCandle[],
  period: number,
): Readonly<{ relative: number | null; zscore: number | null }> => {
  if (candles.length <= period) {
    return Object.freeze({ relative: null, zscore: null });
  }
  const current = requireArrayElement(
    candles,
    candles.length - 1,
    'current volume candle',
  ).volume;
  const history = candles.slice(-period - 1, -1).map((candle) => candle.volume);
  const average = mean(history);
  const deviation = sampleStandardDeviation(history);
  return Object.freeze({
    relative: average === null || average === 0 ? null : current / average,
    zscore:
      average === null || deviation === null || deviation === 0
        ? null
        : (current - average) / deviation,
  });
};

const volumeWeightedAveragePrice = (
  candles: readonly AlphaResearchCandle[],
  period: number,
): number | null => {
  if (candles.length < period) return null;
  let weightedTotal = 0;
  let totalVolume = 0;
  for (const candle of candles.slice(-period)) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    weightedTotal += typicalPrice * candle.volume;
    totalVolume += candle.volume;
  }
  return totalVolume > 0 ? weightedTotal / totalVolume : null;
};

const directionalMovement = (
  candles: readonly AlphaResearchCandle[],
  period: number,
): Readonly<{ adx: number | null; dmi: number | null }> => {
  if (candles.length <= period * 2) {
    return Object.freeze({ adx: null, dmi: null });
  }
  const trueRanges: number[] = [];
  const positiveMovements: number[] = [];
  const negativeMovements: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = requireArrayElement(
      candles,
      index,
      'directional-movement candle',
    );
    const previous = requireArrayElement(
      candles,
      index - 1,
      'directional-movement prior candle',
    );
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    positiveMovements.push(upMove > downMove && upMove > 0 ? upMove : 0);
    negativeMovements.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
  }
  const dxValues: number[] = [];
  let finalDifference: number | null = null;
  for (let end = period; end <= trueRanges.length; end += 1) {
    const range = mean(trueRanges.slice(end - period, end));
    const positive = mean(positiveMovements.slice(end - period, end));
    const negative = mean(negativeMovements.slice(end - period, end));
    if (
      range === null ||
      positive === null ||
      negative === null ||
      range === 0
    ) {
      continue;
    }
    const positiveIndex = (positive / range) * 100;
    const negativeIndex = (negative / range) * 100;
    const denominator = positiveIndex + negativeIndex;
    if (denominator > 0) {
      dxValues.push(
        (Math.abs(positiveIndex - negativeIndex) / denominator) * 100,
      );
    }
    finalDifference = positiveIndex - negativeIndex;
  }
  const adx = mean(dxValues.slice(-period));
  return Object.freeze({ adx, dmi: finalDifference });
};

const relativeStrengthIndex = (
  closes: readonly number[],
  period: number,
): number | null => {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const change =
      requireArrayElement(closes, index, 'RSI close') -
      requireArrayElement(closes, index - 1, 'RSI prior close');
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
};

const macdFeatures = (
  closes: readonly number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
  slopeLookback: number,
): Readonly<{
  histogramPercent: number | null;
  slopePercent: number | null;
}> => {
  const fast = exponentialMovingAverage(closes, fastPeriod);
  const slow = exponentialMovingAverage(closes, slowPeriod);
  const macd: number[] = [];
  for (let index = 0; index < closes.length; index += 1) {
    const fastValue = requireArrayElement(fast, index, 'MACD fast EMA');
    const slowValue = requireArrayElement(slow, index, 'MACD slow EMA');
    if (fastValue !== null && slowValue !== null) {
      macd.push(fastValue - slowValue);
    }
  }
  if (macd.length < signalPeriod) {
    return Object.freeze({ histogramPercent: null, slopePercent: null });
  }
  const signal = lastFinite(exponentialMovingAverage(macd, signalPeriod));
  const currentMacd = last(macd);
  const close = last(closes);
  if (signal === null || currentMacd === undefined || close === undefined) {
    return Object.freeze({ histogramPercent: null, slopePercent: null });
  }
  const priorMacd =
    macd.length > slopeLookback
      ? macd[macd.length - 1 - slopeLookback]
      : undefined;
  return Object.freeze({
    histogramPercent: ((currentMacd - signal) / close) * 100,
    slopePercent:
      priorMacd === undefined
        ? null
        : ((currentMacd - priorMacd) / close) * 100,
  });
};

const isInSession = (
  timestamp: number,
  session: AlphaSessionWindow,
): number => {
  const date = new Date(timestamp);
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (session.startMinuteUtc < session.endMinuteUtc) {
    return minute >= session.startMinuteUtc && minute < session.endMinuteUtc
      ? 1
      : 0;
  }
  return minute >= session.startMinuteUtc || minute < session.endMinuteUtc
    ? 1
    : 0;
};

const trendEfficiency = (
  closes: readonly number[],
  period: number,
): number | null => {
  if (closes.length <= period) return null;
  const start = closes.length - 1 - period;
  const netChange = Math.abs(
    requireArrayElement(closes, closes.length - 1, 'efficiency current close') -
      requireArrayElement(closes, start, 'efficiency starting close'),
  );
  let pathLength = 0;
  for (let index = start + 1; index < closes.length; index += 1) {
    pathLength += Math.abs(
      requireArrayElement(closes, index, 'efficiency close') -
        requireArrayElement(closes, index - 1, 'efficiency prior close'),
    );
  }
  return pathLength === 0 ? 0 : netChange / pathLength;
};

const setFeature = (
  values: MutableAlphaFeatureValues,
  enabled: ReadonlySet<AlphaFeatureName>,
  name: AlphaFeatureName,
  value: number | null,
): void => {
  if (!enabled.has(name)) return;
  values[name] = value !== null && Number.isFinite(value) ? value : null;
};

export const extractAlphaFeatures = (
  snapshot: AlphaResearchEventSnapshot,
  config: AlphaFeatureExtractionConfig,
): AlphaFeatureVector => {
  validateAlphaFeatureExtractionConfig(config);
  if (
    snapshot.schemaVersion !== ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION ||
    snapshot.liveOrderExecutionAllowed !== false
  ) {
    throw new Error('Alpha snapshot has an invalid research-only envelope');
  }
  const evidence = parseQualifiedAlertEvidenceRecord(snapshot.evidence);
  if (evidence === undefined) {
    throw new Error('Alpha snapshot contains invalid qualified-alert evidence');
  }
  const candles = validatedContiguousCandles(
    snapshot.candles,
    evidence.detectedAt,
    config.maximumCandleAgeMs,
  );
  if (snapshot.orderBook !== null) {
    validateOrderBook(snapshot.orderBook, evidence.detectedAt);
  }
  const freshOrderBook =
    snapshot.orderBook !== null &&
    evidence.detectedAt - snapshot.orderBook.eventTimestamp <=
      config.maximumOrderBookAgeMs &&
    evidence.detectedAt - snapshot.orderBook.availabilityTimestamp <=
      config.maximumOrderBookAgeMs
      ? snapshot.orderBook
      : null;
  const trades = validatedTrades(
    snapshot.trades,
    evidence.detectedAt,
    config.tradeLookbackMs,
  );
  validateWhaleContext(snapshot.whale, evidence.detectedAt);

  const enabled = new Set(config.enabledFeatures);
  const values: MutableAlphaFeatureValues = {
    ...createMissingAlphaFeatureValues(),
  };
  const direction = directionMultiplier(evidence.direction);
  const closes = candles.map((candle) => candle.close);
  const currentClose = last(closes);

  const fastEma = exponentialMovingAverage(closes, config.emaFastPeriod);
  const mediumEma = exponentialMovingAverage(closes, config.emaMediumPeriod);
  const slowEma = exponentialMovingAverage(closes, config.emaSlowPeriod);
  const fast = lastFinite(fastEma);
  const medium = lastFinite(mediumEma);
  const slow = lastFinite(slowEma);
  setFeature(
    values,
    enabled,
    'ema_fast_distance_directional_percent',
    currentClose === undefined || fast === null
      ? null
      : directionalPercentageDifference(currentClose, fast, direction),
  );
  setFeature(
    values,
    enabled,
    'ema_medium_distance_directional_percent',
    currentClose === undefined || medium === null
      ? null
      : directionalPercentageDifference(currentClose, medium, direction),
  );
  setFeature(
    values,
    enabled,
    'ema_slow_distance_directional_percent',
    currentClose === undefined || slow === null
      ? null
      : directionalPercentageDifference(currentClose, slow, direction),
  );
  setFeature(
    values,
    enabled,
    'ema_fast_medium_spread_directional_percent',
    fast === null || medium === null
      ? null
      : ((fast - medium) / medium) * 100 * direction,
  );
  setFeature(
    values,
    enabled,
    'ema_medium_slow_spread_directional_percent',
    medium === null || slow === null
      ? null
      : ((medium - slow) / slow) * 100 * direction,
  );
  const setEmaSlope = (
    name:
      | 'ema_fast_slope_directional_percent'
      | 'ema_medium_slope_directional_percent',
    ema: readonly (number | null)[],
  ): void => {
    const current = lastFinite(ema);
    const priorIndex = ema.length - 1 - config.emaSlopeLookback;
    const prior =
      priorIndex >= 0
        ? requireArrayElement(ema, priorIndex, 'EMA slope prior value')
        : null;
    setFeature(
      values,
      enabled,
      name,
      current === null || prior === null
        ? null
        : ((current - prior) / prior) * 100 * direction,
    );
  };
  setEmaSlope('ema_fast_slope_directional_percent', fastEma);
  setEmaSlope('ema_medium_slope_directional_percent', mediumEma);
  const rawAlignment =
    fast === null || medium === null || slow === null
      ? null
      : fast > medium && medium > slow
        ? 1
        : fast < medium && medium < slow
          ? -1
          : 0;
  setFeature(
    values,
    enabled,
    'ema_alignment_directional',
    rawAlignment === null ? null : rawAlignment * direction,
  );
  const higherCloses = higherTimeframeCloses(
    candles,
    config.higherTimeframeMultiplier,
  );
  const higherFast = lastFinite(
    exponentialMovingAverage(higherCloses, config.emaFastPeriod),
  );
  const higherMedium = lastFinite(
    exponentialMovingAverage(higherCloses, config.emaMediumPeriod),
  );
  const higherSlow = lastFinite(
    exponentialMovingAverage(higherCloses, config.emaSlowPeriod),
  );
  const higherAlignment =
    higherFast === null || higherMedium === null || higherSlow === null
      ? null
      : higherFast > higherMedium && higherMedium > higherSlow
        ? 1
        : higherFast < higherMedium && higherMedium < higherSlow
          ? -1
          : 0;
  setFeature(
    values,
    enabled,
    'ema_multi_timeframe_alignment_directional',
    higherAlignment === null ? null : higherAlignment * direction,
  );
  setFeature(
    values,
    enabled,
    'return_short_directional_percent',
    directionalReturn(closes, config.returnShortLookback, direction),
  );
  setFeature(
    values,
    enabled,
    'return_long_directional_percent',
    directionalReturn(closes, config.returnLongLookback, direction),
  );

  const structure = structureDirection(candles, config.structureLookback);
  const breakDirection = breakOfStructure(candles, config.structureLookback);
  setFeature(
    values,
    enabled,
    'market_structure_directional',
    structure === null ? null : structure * direction,
  );
  setFeature(
    values,
    enabled,
    'break_of_structure_directional',
    breakDirection === null ? null : breakDirection * direction,
  );
  const previousStructure = structureDirection(
    candles.slice(0, -1),
    config.structureLookback,
  );
  const changeOfCharacter =
    previousStructure === null || breakDirection === null
      ? null
      : previousStructure < 0 && breakDirection > 0
        ? 1
        : previousStructure > 0 && breakDirection < 0
          ? -1
          : 0;
  setFeature(
    values,
    enabled,
    'change_of_character_directional',
    changeOfCharacter === null ? null : changeOfCharacter * direction,
  );
  if (
    candles.length >= config.structureLookback &&
    currentClose !== undefined
  ) {
    const range = candles.slice(-config.structureLookback);
    const rangeHigh = Math.max(...range.map((candle) => candle.high));
    const rangeLow = Math.min(...range.map((candle) => candle.low));
    setFeature(
      values,
      enabled,
      'range_position_directional',
      rangeHigh === rangeLow
        ? 0
        : (((currentClose - rangeLow) / (rangeHigh - rangeLow)) * 2 - 1) *
            direction,
    );
  }
  const equalWindow = candles.slice(-config.equalLevelLookback);
  if (currentClose !== undefined) {
    setFeature(
      values,
      enabled,
      'equal_high_distance_percent',
      nearestEqualLevelDistance(
        equalWindow.map((candle) => candle.high),
        currentClose,
        config.equalLevelTolerancePercent,
      ),
    );
    setFeature(
      values,
      enabled,
      'equal_low_distance_percent',
      nearestEqualLevelDistance(
        equalWindow.map((candle) => candle.low),
        currentClose,
        config.equalLevelTolerancePercent,
      ),
    );
  }
  const liquidity = liquiditySignals(candles, config.swingLookback);
  setFeature(
    values,
    enabled,
    'liquidity_sweep_directional',
    liquidity.sweep === null ? null : liquidity.sweep * direction,
  );
  setFeature(
    values,
    enabled,
    'swing_failure_directional',
    liquidity.swingFailure === null ? null : liquidity.swingFailure * direction,
  );
  const fvg = fairValueGapDirection(
    candles,
    config.fvgLookback,
    config.fvgMinimumGapPercent,
  );
  setFeature(
    values,
    enabled,
    'fvg_directional',
    fvg === null ? null : fvg * direction,
  );
  const orderBlock = orderBlockDirection(
    candles,
    config.orderBlockLookback,
    breakDirection,
  );
  setFeature(
    values,
    enabled,
    'order_block_directional',
    orderBlock === null ? null : orderBlock * direction,
  );

  if (trades.length > 0) {
    const signedNotional = trades.reduce(
      (sum, trade) =>
        sum +
        (trade.side === 'BUY' ? trade.notionalQuote : -trade.notionalQuote),
      0,
    );
    const totalNotional = trades.reduce(
      (sum, trade) => sum + trade.notionalQuote,
      0,
    );
    setFeature(
      values,
      enabled,
      'cvd_notional_log_directional',
      Math.sign(signedNotional) *
        Math.log1p(Math.abs(signedNotional)) *
        direction,
    );
    setFeature(
      values,
      enabled,
      'cvd_ratio_directional',
      totalNotional > 0 ? (signedNotional / totalNotional) * direction : null,
    );
    setFeature(values, enabled, 'trade_count_log', Math.log1p(trades.length));
  }

  if (freshOrderBook !== null) {
    const bestBid = requireArrayElement(
      freshOrderBook.bids,
      0,
      'fresh best bid',
    );
    const bestAsk = requireArrayElement(
      freshOrderBook.asks,
      0,
      'fresh best ask',
    );
    const topSize = bestBid.size + bestAsk.size;
    const midpoint = (bestBid.price + bestAsk.price) / 2;
    setFeature(
      values,
      enabled,
      'book_imbalance_l1_directional',
      topSize > 0
        ? ((bestBid.size - bestAsk.size) / topSize) * direction
        : null,
    );
    const bids = freshOrderBook.bids.slice(0, config.orderBookDepthLevels);
    const asks = freshOrderBook.asks.slice(0, config.orderBookDepthLevels);
    const bidSize = bids.reduce((sum, level) => sum + level.size, 0);
    const askSize = asks.reduce((sum, level) => sum + level.size, 0);
    setFeature(
      values,
      enabled,
      'book_imbalance_depth_directional',
      bidSize + askSize > 0
        ? ((bidSize - askSize) / (bidSize + askSize)) * direction
        : null,
    );
    const microprice =
      (bestAsk.price * bestBid.size + bestBid.price * bestAsk.size) / topSize;
    setFeature(
      values,
      enabled,
      'microprice_offset_directional_bps',
      ((microprice - midpoint) / midpoint) * 10_000 * direction,
    );
    setFeature(
      values,
      enabled,
      'spread_bps',
      ((bestAsk.price - bestBid.price) / midpoint) * 10_000,
    );
  }

  setFeature(
    values,
    enabled,
    'atr_percent',
    averageTrueRangePercent(candles, config.atrPeriod),
  );
  const realized = realizedVolatility(closes, config.realizedVolatilityPeriod);
  setFeature(values, enabled, 'realized_volatility_percent', realized);
  const shortVolatility = realizedVolatility(
    closes,
    config.volatilityShortPeriod,
  );
  const longVolatility = realizedVolatility(
    closes,
    config.volatilityLongPeriod,
  );
  setFeature(
    values,
    enabled,
    'volatility_compression_ratio',
    shortVolatility === null || longVolatility === null || longVolatility === 0
      ? null
      : shortVolatility / longVolatility,
  );
  const volumes = volumeFeatures(candles, config.volumePeriod);
  setFeature(values, enabled, 'relative_volume', volumes.relative);
  setFeature(values, enabled, 'volume_zscore', volumes.zscore);
  const vwap = volumeWeightedAveragePrice(candles, config.vwapPeriod);
  const anchoredVwap = volumeWeightedAveragePrice(
    candles,
    config.anchoredVwapPeriod,
  );
  setFeature(
    values,
    enabled,
    'vwap_distance_directional_percent',
    currentClose === undefined || vwap === null
      ? null
      : ((currentClose - vwap) / vwap) * 100 * direction,
  );
  setFeature(
    values,
    enabled,
    'anchored_vwap_distance_directional_percent',
    currentClose === undefined || anchoredVwap === null
      ? null
      : ((currentClose - anchoredVwap) / anchoredVwap) * 100 * direction,
  );
  const movement = directionalMovement(candles, config.adxPeriod);
  setFeature(values, enabled, 'adx', movement.adx);
  setFeature(
    values,
    enabled,
    'dmi_directional',
    movement.dmi === null ? null : movement.dmi * direction,
  );
  const rsi = relativeStrengthIndex(closes, config.rsiPeriod);
  setFeature(
    values,
    enabled,
    'rsi_directional',
    rsi === null ? null : (rsi - 50) * direction,
  );
  const macd = macdFeatures(
    closes,
    config.macdFastPeriod,
    config.macdSlowPeriod,
    config.macdSignalPeriod,
    config.macdSlopeLookback,
  );
  setFeature(
    values,
    enabled,
    'macd_histogram_directional_percent',
    macd.histogramPercent === null ? null : macd.histogramPercent * direction,
  );
  setFeature(
    values,
    enabled,
    'macd_slope_directional_percent',
    macd.slopePercent === null ? null : macd.slopePercent * direction,
  );
  setFeature(
    values,
    enabled,
    'session_asia',
    isInSession(evidence.detectedAt, config.asiaSession),
  );
  setFeature(
    values,
    enabled,
    'session_london',
    isInSession(evidence.detectedAt, config.londonSession),
  );
  setFeature(
    values,
    enabled,
    'session_new_york',
    isInSession(evidence.detectedAt, config.newYorkSession),
  );
  setFeature(
    values,
    enabled,
    'trend_efficiency_ratio',
    trendEfficiency(closes, config.trendEfficiencyPeriod),
  );
  setFeature(
    values,
    enabled,
    'wall_persistence_seconds',
    snapshot.whale.wallPersistenceMs === null
      ? null
      : snapshot.whale.wallPersistenceMs / 1_000,
  );
  setFeature(values, enabled, 'refill_count', snapshot.whale.refillCount);
  setFeature(
    values,
    enabled,
    'spoof_probability',
    snapshot.whale.spoofProbability,
  );
  setFeature(
    values,
    enabled,
    'absorption_score',
    snapshot.whale.absorptionScore,
  );
  setFeature(values, enabled, 'execution_ratio', snapshot.whale.executionRatio);
  setFeature(
    values,
    enabled,
    'whale_notional_log',
    snapshot.whale.whaleNotionalQuote === null
      ? null
      : Math.log1p(snapshot.whale.whaleNotionalQuote),
  );

  const availableFeatureCount = config.enabledFeatures.reduce(
    (count, name) => count + (values[name] === null ? 0 : 1),
    0,
  );
  const missingFeatureCount =
    config.enabledFeatures.length - availableFeatureCount;
  const frozenValues: AlphaFeatureValueMap = Object.freeze(values);
  if (Object.keys(frozenValues).length !== ALPHA_FEATURE_NAMES.length) {
    throw new Error('Internal alpha feature schema is incomplete');
  }
  return Object.freeze({
    alertId: evidence.alertId,
    instrumentId: evidence.instrumentId,
    detectedAt: evidence.detectedAt,
    direction: evidence.direction,
    values: frozenValues,
    availableFeatureCount,
    missingFeatureCount,
    synthetic: snapshot.synthetic,
  });
};
