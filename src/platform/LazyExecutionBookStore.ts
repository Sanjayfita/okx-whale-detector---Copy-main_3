import type {
  ExecutionBookLevel,
  ExecutionOrderBook,
} from '../backtest/ExecutionSimulator';
import type { OrderBookManager } from '../core/OrderBookManager';
import type { MarketInstrumentConfig } from '../types/instrument';

export interface ExecutionBookSourceState {
  readonly instrument: MarketInstrumentConfig;
  readonly orderBookManager: OrderBookManager;
}

export interface ExecutionBookMaterializationMetrics {
  readonly orderBookUpdates: number;
  readonly executionBookMaterializations: number;
}

const materializeLevels = (
  levels: ReturnType<OrderBookManager['getOrderBook']>['bids'],
  baseUnitsPerSize: number,
): ExecutionBookLevel[] => {
  const materialized: ExecutionBookLevel[] = [];
  for (const level of levels.values()) {
    materialized.push({
      price: level.price,
      quantity: level.size * baseUnitsPerSize,
    });
  }
  return materialized;
};

/**
 * Retains only the latest bounded OrderBookManager state for each instrument.
 * Full execution-book arrays are built only when a simulated fill asks for them.
 */
export class LazyExecutionBookStore {
  private readonly states = new Map<string, ExecutionBookSourceState>();
  private orderBookUpdates = 0;
  private executionBookMaterializations = 0;

  public observe(instrumentId: string, state: ExecutionBookSourceState): void {
    this.states.set(instrumentId, state);
    this.orderBookUpdates += 1;
  }

  public getObservedAt(instrumentId: string): number | undefined {
    const state = this.states.get(instrumentId);
    if (state === undefined || !state.orderBookManager.isUsableForSignals()) {
      return undefined;
    }
    return state.orderBookManager.getOrderBook().updatedAt;
  }

  public get(instrumentId: string): ExecutionOrderBook | undefined {
    const state = this.states.get(instrumentId);
    if (state === undefined || !state.orderBookManager.isUsableForSignals()) {
      return undefined;
    }

    const book = state.orderBookManager.getOrderBook();
    const baseUnitsPerSize = state.instrument.baseUnitsPerSize;
    this.executionBookMaterializations += 1;

    return {
      observedAt: book.updatedAt,
      bids: materializeLevels(book.bids, baseUnitsPerSize),
      asks: materializeLevels(book.asks, baseUnitsPerSize),
    };
  }

  public getMetrics(): ExecutionBookMaterializationMetrics {
    return {
      orderBookUpdates: this.orderBookUpdates,
      executionBookMaterializations: this.executionBookMaterializations,
    };
  }
}
