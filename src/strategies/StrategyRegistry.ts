import { EmaTrendTradingStrategy } from './emaTrend/EmaTrendTradingStrategy';
import type { TradingStrategy } from './TradingStrategy';

export interface StrategyDescriptor {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
}

export class StrategyRegistry {
  private readonly strategies = new Map<string, TradingStrategy>();
  private activeStrategyId: string;

  public constructor(
    strategies: readonly TradingStrategy[],
    defaultStrategyId: string,
  ) {
    if (strategies.length === 0) {
      throw new Error('at least one strategy must be registered');
    }
    for (const strategy of strategies) {
      if (this.strategies.has(strategy.id)) {
        throw new Error(`duplicate strategy id ${strategy.id}`);
      }
      this.strategies.set(strategy.id, strategy);
    }
    if (!this.strategies.has(defaultStrategyId)) {
      throw new Error(`default strategy ${defaultStrategyId} is not registered`);
    }
    this.activeStrategyId = defaultStrategyId;
  }

  public select(strategyId: string): TradingStrategy {
    const strategy = this.strategies.get(strategyId);
    if (strategy === undefined) {
      throw new Error(`unknown strategy ${strategyId}`);
    }
    this.activeStrategyId = strategyId;
    return strategy;
  }

  public getActive(): TradingStrategy {
    const strategy = this.strategies.get(this.activeStrategyId);
    if (strategy === undefined) {
      throw new Error('active strategy registry invariant violated');
    }
    return strategy;
  }

  public list(): readonly StrategyDescriptor[] {
    return [...this.strategies.values()]
      .map((strategy) => ({
        id: strategy.id,
        label: strategy.label,
        active: strategy.id === this.activeStrategyId,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}

export const createDefaultStrategyRegistry = (): StrategyRegistry =>
  new StrategyRegistry(
    [new EmaTrendTradingStrategy()],
    'ema-trend-crossover-v1',
  );
