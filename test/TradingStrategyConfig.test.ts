import { describe, expect, it } from 'vitest';

import {
  tradingStrategyConfig,
  validateTradingStrategyConfig,
} from '../src/config/tradingStrategyConfig';

describe('tradingStrategyConfig', () => {
  it('accepts the maintained EMA 20/50 configuration', () => {
    expect(() => validateTradingStrategyConfig(tradingStrategyConfig)).not.toThrow();
    expect(tradingStrategyConfig.fastEmaLength).toBe(20);
    expect(tradingStrategyConfig.slowEmaLength).toBe(50);
    expect(tradingStrategyConfig.stopLossPercent).toBe(1);
    expect(tradingStrategyConfig.takeProfitPercent).toBe(2);
    expect(tradingStrategyConfig.riskPerTradePercent).toBe(1);
  });

  it('rejects invalid EMA ordering, reward/risk and account-risk configuration', () => {
    expect(() =>
      validateTradingStrategyConfig({
        ...tradingStrategyConfig,
        fastEmaLength: 50,
        slowEmaLength: 20,
      }),
    ).toThrow('fastEmaLength must be shorter than slowEmaLength');

    expect(() =>
      validateTradingStrategyConfig({
        ...tradingStrategyConfig,
        takeProfitPercent: 1.5,
      }),
    ).toThrow('takeProfitPercent must be at least 2x stopLossPercent');

    expect(() =>
      validateTradingStrategyConfig({
        ...tradingStrategyConfig,
        riskPerTradePercent: 1.01,
      }),
    ).toThrow('riskPerTradePercent must not exceed 1% of account equity');
  });
});
