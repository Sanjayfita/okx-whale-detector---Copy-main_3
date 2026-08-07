import {
  tradingStrategyConfig,
  type TradingStrategyConfig,
  validateTradingStrategyConfig,
} from '../config/tradingStrategyConfig';

export type TradeDirection = 'LONG' | 'SHORT';

export interface EmaTrendCandle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly confirm: boolean;
}

export interface EmaTrendOpenPosition {
  readonly direction: TradeDirection;
  readonly openedAt: number;
  readonly entryPrice: number;
  readonly stopLossPrice: number;
  readonly takeProfitPrice: number;
}

export type EmaTrendAction =
  | 'ENTER_LONG'
  | 'ENTER_SHORT'
  | 'EXIT_LONG'
  | 'EXIT_SHORT'
  | 'HOLD';

export type EmaTrendReason =
  | 'INSUFFICIENT_CONFIRMED_CANDLES'
  | 'LOW_VOLATILITY'
  | 'EXTREME_VOLATILITY'
  | 'NO_EMA_CROSSOVER'
  | 'TREND_FILTER_NOT_CONFIRMED'
  | 'RSI_FILTER_NOT_CONFIRMED'
  | 'LONG_EMA_CROSSOVER_CONFIRMED'
  | 'SHORT_EMA_CROSSOVER_CONFIRMED'
  | 'POSITION_ALREADY_OPEN'
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'TRAILING_STOP'
  | 'OPPOSITE_EMA_CROSSOVER';

export interface EmaTrendIndicators {
  readonly previousFastEma: number;
  readonly currentFastEma: number;
  readonly previousSlowEma: number;
  readonly currentSlowEma: number;
  readonly rsi: number;
  readonly atr: number;
  readonly atrPercent: number;
}

export interface EmaTrendDecision {
  readonly strategyId: 'ema-trend-crossover-v1';
  readonly instrumentId: string;
  readonly observedAt: number | null;
  readonly action: EmaTrendAction;
  readonly direction: TradeDirection | null;
  readonly reasons: readonly EmaTrendReason[];
  readonly indicators: EmaTrendIndicators | null;
  readonly entryPrice: number | null;
  readonly stopLossPrice: number | null;
  readonly takeProfitPrice: number | null;
  readonly trailingStopPrice: number | null;
  readonly riskAmount: number;
  readonly positionSizeBaseUnits: number;
  readonly riskRewardRatio: number | null;
  readonly liveExecutionAllowed: false;
}

const MAX_RISK_PER_TRADE_FRACTION = 0.01;
const LONG_RSI_MINIMUM = 50;
const LONG_RSI_MAXIMUM = 70;
const SHORT_RSI_MINIMUM = 30;
const SHORT_RSI_MAXIMUM = 50;

const requirePositiveFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
};

const validateCandle = (candle: EmaTrendCandle): void => {
  if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp < 0) {
    throw new Error('candle timestamp must be a non-negative safe integer');
  }
  requirePositiveFinite(candle.open, 'candle.open');
  requirePositiveFinite(candle.high, 'candle.high');
  requirePositiveFinite(candle.low, 'candle.low');
  requirePositiveFinite(candle.close, 'candle.close');
  if (candle.high < Math.max(candle.open, candle.close)) {
    throw new Error('candle.high must cover open and close');
  }
  if (candle.low > Math.min(candle.open, candle.close)) {
    throw new Error('candle.low must cover open and close');
  }
};

const confirmedCandles = (
  candles: readonly EmaTrendCandle[],
): readonly EmaTrendCandle[] => {
  const ordered = candles
    .filter((candle) => candle.confirm)
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp);

  for (const candle of ordered) {
    validateCandle(candle);
  }
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]?.timestamp === ordered[index - 1]?.timestamp) {
      throw new Error('confirmed candles must not contain duplicate timestamps');
    }
  }
  return ordered;
};

const average = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const emaSeries = (
  values: readonly number[],
  period: number,
): readonly (number | null)[] => {
  if (values.length < period) {
    return values.map(() => null);
  }

  const result: Array<number | null> = values.map(() => null);
  const multiplier = 2 / (period + 1);
  let ema = average(values.slice(0, period));
  result[period - 1] = ema;

  for (let index = period; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      continue;
    }
    ema = (value - ema) * multiplier + ema;
    result[index] = ema;
  }
  return result;
};

const calculateRsi = (values: readonly number[], period: number): number => {
  if (values.length < period + 1) {
    throw new Error('RSI requires period + 1 closes');
  }

  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const current = values[index];
    const previous = values[index - 1];
    if (current === undefined || previous === undefined) {
      continue;
    }
    const change = current - previous;
    averageGain += Math.max(0, change);
    averageLoss += Math.max(0, -change);
  }
  averageGain /= period;
  averageLoss /= period;

  for (let index = period + 1; index < values.length; index += 1) {
    const current = values[index];
    const previous = values[index - 1];
    if (current === undefined || previous === undefined) {
      continue;
    }
    const change = current - previous;
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageGain === 0 && averageLoss === 0) {
    return 50;
  }
  if (averageLoss === 0) {
    return 100;
  }
  if (averageGain === 0) {
    return 0;
  }
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
};

const trueRange = (
  candle: EmaTrendCandle,
  previousClose: number,
): number =>
  Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose),
  );

const calculateAtr = (
  candles: readonly EmaTrendCandle[],
  period: number,
): number => {
  if (candles.length < period + 1) {
    throw new Error('ATR requires period + 1 confirmed candles');
  }

  const ranges: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (current !== undefined && previous !== undefined) {
      ranges.push(trueRange(current, previous.close));
    }
  }

  let atr = average(ranges.slice(0, period));
  for (let index = period; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (range !== undefined) {
      atr = (atr * (period - 1) + range) / period;
    }
  }
  return atr;
};

const buildIndicators = (input: {
  readonly candles: readonly EmaTrendCandle[];
  readonly config: TradingStrategyConfig;
}): EmaTrendIndicators | null => {
  const requiredCandles = Math.max(
    input.config.slowEmaLength + 1,
    input.config.rsiPeriod + 1,
    input.config.atrPeriod + 1,
  );
  if (input.candles.length < requiredCandles) {
    return null;
  }

  const closes = input.candles.map((candle) => candle.close);
  const fast = emaSeries(closes, input.config.fastEmaLength);
  const slow = emaSeries(closes, input.config.slowEmaLength);
  const currentIndex = closes.length - 1;
  const previousIndex = currentIndex - 1;
  const previousFastEma = fast[previousIndex];
  const currentFastEma = fast[currentIndex];
  const previousSlowEma = slow[previousIndex];
  const currentSlowEma = slow[currentIndex];

  if (
    previousFastEma === null ||
    currentFastEma === null ||
    previousSlowEma === null ||
    currentSlowEma === null ||
    previousFastEma === undefined ||
    currentFastEma === undefined ||
    previousSlowEma === undefined ||
    currentSlowEma === undefined
  ) {
    return null;
  }

  const atr = calculateAtr(input.candles, input.config.atrPeriod);
  const latest = input.candles[currentIndex];
  if (latest === undefined) {
    return null;
  }

  return {
    previousFastEma,
    currentFastEma,
    previousSlowEma,
    currentSlowEma,
    rsi: calculateRsi(closes, input.config.rsiPeriod),
    atr,
    atrPercent: (atr / latest.close) * 100,
  };
};

const holdDecision = (input: {
  readonly instrumentId: string;
  readonly observedAt: number | null;
  readonly reasons: readonly EmaTrendReason[];
  readonly indicators: EmaTrendIndicators | null;
  readonly direction?: TradeDirection | null;
  readonly trailingStopPrice?: number | null;
}): EmaTrendDecision => ({
  strategyId: 'ema-trend-crossover-v1',
  instrumentId: input.instrumentId,
  observedAt: input.observedAt,
  action: 'HOLD',
  direction: input.direction ?? null,
  reasons: input.reasons,
  indicators: input.indicators,
  entryPrice: null,
  stopLossPrice: null,
  takeProfitPrice: null,
  trailingStopPrice: input.trailingStopPrice ?? null,
  riskAmount: 0,
  positionSizeBaseUnits: 0,
  riskRewardRatio: null,
  liveExecutionAllowed: false,
});

const crossoverDirection = (
  indicators: EmaTrendIndicators,
): TradeDirection | null => {
  if (
    indicators.previousFastEma <= indicators.previousSlowEma &&
    indicators.currentFastEma > indicators.currentSlowEma
  ) {
    return 'LONG';
  }
  if (
    indicators.previousFastEma >= indicators.previousSlowEma &&
    indicators.currentFastEma < indicators.currentSlowEma
  ) {
    return 'SHORT';
  }
  return null;
};

const calculateTrailingStop = (input: {
  readonly position: EmaTrendOpenPosition;
  readonly candles: readonly EmaTrendCandle[];
  readonly config: TradingStrategyConfig;
}): number | null => {
  if (!input.config.trailingStopEnabled) {
    return null;
  }
  const positionCandles = input.candles.filter(
    (candle) => candle.timestamp >= input.position.openedAt,
  );
  if (positionCandles.length === 0) {
    return null;
  }

  if (input.position.direction === 'LONG') {
    const highest = Math.max(
      input.position.entryPrice,
      ...positionCandles.map((candle) => candle.high),
    );
    const candidate = highest * (1 - input.config.trailingStopPercent / 100);
    return candidate > input.position.stopLossPrice ? candidate : null;
  }

  const lowest = Math.min(
    input.position.entryPrice,
    ...positionCandles.map((candle) => candle.low),
  );
  const candidate = lowest * (1 + input.config.trailingStopPercent / 100);
  return candidate < input.position.stopLossPrice ? candidate : null;
};

const exitDecision = (input: {
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly position: EmaTrendOpenPosition;
  readonly reason: EmaTrendReason;
  readonly indicators: EmaTrendIndicators | null;
  readonly trailingStopPrice: number | null;
}): EmaTrendDecision => ({
  strategyId: 'ema-trend-crossover-v1',
  instrumentId: input.instrumentId,
  observedAt: input.observedAt,
  action: input.position.direction === 'LONG' ? 'EXIT_LONG' : 'EXIT_SHORT',
  direction: input.position.direction,
  reasons: [input.reason],
  indicators: input.indicators,
  entryPrice: input.position.entryPrice,
  stopLossPrice: input.position.stopLossPrice,
  takeProfitPrice: input.position.takeProfitPrice,
  trailingStopPrice: input.trailingStopPrice,
  riskAmount: 0,
  positionSizeBaseUnits: 0,
  riskRewardRatio: null,
  liveExecutionAllowed: false,
});

const evaluateOpenPosition = (input: {
  readonly instrumentId: string;
  readonly position: EmaTrendOpenPosition;
  readonly candles: readonly EmaTrendCandle[];
  readonly indicators: EmaTrendIndicators | null;
  readonly config: TradingStrategyConfig;
}): EmaTrendDecision => {
  requirePositiveFinite(input.position.entryPrice, 'position.entryPrice');
  requirePositiveFinite(input.position.stopLossPrice, 'position.stopLossPrice');
  requirePositiveFinite(input.position.takeProfitPrice, 'position.takeProfitPrice');
  if (!Number.isSafeInteger(input.position.openedAt) || input.position.openedAt < 0) {
    throw new Error('position.openedAt must be a non-negative safe integer');
  }

  const latest = input.candles[input.candles.length - 1];
  if (latest === undefined) {
    return holdDecision({
      instrumentId: input.instrumentId,
      observedAt: null,
      reasons: ['POSITION_ALREADY_OPEN'],
      indicators: input.indicators,
      direction: input.position.direction,
    });
  }

  const trailingStopPrice = calculateTrailingStop({
    position: input.position,
    candles: input.candles,
    config: input.config,
  });

  // Intrabar stop is checked before target. When both are touched in one candle,
  // the conservative assumption prevents optimistic backtest ordering.
  if (input.position.direction === 'LONG') {
    if (latest.low <= input.position.stopLossPrice) {
      return exitDecision({
        instrumentId: input.instrumentId,
        observedAt: latest.timestamp,
        position: input.position,
        reason: 'STOP_LOSS',
        indicators: input.indicators,
        trailingStopPrice,
      });
    }
    if (latest.high >= input.position.takeProfitPrice) {
      return exitDecision({
        instrumentId: input.instrumentId,
        observedAt: latest.timestamp,
        position: input.position,
        reason: 'TAKE_PROFIT',
        indicators: input.indicators,
        trailingStopPrice,
      });
    }
    if (trailingStopPrice !== null && latest.low <= trailingStopPrice) {
      return exitDecision({
        instrumentId: input.instrumentId,
        observedAt: latest.timestamp,
        position: input.position,
        reason: 'TRAILING_STOP',
        indicators: input.indicators,
        trailingStopPrice,
      });
    }
  } else {
    if (latest.high >= input.position.stopLossPrice) {
      return exitDecision({
        instrumentId: input.instrumentId,
        observedAt: latest.timestamp,
        position: input.position,
        reason: 'STOP_LOSS',
        indicators: input.indicators,
        trailingStopPrice,
      });
    }
    if (latest.low <= input.position.takeProfitPrice) {
      return exitDecision({
        instrumentId: input.instrumentId,
        observedAt: latest.timestamp,
        position: input.position,
        reason: 'TAKE_PROFIT',
        indicators: input.indicators,
        trailingStopPrice,
      });
    }
    if (trailingStopPrice !== null && latest.high >= trailingStopPrice) {
      return exitDecision({
        instrumentId: input.instrumentId,
        observedAt: latest.timestamp,
        position: input.position,
        reason: 'TRAILING_STOP',
        indicators: input.indicators,
        trailingStopPrice,
      });
    }
  }

  if (
    input.indicators !== null &&
    crossoverDirection(input.indicators) !== null &&
    crossoverDirection(input.indicators) !== input.position.direction
  ) {
    return exitDecision({
      instrumentId: input.instrumentId,
      observedAt: latest.timestamp,
      position: input.position,
      reason: 'OPPOSITE_EMA_CROSSOVER',
      indicators: input.indicators,
      trailingStopPrice,
    });
  }

  return holdDecision({
    instrumentId: input.instrumentId,
    observedAt: latest.timestamp,
    reasons: ['POSITION_ALREADY_OPEN'],
    indicators: input.indicators,
    direction: input.position.direction,
    trailingStopPrice,
  });
};

export const evaluateEmaTrendStrategy = (input: {
  readonly instrumentId: string;
  readonly candles: readonly EmaTrendCandle[];
  readonly accountEquity: number;
  readonly openPosition?: EmaTrendOpenPosition | null;
  readonly config?: TradingStrategyConfig;
}): EmaTrendDecision => {
  if (input.instrumentId.trim().length === 0) {
    throw new Error('instrumentId must not be empty');
  }
  requirePositiveFinite(input.accountEquity, 'accountEquity');

  const config = input.config ?? tradingStrategyConfig;
  validateTradingStrategyConfig(config);
  const candles = confirmedCandles(input.candles);
  const latest = candles[candles.length - 1];
  const indicators = buildIndicators({ candles, config });

  if (input.openPosition !== undefined && input.openPosition !== null) {
    return evaluateOpenPosition({
      instrumentId: input.instrumentId,
      position: input.openPosition,
      candles,
      indicators,
      config,
    });
  }

  if (latest === undefined || indicators === null) {
    return holdDecision({
      instrumentId: input.instrumentId,
      observedAt: latest?.timestamp ?? null,
      reasons: ['INSUFFICIENT_CONFIRMED_CANDLES'],
      indicators,
    });
  }

  if (indicators.atrPercent < config.minimumAtrPercent) {
    return holdDecision({
      instrumentId: input.instrumentId,
      observedAt: latest.timestamp,
      reasons: ['LOW_VOLATILITY'],
      indicators,
    });
  }
  if (indicators.atrPercent > config.maximumAtrPercent) {
    return holdDecision({
      instrumentId: input.instrumentId,
      observedAt: latest.timestamp,
      reasons: ['EXTREME_VOLATILITY'],
      indicators,
    });
  }

  const direction = crossoverDirection(indicators);
  if (direction === null) {
    return holdDecision({
      instrumentId: input.instrumentId,
      observedAt: latest.timestamp,
      reasons: ['NO_EMA_CROSSOVER'],
      indicators,
    });
  }

  // A crossover alone is noisy. The slow EMA slope and price location must agree
  // with the proposed direction before a trade can be considered.
  const trendConfirmed =
    direction === 'LONG'
      ? latest.close > indicators.currentSlowEma &&
        indicators.currentSlowEma > indicators.previousSlowEma
      : latest.close < indicators.currentSlowEma &&
        indicators.currentSlowEma < indicators.previousSlowEma;
  if (!trendConfirmed) {
    return holdDecision({
      instrumentId: input.instrumentId,
      observedAt: latest.timestamp,
      reasons: ['TREND_FILTER_NOT_CONFIRMED'],
      indicators,
    });
  }

  // RSI only confirms momentum. Standard neutral/overextended bands reduce entries
  // that fight momentum or chase an already stretched move.
  const rsiConfirmed =
    direction === 'LONG'
      ? indicators.rsi >= LONG_RSI_MINIMUM &&
        indicators.rsi <= LONG_RSI_MAXIMUM
      : indicators.rsi >= SHORT_RSI_MINIMUM &&
        indicators.rsi <= SHORT_RSI_MAXIMUM;
  if (!rsiConfirmed) {
    return holdDecision({
      instrumentId: input.instrumentId,
      observedAt: latest.timestamp,
      reasons: ['RSI_FILTER_NOT_CONFIRMED'],
      indicators,
    });
  }

  const entryPrice = latest.close;
  const percentageStopDistance = entryPrice * (config.stopLossPercent / 100);
  const atrStopDistance = indicators.atr * config.atrMultiplier;
  const stopDistance = Math.max(percentageStopDistance, atrStopDistance);
  const configuredTargetDistance =
    entryPrice * (config.takeProfitPercent / 100);
  const targetDistance = Math.max(configuredTargetDistance, stopDistance * 2);
  const riskRewardRatio = targetDistance / stopDistance;
  const riskAmount = input.accountEquity * MAX_RISK_PER_TRADE_FRACTION;
  const positionSizeBaseUnits = riskAmount / stopDistance;
  const stopLossPrice =
    direction === 'LONG' ? entryPrice - stopDistance : entryPrice + stopDistance;
  const takeProfitPrice =
    direction === 'LONG'
      ? entryPrice + targetDistance
      : entryPrice - targetDistance;

  return {
    strategyId: 'ema-trend-crossover-v1',
    instrumentId: input.instrumentId,
    observedAt: latest.timestamp,
    action: direction === 'LONG' ? 'ENTER_LONG' : 'ENTER_SHORT',
    direction,
    reasons: [
      direction === 'LONG'
        ? 'LONG_EMA_CROSSOVER_CONFIRMED'
        : 'SHORT_EMA_CROSSOVER_CONFIRMED',
    ],
    indicators,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
    trailingStopPrice: null,
    riskAmount,
    positionSizeBaseUnits,
    riskRewardRatio,
    liveExecutionAllowed: false,
  };
};
