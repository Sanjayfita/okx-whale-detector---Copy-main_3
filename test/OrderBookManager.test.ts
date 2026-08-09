import { describe, expect, it } from 'vitest';

import { OrderBookManager } from '../src/core/OrderBookManager';

import type { OrderBookLevel } from '../src/types/orderbook';

const level = (price: string, size: string): OrderBookLevel => [
  price,
  size,
  '0',
  '1',
];

describe('OrderBookManager', () => {
  it('clears stale levels when a snapshot arrives', () => {
    const manager = new OrderBookManager();

    manager.applyUpdate(
      [level('100', '10')],
      [level('101', '10')],
      1,
      10,
      -1,
      'snapshot',
    );

    manager.applyUpdate(
      [level('102', '10')],
      [level('103', '10')],
      2,
      20,
      -1,
      'snapshot',
    );

    expect([...manager.getOrderBook().bids.keys()]).toEqual([102]);
    expect([...manager.getOrderBook().asks.keys()]).toEqual([103]);
  });

  it('rejects an update with a sequence gap', () => {
    const manager = new OrderBookManager();

    manager.applyUpdate(
      [level('100', '10')],
      [level('101', '10')],
      1,
      10,
      -1,
      'snapshot',
    );

    const result = manager.applyUpdate(
      [level('102', '10')],
      [],
      2,
      20,
      19,
      'update',
    );

    expect(result).toBe(false);
    expect(manager.getOrderBook().status).toBe('INVALID');
  });

  it('rejects non-integer and backwards update timestamps', () => {
    const manager = new OrderBookManager();

    expect(
      manager.applyUpdate(
        [level('100', '10')],
        [level('101', '10')],
        1.5,
        10,
        -1,
        'snapshot',
      ),
    ).toBe(false);

    expect(
      manager.applyUpdate(
        [level('100', '10')],
        [level('101', '10')],
        2_000,
        20,
        -1,
        'snapshot',
      ),
    ).toBe(true);
    expect(manager.applyUpdate([], [], 1_999, 21, 20, 'update')).toBe(false);
    expect(manager.getOrderBook().status).toBe('INVALID');
  });

  it('ignores levels whose quote notional overflows', () => {
    const manager = new OrderBookManager();

    manager.applyUpdate(
      [level('1e308', '1e308')],
      [level('101', '10')],
      1,
      1,
      -1,
      'snapshot',
    );

    expect(manager.getBestBid()).toBeUndefined();
    expect(manager.getBestAsk()?.price).toBe(101);
    expect(manager.isUsableForSignals()).toBe(false);
  });

  it('uses base-asset size directly for spot notional', () => {
    const manager = new OrderBookManager({
      instId: 'BTC-USDT',
      instType: 'SPOT',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 1,
    });

    manager.applyUpdate(
      [level('50_000'.replace('_', ''), '2')],
      [],
      1,
      1,
      -1,
      'snapshot',
    );

    expect(manager.getBestBid()?.notionalQuote).toBe(100_000);
  });

  it('converts swap contract counts into quote notional', () => {
    const manager = new OrderBookManager({
      instId: 'XAU-USDT-SWAP',
      instType: 'SWAP',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 0.001,
    });

    manager.applyUpdate(
      [level('5_000'.replace('_', ''), '1000')],
      [],
      1,
      1,
      -1,
      'snapshot',
    );

    expect(manager.getBestBid()?.notionalQuote).toBe(5_000);
  });

  it('reports whether the latest update pruned depth', () => {
    const manager = new OrderBookManager(undefined, 1);

    manager.applyUpdate(
      [level('100', '1'), level('99', '1')],
      [level('101', '1'), level('102', '1')],
      1,
      1,
      -1,
      'snapshot',
    );

    expect(manager.didLastUpdatePruneDepth()).toBe(true);
    expect(manager.getOrderBook().bids.size).toBe(1);
    expect(manager.getOrderBook().asks.size).toBe(1);

    manager.applyUpdate([], [], 2, 2, 1, 'update');

    expect(manager.didLastUpdatePruneDepth()).toBe(false);
  });

  describe('best bid and ask selection', () => {
    it('returns undefined for empty sides', () => {
      const manager = new OrderBookManager();

      expect(manager.getBestBid()).toBeUndefined();
      expect(manager.getBestAsk()).toBeUndefined();
      expect(manager.getMidPrice()).toBeUndefined();
    });

    it('returns the only bid and ask levels', () => {
      const manager = new OrderBookManager();

      const applied = manager.applyUpdate(
        [['100', '10', '0', '1']],
        [['101', '8', '0', '1']],
        1_000,
        1,
        -1,
        'snapshot',
      );

      expect(applied).toBe(true);
      expect(manager.getBestBid()?.price).toBe(100);
      expect(manager.getBestAsk()?.price).toBe(101);
      expect(manager.getMidPrice()).toBe(100.5);
      expect(manager.isUsableForSignals()).toBe(true);
    });

    it('rejects empty, locked, and crossed books for signal generation', () => {
      const manager = new OrderBookManager();

      manager.applyUpdate(
        [['101', '10', '0', '1']],
        [['101', '8', '0', '1']],
        1_000,
        1,
        -1,
        'snapshot',
      );
      expect(manager.isUsableForSignals()).toBe(false);

      manager.applyUpdate(
        [['102', '10', '0', '1']],
        [['101', '8', '0', '1']],
        2_000,
        2,
        -1,
        'snapshot',
      );
      expect(manager.isUsableForSignals()).toBe(false);
    });

    it('finds best levels regardless of insertion order', () => {
      const manager = new OrderBookManager();

      manager.applyUpdate(
        [
          ['99', '10', '0', '1'],
          ['101', '10', '0', '1'],
          ['100', '10', '0', '1'],
        ],
        [
          ['103', '10', '0', '1'],
          ['101.5', '10', '0', '1'],
          ['102', '10', '0', '1'],
        ],
        1_000,
        1,
        -1,
        'snapshot',
      );

      expect(manager.getBestBid()?.price).toBe(101);
      expect(manager.getBestAsk()?.price).toBe(101.5);
    });

    it('uses the next best level after deleting the previous best', () => {
      const manager = new OrderBookManager();

      manager.applyUpdate(
        [
          ['100', '10', '0', '1'],
          ['99', '10', '0', '1'],
        ],
        [
          ['101', '10', '0', '1'],
          ['102', '10', '0', '1'],
        ],
        1_000,
        1,
        -1,
        'snapshot',
      );

      const applied = manager.applyUpdate(
        [['100', '0', '0', '0']],
        [['101', '0', '0', '0']],
        2_000,
        2,
        1,
        'update',
      );

      expect(applied).toBe(true);
      expect(manager.getBestBid()?.price).toBe(99);
      expect(manager.getBestAsk()?.price).toBe(102);
    });

    it('selects a newly inserted better level', () => {
      const manager = new OrderBookManager();

      manager.applyUpdate(
        [['100', '10', '0', '1']],
        [['101', '10', '0', '1']],
        1_000,
        1,
        -1,
        'snapshot',
      );

      const applied = manager.applyUpdate(
        [['100.5', '10', '0', '1']],
        [['100.8', '10', '0', '1']],
        2_000,
        2,
        1,
        'update',
      );

      expect(applied).toBe(true);
      expect(manager.getBestBid()?.price).toBe(100.5);
      expect(manager.getBestAsk()?.price).toBe(100.8);
      expect(manager.getMidPrice()).toBeCloseTo(100.65);
    });
  });
});
