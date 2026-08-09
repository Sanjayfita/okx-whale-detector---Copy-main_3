import { describe, expect, it } from 'vitest';
import {
  StrategyRegistry,
  createDefaultStrategyRegistry,
} from '../src/strategies/StrategyRegistry';
import type {
  StrategyContext,
  StrategySignalResult,
  TradingStrategy,
} from '../src/strategies/TradingStrategy';

const strategy = (id: string): TradingStrategy => ({
  id,
  label: id.toUpperCase(),
  generateSignal(context: StrategyContext): StrategySignalResult {
    return {
      strategyId: id,
      instrumentId: context.instrumentId,
      action: 'WAIT',
      direction: null,
      observedAt: null,
      reasons: ['TEST'],
      entryPrice: null,
      stopLossPrice: null,
      takeProfitPrice: null,
      trailingStopPrice: null,
      positionSizeBaseUnits: 0,
      riskAmount: 0,
      riskRewardRatio: null,
      indicators: {},
      liveExecutionAllowed: false,
    };
  },
  calculateStop: () => null,
  calculateTakeProfit: () => null,
  calculatePositionSize: () => 0,
});

describe('StrategyRegistry', () => {
  it('keeps EMA Trend as the default registered strategy', () => {
    const registry = createDefaultStrategyRegistry();
    expect(registry.getActive().id).toBe('ema-trend-crossover-v1');
    expect(registry.list()).toEqual([
      expect.objectContaining({
        id: 'ema-trend-crossover-v1',
        active: true,
      }),
    ]);
  });

  it('switches between registered strategies without code changes', () => {
    const registry = new StrategyRegistry(
      [strategy('alpha'), strategy('beta')],
      'alpha',
    );
    expect(registry.select('beta').id).toBe('beta');
    expect(registry.getActive().id).toBe('beta');
    expect(registry.list().find((entry) => entry.id === 'beta')?.active).toBe(
      true,
    );
  });

  it('rejects duplicates and unknown strategy selections', () => {
    expect(
      () => new StrategyRegistry([strategy('same'), strategy('same')], 'same'),
    ).toThrow(/duplicate strategy/u);
    const registry = new StrategyRegistry([strategy('one')], 'one');
    expect(() => registry.select('missing')).toThrow(/unknown strategy/u);
  });
});
