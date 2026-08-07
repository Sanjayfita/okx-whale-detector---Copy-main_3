export interface EmaTrendStrategyConfig {
  /** Fast EMA used for the crossover trigger. */
  readonly fastEmaPeriod: number;
  /** Slow EMA used for the crossover trigger and trend filter. */
  readonly slowEmaPeriod: number;
  /** Wilder RSI period used to avoid entering against weak momentum. */
  readonly rsiPeriod: number;
  /** Wilder ATR period used for volatility filtering and adaptive stops. */
  readonly atrPeriod: number;
  /** Minimum ATR as a percentage of price. Lower values are treated as low volatility. */
  readonly minimumAtrPercent: number;
  /** ATR multiple used as the adaptive minimum stop distance. */
  readonly atrMultiplier: number;
  /** Configured minimum stop distance as a percentage of entry price. */
  readonly stopLossPercent: number;
  /** Configured minimum take-profit distance as a percentage of entry price. */
  readonly takeProfitPercent: number;
  /** Number of slow-EMA observations used to confirm trend slope. */
  readonly trendSlopeLookback: number;
  /** Long entries require RSI at or above this threshold. */
  readonly longRsiMinimum: number;
  /** Long entries above this RSI are skipped to avoid chasing overextended moves. */
  readonly longRsiMaximum: number;
  /** Short entries below this RSI are skipped to avoid chasing oversold moves. */
  readonly shortRsiMinimum: number;
  /** Short entries require RSI at or below this threshold. */
  readonly shortRsiMaximum: number;
  /** Risk budget is deliberately fixed at one percent by validation. */
  readonly riskPerTradePercent: number;
  /** Reward/risk is deliberately constrained to at least two by validation. */
  readonly minimumRewardRiskRatio: number;
  readonly trailingStop: {
    readonly enabled: boolean;
    /** ATR multiple used to ratchet the trailing stop after entry. */
    readonly atrMultiplier: number;
  };
}

/**
 * Conservative defaults for the primary rules-based strategy.
 *
 * These values are intentionally ordinary rather than backtest-optimized. The
 * objective is to establish a transparent baseline that can later be validated
 * with the repository's existing purged walk-forward and holdout process.
 */
export const emaTrendStrategyConfig: EmaTrendStrategyConfig = Object.freeze({
  fastEmaPeriod: 20,
  slowEmaPeriod: 50,
  rsiPeriod: 14,
  atrPeriod: 14,
  minimumAtrPercent: 0.25,
  atrMultiplier: 1.5,
  stopLossPercent: 1,
  takeProfitPercent: 2,
  trendSlopeLookback: 3,
  longRsiMinimum: 50,
  longRsiMaximum: 70,
  shortRsiMinimum: 30,
  shortRsiMaximum: 50,
  riskPerTradePercent: 1,
  minimumRewardRiskRatio: 2,
  trailingStop: Object.freeze({
    enabled: true,
    atrMultiplier: 1.5,
  }),
});

const requirePositiveInteger = (
  errors: string[],
  path: string,
  value: number,
): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    errors.push(`${path} must be a positive safe integer`);
  }
};

const requirePositiveFinite = (
  errors: string[],
  path: string,
  value: number,
): void => {
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${path} must be a positive finite number`);
  }
};

const requireRsiValue = (
  errors: string[],
  path: string,
  value: number,
): void => {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    errors.push(`${path} must be between 0 and 100`);
  }
};

export const validateEmaTrendStrategyConfig = (
  config: EmaTrendStrategyConfig,
): void => {
  const errors: string[] = [];

  requirePositiveInteger(errors, 'fastEmaPeriod', config.fastEmaPeriod);
  requirePositiveInteger(errors, 'slowEmaPeriod', config.slowEmaPeriod);
  requirePositiveInteger(errors, 'rsiPeriod', config.rsiPeriod);
  requirePositiveInteger(errors, 'atrPeriod', config.atrPeriod);
  requirePositiveInteger(errors, 'trendSlopeLookback', config.trendSlopeLookback);

  if (config.fastEmaPeriod >= config.slowEmaPeriod) {
    errors.push('fastEmaPeriod must be less than slowEmaPeriod');
  }

  requirePositiveFinite(errors, 'minimumAtrPercent', config.minimumAtrPercent);
  requirePositiveFinite(errors, 'atrMultiplier', config.atrMultiplier);
  requirePositiveFinite(errors, 'stopLossPercent', config.stopLossPercent);
  requirePositiveFinite(errors, 'takeProfitPercent', config.takeProfitPercent);
  requirePositiveFinite(
    errors,
    'trailingStop.atrMultiplier',
    config.trailingStop.atrMultiplier,
  );

  requireRsiValue(errors, 'longRsiMinimum', config.longRsiMinimum);
  requireRsiValue(errors, 'longRsiMaximum', config.longRsiMaximum);
  requireRsiValue(errors, 'shortRsiMinimum', config.shortRsiMinimum);
  requireRsiValue(errors, 'shortRsiMaximum', config.shortRsiMaximum);

  if (config.longRsiMinimum >= config.longRsiMaximum) {
    errors.push('longRsiMinimum must be less than longRsiMaximum');
  }
  if (config.shortRsiMinimum >= config.shortRsiMaximum) {
    errors.push('shortRsiMinimum must be less than shortRsiMaximum');
  }
  if (config.longRsiMinimum < 50) {
    errors.push('longRsiMinimum must be at least 50');
  }
  if (config.shortRsiMaximum > 50) {
    errors.push('shortRsiMaximum must be at most 50');
  }

  // One-percent risk is a safety invariant, not an optimization parameter.
  if (config.riskPerTradePercent !== 1) {
    errors.push('riskPerTradePercent must equal 1');
  }

  // The requested strategy must never be configured below a 1:2 reward/risk ratio.
  if (
    !Number.isFinite(config.minimumRewardRiskRatio) ||
    config.minimumRewardRiskRatio < 2
  ) {
    errors.push('minimumRewardRiskRatio must be at least 2');
  }
  if (
    Number.isFinite(config.stopLossPercent) &&
    Number.isFinite(config.takeProfitPercent) &&
    Number.isFinite(config.minimumRewardRiskRatio) &&
    config.takeProfitPercent <
      config.stopLossPercent * config.minimumRewardRiskRatio
  ) {
    errors.push(
      'takeProfitPercent must be at least stopLossPercent multiplied by minimumRewardRiskRatio',
    );
  }

  if (typeof config.trailingStop.enabled !== 'boolean') {
    errors.push('trailingStop.enabled must be a boolean');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid EMA trend strategy configuration:\n${errors.join('\n')}`);
  }
};
