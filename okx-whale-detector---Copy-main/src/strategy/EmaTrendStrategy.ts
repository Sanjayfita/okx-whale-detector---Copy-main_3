import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import {
  emaTrendStrategyConfig,
  type EmaTrendStrategyConfig,
  validateEmaTrendStrategyConfig,
} from '../config/strategyConfig';

export type EmaTrendDirection = 'LONG' | 'SHORT';

export type EmaTrendEntryRejectionReason =
  | 'INSUFFICIENT_CONFIRMED_CANDLES'
  | 'MIXED_INSTRUMENT_HISTORY'
  | 'NON_CHRONOLOGICAL_HISTORY'
  | 'INVALID_ACCOUNT_EQUITY'
  | 'LOW_VOLATILITY'
  | 'NO_FRESH_EMA_CROSSOVER'
  | 'TREND_FILTER_NOT_CONFIRMED'
  | 'RSI_FILTER_NOT_CONFIRMED'
  | 'POSITION_ALREADY_OPEN_FOR_INSTRUMENT'
  | 'SAME_DIRECTION_POSITION_ALREADY_OPEN';

export type EmaTrendExitReason =
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'TRAILING_STOP'
  | 'OPPOSITE_EMA_CROSSOVER';

export interface EmaTrendOpenPositionSummary {
  readonly instrumentId: string;
  readonly direction: EmaTrendDirection;
}

export interface EmaTrendIndicators {
  readonly fastEma: number;
  readonly slowEma: number;
  readonly previousFastEma: number;
  readonly previousSlowEma: number;
  readonly slowEmaSlopePercent: number;
  readonly rsi: number;
  readonly atr: number;
  readonly atrPercent: number;
}

export interface EmaTrendTradePlan {
  readonly direction: EmaTrendDirection;
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly takeProfitPrice: number;
  readonly trailingStopPrice: number | null;
  readonly stopDistancePercent: number;
  readonly takeProfitDistancePercent: number;
  readonly rewardRiskRatio: number;
  readonly riskPercent: 1;
  readonly riskAmountQuote: number;
  readonly notionalQuote: number;
  readonly baseQuantity: number;
}

export interface EmaTrendEntryDecision {
  readonly strategyId: 'ema-trend-v1';
  readonly strategyVersion: 1;
  readonly instrumentId: string | null;
  readonly observedAt: number | null;
  readonly status: 'SIGNAL' | 'NO_SIGNAL' | 'REJECTED';
  readonly direction: EmaTrendDirection | null;
  readonly reasons: readonly EmaTrendEntryRejectionReason[];
  readonly indicators: EmaTrendIndicators | null;
  readonly tradePlan: EmaTrendTradePlan | null;
  readonly liveExecutionAllowed: false;
}

export interface EmaTrendPositionState extends EmaTrendTradePlan {
  readonly instrumentId: string;
  readonly openedAt: number;
  readonly highestPriceSinceEntry: number;
  readonly lowestPriceSinceEntry: number;
}

export interface EmaTrendExitDecision {
  readonly status: 'HOLD' | 'EXIT';
  readonly reason: EmaTrendExitReason | null;
  readonly exitPrice: number | null;
  readonly position: EmaTrendPositionState;
  readonly liveExecutionAllowed: false;
}

const requirePositiveFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
};

const confirmedCandles = (candles: readonly OKXCandle[]): readonly OKXCandle[] =>
  candles.filter((candle) => candle.confirm);

const minimumRequiredCandles = (config: EmaTrendStrategyConfig): number =>
  Math.max(
    config.slowEmaPeriod + config.trendSlopeLookback,
    config.rsiPeriod + 1,
    config.atrPeriod + 1,
  );

const validateHistory = (
  candles: readonly OKXCandle[],
): EmaTrendEntryRejectionReason[] => {
  if (candles.length === 0) {
    return [];
  }

  const instrumentId = candles[0]?.instId;
  const reasons: EmaTrendEntryRejectionReason[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;

    requirePositiveFinite(candle.open, 'candle.open');
    requirePositiveFinite(candle.high, 'candle.high');
    requirePositiveFinite(candle.low, 'candle.low');
    requirePositiveFinite(candle.close, 'candle.close');

    if (candle.instId !== instrumentId) {
      reasons.push('MIXED_INSTRUMENT_HISTORY');
      break;
    }

    const previous = candles[index - 1];
    if (previous && candle.timestamp <= previous.timestamp) {
      reasons.push('NON_CHRONOLOGICAL_HISTORY');
      break;
    }
  }

  return reasons;
};

const calculateEmaSeries = (
  values: readonly number[],
  period: number,
): readonly (number | null)[] => {
  const result: (number | null)[] = Array.from({ length: values.length }, () => null);
  if (values.length < period) return result;

  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = seed;

  const multiplier = 2 / (period + 1);
  let previous = seed;
  for (let index = period; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    const current = (value - previous) * multiplier + previous;
    result[index] = current;
    previous = current;
  }

  return result;
};

const calculateRsiSeries = (
  values: readonly number[],
  period: number,
): readonly (number | null)[] => {
  const result: (number | null)[] = Array.from({ length: values.length }, () => null);
  if (values.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let index = 1; index <= period; index += 1) {
    const current = values[index];
    const previous = values[index - 1];
    if (current === undefined || previous === undefined) continue;
    const change = current - previous;
    gainSum += Math.max(0, change);
    lossSum += Math.max(0, -change);
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;

  const toRsi = (gain: number, loss: number): number => {
    if (gain === 0 && loss === 0) return 50;
    if (loss === 0) return 100;
    const relativeStrength = gain / loss;
    return 100 - 100 / (1 + relativeStrength);
  };

  result[period] = toRsi(averageGain, averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const current = values[index];
    const previous = values[index - 1];
    if (current === undefined || previous === undefined) continue;
    const change = current - previous;
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    result[index] = toRsi(averageGain, averageLoss);
  }

  return result;
};

const calculateAtrSeries = (
  candles: readonly OKXCandle[],
  period: number,
): readonly (number | null)[] => {
  const result: (number | null)[] = Array.from({ length: candles.length }, () => null);
  if (candles.length < period) return result;

  const trueRanges = candles.map((candle, index) => {
    const previousClose = candles[index - 1]?.close;
    if (previousClose === undefined) {
      return candle.high - candle.low;
    }
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });

  const seed =
    trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = seed;

  let previousAtr = seed;
  for (let index = period; index < trueRanges.length; index += 1) {
    const trueRange = trueRanges[index];
    if (trueRange === undefined) continue;
    const atr = (previousAtr * (period - 1) + trueRange) / period;
    result[index] = atr;
    previousAtr = atr;
  }

  return result;
};

const indicatorsFromHistory = (
  candles: readonly OKXCandle[],
  config: EmaTrendStrategyConfig,
): EmaTrendIndicators | null => {
  const closes = candles.map((candle) => candle.close);
  const fast = calculateEmaSeries(closes, config.fastEmaPeriod);
  const slow = calculateEmaSeries(closes, config.slowEmaPeriod);
  const rsi = calculateRsiSeries(closes, config.rsiPeriod);
  const atr = calculateAtrSeries(candles, config.atrPeriod);

  const currentIndex = candles.length - 1;
  const previousIndex = currentIndex - 1;
  const slopeReferenceIndex = currentIndex - config.trendSlopeLookback;
  const fastEma = fast[currentIndex];
  const slowEma = slow[currentIndex];
  const previousFastEma = fast[previousIndex];
  const previousSlowEma = slow[previousIndex];
  const slopeReferenceSlowEma = slow[slopeReferenceIndex];
  const currentRsi = rsi[currentIndex];
  const currentAtr = atr[currentIndex];
  const currentClose = candles[currentIndex]?.close;

  if (
    fastEma === null ||
    fastEma === undefined ||
    slowEma === null ||
    slowEma === undefined ||
    previousFastEma === null ||
    previousFastEma === undefined ||
    previousSlowEma === null ||
    previousSlowEma === undefined ||
    slopeReferenceSlowEma === null ||
    slopeReferenceSlowEma === undefined ||
    currentRsi === null ||
    currentRsi === undefined ||
    currentAtr === null ||
    currentAtr === undefined ||
    currentClose === undefined
  ) {
    return null;
  }

  return Object.freeze({
    fastEma,
    slowEma,
    previousFastEma,
    previousSlowEma,
    slowEmaSlopePercent:
      ((slowEma - slopeReferenceSlowEma) / slopeReferenceSlowEma) * 100,
    rsi: currentRsi,
    atr: currentAtr,
    atrPercent: (currentAtr / currentClose) * 100,
  });
};

const createNoEntryDecision = (input: {
  readonly candles: readonly OKXCandle[];
  readonly status: 'NO_SIGNAL' | 'REJECTED';
  readonly direction?: EmaTrendDirection | null;
  readonly reasons: readonly EmaTrendEntryRejectionReason[];
  readonly indicators?: EmaTrendIndicators | null;
}): EmaTrendEntryDecision => {
  const latest = input.candles[input.candles.length - 1];
  return Object.freeze({
    strategyId: 'ema-trend-v1' as const,
    strategyVersion: 1 as const,
    instrumentId: latest?.instId ?? null,
    observedAt: latest?.timestamp ?? null,
    status: input.status,
    direction: input.direction ?? null,
    reasons: [...new Set(input.reasons)],
    indicators: input.indicators ?? null,
    tradePlan: null,
    liveExecutionAllowed: false as const,
  });
};

const createTradePlan = (input: {
  readonly direction: EmaTrendDirection;
  readonly entryPrice: number;
  readonly atr: number;
  readonly accountEquity: number;
  readonly config: EmaTrendStrategyConfig;
}): EmaTrendTradePlan => {
  // ATR may widen the stop in volatile markets, but it can never make the stop
  // tighter than the configured percentage floor.
  const atrDistancePercent =
    (input.atr / input.entryPrice) * 100 * input.config.atrMultiplier;
  const stopDistancePercent = Math.max(
    input.config.stopLossPercent,
    atrDistancePercent,
  );

  // The target expands with an ATR-widened stop so the realized plan remains at
  // least 1:2 even when current volatility is above the static configuration.
  const takeProfitDistancePercent = Math.max(
    input.config.takeProfitPercent,
    stopDistancePercent * input.config.minimumRewardRiskRatio,
  );
  const rewardRiskRatio = takeProfitDistancePercent / stopDistancePercent;
  const riskAmountQuote = input.accountEquity * 0.01;

  // Position notional is solved from the stop distance: a full stop-out should
  // lose approximately one percent of equity before fees/slippage. Existing
  // execution and portfolio layers remain responsible for exchange rounding,
  // leverage, fill quality, and portfolio exposure limits.
  const notionalQuote = riskAmountQuote / (stopDistancePercent / 100);
  const baseQuantity = notionalQuote / input.entryPrice;
  const stopOffset = stopDistancePercent / 100;
  const targetOffset = takeProfitDistancePercent / 100;
  const stopLossPrice =
    input.direction === 'LONG'
      ? input.entryPrice * (1 - stopOffset)
      : input.entryPrice * (1 + stopOffset);
  const takeProfitPrice =
    input.direction === 'LONG'
      ? input.entryPrice * (1 + targetOffset)
      : input.entryPrice * (1 - targetOffset);

  let trailingStopPrice: number | null = null;
  if (input.config.trailingStop.enabled) {
    const trailingDistance =
      input.atr * input.config.trailingStop.atrMultiplier;
    const rawTrailing =
      input.direction === 'LONG'
        ? input.entryPrice - trailingDistance
        : input.entryPrice + trailingDistance;

    // A trailing stop must never widen the original risk budget.
    trailingStopPrice =
      input.direction === 'LONG'
        ? Math.max(stopLossPrice, rawTrailing)
        : Math.min(stopLossPrice, rawTrailing);
  }

  return Object.freeze({
    direction: input.direction,
    entryPrice: input.entryPrice,
    stopLossPrice,
    takeProfitPrice,
    trailingStopPrice,
    stopDistancePercent,
    takeProfitDistancePercent,
    rewardRiskRatio,
    riskPercent: 1 as const,
    riskAmountQuote,
    notionalQuote,
    baseQuantity,
  });
};

/**
 * Primary entry logic replacing whale/order-book-based trading entries.
 *
 * Entry rules are deliberately few and explicit:
 * 1. use confirmed candles only;
 * 2. require a fresh EMA crossover rather than a persistent EMA relationship;
 * 3. require price and the slow-EMA slope to agree with the crossover;
 * 4. require RSI to confirm momentum without chasing an extreme;
 * 5. reject low ATR environments;
 * 6. reject duplicate instrument exposure or any second position in the same
 *    direction;
 * 7. size the trade so the planned stop risks one percent of equity.
 */
export const evaluateEmaTrendEntry = (input: {
  readonly candles: readonly OKXCandle[];
  readonly accountEquity: number;
  readonly openPositions?: readonly EmaTrendOpenPositionSummary[];
  readonly config?: EmaTrendStrategyConfig;
}): EmaTrendEntryDecision => {
  const config = input.config ?? emaTrendStrategyConfig;
  validateEmaTrendStrategyConfig(config);

  const candles = confirmedCandles(input.candles);
  const historyReasons = validateHistory(candles);
  if (historyReasons.length > 0) {
    return createNoEntryDecision({
      candles,
      status: 'REJECTED',
      reasons: historyReasons,
    });
  }

  if (candles.length < minimumRequiredCandles(config)) {
    return createNoEntryDecision({
      candles,
      status: 'NO_SIGNAL',
      reasons: ['INSUFFICIENT_CONFIRMED_CANDLES'],
    });
  }

  if (!Number.isFinite(input.accountEquity) || input.accountEquity <= 0) {
    return createNoEntryDecision({
      candles,
      status: 'REJECTED',
      reasons: ['INVALID_ACCOUNT_EQUITY'],
    });
  }

  const indicators = indicatorsFromHistory(candles, config);
  if (indicators === null) {
    return createNoEntryDecision({
      candles,
      status: 'NO_SIGNAL',
      reasons: ['INSUFFICIENT_CONFIRMED_CANDLES'],
    });
  }

  if (indicators.atrPercent < config.minimumAtrPercent) {
    return createNoEntryDecision({
      candles,
      status: 'NO_SIGNAL',
      reasons: ['LOW_VOLATILITY'],
      indicators,
    });
  }

  const bullishCross =
    indicators.previousFastEma <= indicators.previousSlowEma &&
    indicators.fastEma > indicators.slowEma;
  const bearishCross =
    indicators.previousFastEma >= indicators.previousSlowEma &&
    indicators.fastEma < indicators.slowEma;

  if (!bullishCross && !bearishCross) {
    return createNoEntryDecision({
      candles,
      status: 'NO_SIGNAL',
      reasons: ['NO_FRESH_EMA_CROSSOVER'],
      indicators,
    });
  }

  const direction: EmaTrendDirection = bullishCross ? 'LONG' : 'SHORT';
  const latest = candles[candles.length - 1];
  if (!latest) {
    return createNoEntryDecision({
      candles,
      status: 'NO_SIGNAL',
      reasons: ['INSUFFICIENT_CONFIRMED_CANDLES'],
      indicators,
    });
  }

  // The trend filter prevents taking a crossover that disagrees with both price
  // location and the direction of the slower EMA.
  const trendConfirmed =
    direction === 'LONG'
      ? latest.close > indicators.slowEma && indicators.slowEmaSlopePercent > 0
      : latest.close < indicators.slowEma && indicators.slowEmaSlopePercent < 0;
  if (!trendConfirmed) {
    return createNoEntryDecision({
      candles,
      status: 'NO_SIGNAL',
      direction,
      reasons: ['TREND_FILTER_NOT_CONFIRMED'],
      indicators,
    });
  }

  // RSI is a confirmation filter only; it is not used as a standalone signal.
  const rsiConfirmed =
    direction === 'LONG'
      ? indicators.rsi >= config.longRsiMinimum &&
        indicators.rsi <= config.longRsiMaximum
      : indicators.rsi >= config.shortRsiMinimum &&
        indicators.rsi <= config.shortRsiMaximum;
  if (!rsiConfirmed) {
    return createNoEntryDecision({
      candles,
      status: 'NO_SIGNAL',
      direction,
      reasons: ['RSI_FILTER_NOT_CONFIRMED'],
      indicators,
    });
  }

  const openPositions = input.openPositions ?? [];
  if (openPositions.some((position) => position.instrumentId === latest.instId)) {
    return createNoEntryDecision({
      candles,
      status: 'REJECTED',
      direction,
      reasons: ['POSITION_ALREADY_OPEN_FOR_INSTRUMENT'],
      indicators,
    });
  }
  if (openPositions.some((position) => position.direction === direction)) {
    return createNoEntryDecision({
      candles,
      status: 'REJECTED',
      direction,
      reasons: ['SAME_DIRECTION_POSITION_ALREADY_OPEN'],
      indicators,
    });
  }

  const tradePlan = createTradePlan({
    direction,
    entryPrice: latest.close,
    atr: indicators.atr,
    accountEquity: input.accountEquity,
    config,
  });

  return Object.freeze({
    strategyId: 'ema-trend-v1' as const,
    strategyVersion: 1 as const,
    instrumentId: latest.instId,
    observedAt: latest.timestamp,
    status: 'SIGNAL' as const,
    direction,
    reasons: [],
    indicators,
    tradePlan,
    liveExecutionAllowed: false as const,
  });
};

export const createEmaTrendPositionState = (input: {
  readonly decision: EmaTrendEntryDecision;
  readonly openedAt?: number;
}): EmaTrendPositionState => {
  const plan = input.decision.tradePlan;
  if (
    input.decision.status !== 'SIGNAL' ||
    input.decision.instrumentId === null ||
    input.decision.observedAt === null ||
    plan === null
  ) {
    throw new Error('A SIGNAL decision with a trade plan is required');
  }

  return Object.freeze({
    ...plan,
    instrumentId: input.decision.instrumentId,
    openedAt: input.openedAt ?? input.decision.observedAt,
    highestPriceSinceEntry: plan.entryPrice,
    lowestPriceSinceEntry: plan.entryPrice,
  });
};

/**
 * Exit priority is intentionally conservative for OHLC-only evaluation. If a
 * confirmed candle touches both an adverse stop and a favorable target, the
 * stop is assumed to have occurred first because intrabar path ordering is
 * unknown. The trailing stop is ratcheted only after the current candle is
 * evaluated, so the candle cannot use its own future high/low to create a stop
 * that is then claimed to have been hit earlier in the same candle.
 */
export const evaluateEmaTrendExit = (input: {
  readonly position: EmaTrendPositionState;
  readonly candles: readonly OKXCandle[];
  readonly config?: EmaTrendStrategyConfig;
}): EmaTrendExitDecision => {
  const config = input.config ?? emaTrendStrategyConfig;
  validateEmaTrendStrategyConfig(config);
  const candles = confirmedCandles(input.candles);
  const historyReasons = validateHistory(candles);
  if (historyReasons.length > 0) {
    throw new Error(`Invalid candle history: ${historyReasons.join(',')}`);
  }
  if (candles.length < minimumRequiredCandles(config)) {
    return Object.freeze({
      status: 'HOLD' as const,
      reason: null,
      exitPrice: null,
      position: input.position,
      liveExecutionAllowed: false as const,
    });
  }

  const latest = candles[candles.length - 1];
  const indicators = indicatorsFromHistory(candles, config);
  if (!latest || indicators === null) {
    return Object.freeze({
      status: 'HOLD' as const,
      reason: null,
      exitPrice: null,
      position: input.position,
      liveExecutionAllowed: false as const,
    });
  }
  if (latest.instId !== input.position.instrumentId) {
    throw new Error('Exit candle instrument does not match the open position');
  }

  const activeStop =
    input.position.trailingStopPrice ?? input.position.stopLossPrice;
  const stopWasTrailing =
    input.position.trailingStopPrice !== null &&
    input.position.trailingStopPrice !== input.position.stopLossPrice;
  const stopHit =
    input.position.direction === 'LONG'
      ? latest.low <= activeStop
      : latest.high >= activeStop;
  if (stopHit) {
    return Object.freeze({
      status: 'EXIT' as const,
      reason: stopWasTrailing ? 'TRAILING_STOP' : 'STOP_LOSS',
      exitPrice: activeStop,
      position: input.position,
      liveExecutionAllowed: false as const,
    });
  }

  const targetHit =
    input.position.direction === 'LONG'
      ? latest.high >= input.position.takeProfitPrice
      : latest.low <= input.position.takeProfitPrice;
  if (targetHit) {
    return Object.freeze({
      status: 'EXIT' as const,
      reason: 'TAKE_PROFIT' as const,
      exitPrice: input.position.takeProfitPrice,
      position: input.position,
      liveExecutionAllowed: false as const,
    });
  }

  const oppositeCross =
    input.position.direction === 'LONG'
      ? indicators.previousFastEma >= indicators.previousSlowEma &&
        indicators.fastEma < indicators.slowEma
      : indicators.previousFastEma <= indicators.previousSlowEma &&
        indicators.fastEma > indicators.slowEma;
  if (oppositeCross) {
    return Object.freeze({
      status: 'EXIT' as const,
      reason: 'OPPOSITE_EMA_CROSSOVER' as const,
      exitPrice: latest.close,
      position: input.position,
      liveExecutionAllowed: false as const,
    });
  }

  const highestPriceSinceEntry = Math.max(
    input.position.highestPriceSinceEntry,
    latest.high,
  );
  const lowestPriceSinceEntry = Math.min(
    input.position.lowestPriceSinceEntry,
    latest.low,
  );
  let trailingStopPrice = input.position.trailingStopPrice;

  if (config.trailingStop.enabled) {
    const trailingDistance = indicators.atr * config.trailingStop.atrMultiplier;
    if (input.position.direction === 'LONG') {
      const candidate = highestPriceSinceEntry - trailingDistance;
      trailingStopPrice = Math.max(
        input.position.stopLossPrice,
        trailingStopPrice ?? input.position.stopLossPrice,
        candidate,
      );
    } else {
      const candidate = lowestPriceSinceEntry + trailingDistance;
      trailingStopPrice = Math.min(
        input.position.stopLossPrice,
        trailingStopPrice ?? input.position.stopLossPrice,
        candidate,
      );
    }
  }

  const updatedPosition: EmaTrendPositionState = Object.freeze({
    ...input.position,
    highestPriceSinceEntry,
    lowestPriceSinceEntry,
    trailingStopPrice,
  });

  return Object.freeze({
    status: 'HOLD' as const,
    reason: null,
    exitPrice: null,
    position: updatedPosition,
    liveExecutionAllowed: false as const,
  });
};
