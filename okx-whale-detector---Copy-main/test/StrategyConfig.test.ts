import { describe, expect, it } from 'vitest';

import {
  emaTrendStrategyConfig,
  validateEmaTrendStrategyConfig,
} from '../src/config/strategyConfig';

describe('EMA trend strategy configuration', () => {
  it('accepts the conservative production defaults', () => {
    expect(() =>
      validateEmaTrendStrategyConfig(emaTrendStrategyConfig),
    ).not.toThrow();
  });

  it('requires the fast EMA to remain below the slow EMA period', () => {
    expect(() =>
      validateEmaTrendStrategyConfig({
        ...emaTrendStrategyConfig,
        fastEmaPeriod: 50,
        slowEmaPeriod: 20,
      }),
    ).toThrow('fastEmaPeriod must be less than slowEmaPeriod');
  });

  it('keeps risk fixed at one percent per trade', () => {
    expect(() =>
      validateEmaTrendStrategyConfig({
        ...emaTrendStrategyConfig,
        riskPerTradePercent: 2,
      }),
    ).toThrow('riskPerTradePercent must equal 1');
  });

  it('rejects configurations below the required 1:2 reward/risk ratio', () => {
    expect(() =>
      validateEmaTrendStrategyConfig({
        ...emaTrendStrategyConfig,
        stopLossPercent: 1,
        takeProfitPercent: 1.5,
      }),
    ).toThrow(
      'takeProfitPercent must be at least stopLossPercent multiplied by minimumRewardRiskRatio',
    );
    expect(() =>
      validateEmaTrendStrategyConfig({
        ...emaTrendStrategyConfig,
        minimumRewardRiskRatio: 1.5,
      }),
    ).toThrow('minimumRewardRiskRatio must be at least 2');
  });

  it('rejects invalid RSI confirmation ranges', () => {
    expect(() =>
      validateEmaTrendStrategyConfig({
        ...emaTrendStrategyConfig,
        longRsiMinimum: 45,
        shortRsiMaximum: 55,
      }),
    ).toThrow(/longRsiMinimum must be at least 50[\s\S]*shortRsiMaximum must be at most 50/);
  });
});
