import { describe, expect, it } from 'vitest';

import { OrderBookManager } from '../src/core/OrderBookManager';
import type { OrderBookLevel } from '../src/types/orderbook';

const level = (price: number): OrderBookLevel => [String(price), '1', '0', '1'];

describe('OrderBookManager depth limit', () => {
  it('retains the highest bids and lowest asks', () => {
    const manager = new OrderBookManager(undefined, 3);

    manager.applyUpdate(
      [level(96), level(100), level(98), level(99), level(97)],
      [level(105), level(101), level(103), level(102), level(104)],
      1,
      1,
      -1,
      'snapshot',
    );

    expect(
      [...manager.getOrderBook().bids.keys()].sort((a, b) => b - a),
    ).toEqual([100, 99, 98]);
    expect(
      [...manager.getOrderBook().asks.keys()].sort((a, b) => a - b),
    ).toEqual([101, 102, 103]);
  });

  it('prunes runaway incremental levels while preserving the best prices', () => {
    const manager = new OrderBookManager(undefined, 2);

    manager.applyUpdate(
      [level(100), level(99)],
      [level(101), level(102)],
      1,
      1,
      -1,
      'snapshot',
    );

    manager.applyUpdate(
      [level(98), level(101)],
      [level(100.5), level(103)],
      2,
      2,
      1,
      'update',
    );

    expect(
      [...manager.getOrderBook().bids.keys()].sort((a, b) => b - a),
    ).toEqual([101, 100]);
    expect(
      [...manager.getOrderBook().asks.keys()].sort((a, b) => a - b),
    ).toEqual([100.5, 101]);
  });

  it('rejects an invalid depth limit', () => {
    expect(() => new OrderBookManager(undefined, 0)).toThrow(
      'maximumLevelsPerSide must be a positive integer',
    );
    expect(() => new OrderBookManager(undefined, 1.5)).toThrow(
      'maximumLevelsPerSide must be a positive integer',
    );
  });
});
