import { describe, expect, it } from 'vitest';
import { simulateMarketOrder } from '../src/backtest/ExecutionSimulator';
import { OrderBookManager } from '../src/core/OrderBookManager';
import { LazyExecutionBookStore } from '../src/platform/LazyExecutionBookStore';
import type { MarketInstrumentConfig } from '../src/types/instrument';

const instrument: MarketInstrumentConfig = {
  instId: 'BTC-USDT-SWAP',
  instType: 'SWAP',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
};

const createState = () => ({
  instrument,
  orderBookManager: new OrderBookManager(instrument, 20),
});

describe('LazyExecutionBookStore', () => {
  it('does not materialize complete execution books for ordinary updates', () => {
    const state = createState();
    const store = new LazyExecutionBookStore();

    expect(
      state.orderBookManager.applyUpdate(
        [['100', '100', '0', '1']],
        [['101', '100', '0', '1']],
        1_000,
        1,
        -1,
        'snapshot',
      ),
    ).toBe(true);

    for (let index = 0; index < 100; index += 1) {
      store.observe(instrument.instId, state);
    }

    expect(store.getMetrics()).toEqual({
      orderBookUpdates: 100,
      executionBookMaterializations: 0,
    });
  });

  it('materializes current bounded depth only when execution asks for it', () => {
    const state = createState();
    const store = new LazyExecutionBookStore();

    expect(
      state.orderBookManager.applyUpdate(
        [['100', '100', '0', '1']],
        [['101', '100', '0', '1']],
        1_000,
        1,
        -1,
        'snapshot',
      ),
    ).toBe(true);
    store.observe(instrument.instId, state);

    const book = store.get(instrument.instId);
    expect(book).toBeDefined();
    expect(store.getMetrics()).toEqual({
      orderBookUpdates: 1,
      executionBookMaterializations: 1,
    });

    const actual = simulateMarketOrder({
      side: 'BUY',
      quantity: 2,
      book: book!,
    });
    const expected = simulateMarketOrder({
      side: 'BUY',
      quantity: 2,
      book: {
        observedAt: 1_000,
        bids: [{ price: 100, quantity: 100 }],
        asks: [{ price: 101, quantity: 100 }],
      },
    });

    expect(actual).toEqual(expected);
  });

  it('uses the latest order-book state instead of an earlier observed snapshot', () => {
    const state = createState();
    const store = new LazyExecutionBookStore();

    expect(
      state.orderBookManager.applyUpdate(
        [['100', '100', '0', '1']],
        [['101', '100', '0', '1']],
        1_000,
        1,
        -1,
        'snapshot',
      ),
    ).toBe(true);
    store.observe(instrument.instId, state);

    expect(
      state.orderBookManager.applyUpdate(
        [
          ['100', '0', '0', '1'],
          ['120', '100', '0', '1'],
        ],
        [
          ['101', '0', '0', '1'],
          ['121', '100', '0', '1'],
        ],
        2_000,
        2,
        1,
        'update',
      ),
    ).toBe(true);
    store.observe(instrument.instId, state);

    expect(store.getMetrics().executionBookMaterializations).toBe(0);
    expect(store.getObservedAt(instrument.instId)).toBe(2_000);

    const book = store.get(instrument.instId);
    expect(book).toMatchObject({ observedAt: 2_000 });
    expect(book?.bids).toEqual([{ price: 120, quantity: 100 }]);
    expect(book?.asks).toEqual([{ price: 121, quantity: 100 }]);
    expect(store.getMetrics()).toEqual({
      orderBookUpdates: 2,
      executionBookMaterializations: 1,
    });
  });

  it('does not materialize a resyncing or otherwise unusable book', () => {
    const state = createState();
    const store = new LazyExecutionBookStore();

    expect(
      state.orderBookManager.applyUpdate(
        [['100', '100', '0', '1']],
        [['101', '100', '0', '1']],
        1_000,
        1,
        -1,
        'snapshot',
      ),
    ).toBe(true);
    store.observe(instrument.instId, state);
    state.orderBookManager.markResyncing();

    expect(store.getObservedAt(instrument.instId)).toBeUndefined();
    expect(store.get(instrument.instId)).toBeUndefined();
    expect(store.getMetrics().executionBookMaterializations).toBe(0);
  });
});
