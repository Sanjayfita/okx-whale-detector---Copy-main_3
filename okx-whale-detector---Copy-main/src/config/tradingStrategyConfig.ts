export interface TradingStrategyConfig {
  /** Fast EMA used to detect the crossover trigger. */
  readonly fastEmaLength: number;
  /** Slow EMA defines the broader trend and must be longer than the fast EMA. */
  readonly slowEmaLength: number;
  /** RSI is used as a simple momentum confirmation, not as a standalone signal. */
  readonly rsiPeriod: number;
  /** ATR supplies the volatility filter and dynamic stop component. */
  readonly atrPeriod: number;
  /** ATR multiple used when volatility requires a wider protective stop. */
  readonly atrMultiplier: number;
  /** Trades are skipped below this ATR percentage because conditions are too quiet. */
  readonly minimumAtrPercent: number;
  /** Extreme volatility is also skipped because fills and stops become unreliable. */
  readonly maximumAtrPercent: number;
  /** Minimum configured stop distance from entry. The ATR stop may be wider. */
  readonly stopLossPercent: number;
  /** Minimum configured take-profit distance. Runtime logic always enforces at least 2R. */
  readonly takeProfitPercent: number;
  /** Enables an optional trailing stop after a position has moved favorably. */
  readonly trailingStopEnabled: boolean;
  /** Percentage trail from the highest/lowest price reached after entry. */
  readonly trailingStopPercent: number;
}

export const tradingStrategyConfig: TradingStrategyConfig = Object.freeze({
  fastEmaLength: 20,
  slowEmaLength: 50,
  rsiPeriod: 14,
  atrPeriod: 14,
  atrMultiplier: 1.5,
  minimumAtrPercent: 0.25,
  maximumAtrPercent: 5,
  stopLossPercent: 1,
  takeProfitPercent: 2,
  trailingStopEnabled: true,
  trailingStopPercent: 1,
});

const requirePositiveFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
};

const requirePositiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 1) {
    throw new Error(`${name} must be an integer greater than 1`);
  }
};

export const validateTradingStrategyConfig = (
  config: TradingStrategyConfig,
): void => {
  requirePositiveInteger(config.fastEmaLength, 'fastEmaLength');
  requirePositiveInteger(config.slowEmaLength, 'slowEmaLength');
  requirePositiveInteger(config.rsiPeriod, 'rsiPeriod');
  requirePositiveInteger(config.atrPeriod, 'atrPeriod');
  requirePositiveFinite(config.atrMultiplier, 'atrMultiplier');
  requirePositiveFinite(config.minimumAtrPercent, 'minimumAtrPercent');
  requirePositiveFinite(config.maximumAtrPercent, 'maximumAtrPercent');
  requirePositiveFinite(config.stopLossPercent, 'stopLossPercent');
  requirePositiveFinite(config.takeProfitPercent, 'takeProfitPercent');
  requirePositiveFinite(config.trailingStopPercent, 'trailingStopPercent');

  if (config.fastEmaLength >= config.slowEmaLength) {
    throw new Error('fastEmaLength must be shorter than slowEmaLength');
  }
  if (config.minimumAtrPercent >= config.maximumAtrPercent) {
    throw new Error('minimumAtrPercent must be below maximumAtrPercent');
  }
  if (config.takeProfitPercent < config.stopLossPercent * 2) {
    throw new Error('takeProfitPercent must be at least 2x stopLossPercent');
  }
  if (typeof config.trailingStopEnabled !== 'boolean') {
    throw new Error('trailingStopEnabled must be a boolean');
  }
};
