import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appConfig } from '../src/config/appConfig';
import { WhaleTracker } from '../src/core/WhaleTracker';

import type { OrderBook, OrderLevel } from '../src/types/orderbook';

const createLevel = (price: number, size: number): OrderLevel => ({
  price,
  rawPrice: String(price),
  size,
  rawSize: String(size),
  notionalQuote: price * size,
  quoteCurrency: 'USDT',
  updatedAt: Date.now(),
});

const createBook = (
  bids: OrderLevel[] = [],
  asks: OrderLevel[] = [],
): OrderBook => ({
  bids: new Map(bids.map((level) => [level.price, level])),
  asks: new Map(asks.map((level) => [level.price, level])),
  lastSeqId: 1,
  status: 'SYNCED',
  initialized: true,
  updatedAt: Date.now(),
});

describe('WhaleTracker stable wall identity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('changes whale detection when a smaller threshold is injected', () => {
    const productionTracker = new WhaleTracker(appConfig.tracker);
    const testTracker = new WhaleTracker({
      ...appConfig.tracker,
      minimumNotionalQuote: 1_000,
    });
    const orderBook = createBook([createLevel(100, 100)]);

    expect(productionTracker.scan(orderBook).active).toHaveLength(0);
    expect(testTracker.scan(orderBook).active).toHaveLength(1);
  });

  it('keeps BID and ASK whales distinct at the same numeric price', () => {
    const tracker = new WhaleTracker();
    const result = tracker.scan(
      createBook([createLevel(100, 10_000)], [createLevel(100, 10_000)]),
    );

    expect(result.active).toHaveLength(2);
    expect(result.active.map((whale) => whale.side)).toEqual(['BID', 'ASK']);
    expect(result.active[0]?.wallId).not.toBe(result.active[1]?.wallId);
  });

  it('reports a new whale and then an unmatched disappearance', () => {
    const tracker = new WhaleTracker();
    const first = tracker.scan(createBook([createLevel(100, 10_000)]));
    const second = tracker.scan(createBook());

    expect(first.newWhales).toEqual(first.active);
    expect(first.removedWhales).toHaveLength(0);
    expect(second.active).toHaveLength(0);
    expect(second.newWhales).toHaveLength(0);
    expect(second.movedWhales).toHaveLength(0);
    expect(second.removedWhales).toEqual(first.active);
  });

  it('preserves exact-price identity while returning a fresh Whale snapshot', () => {
    const tracker = new WhaleTracker();
    const first = tracker.scan(createBook([createLevel(100, 10_000)]));
    const original = first.active[0];

    vi.advanceTimersByTime(1_000);
    const second = tracker.scan(createBook([createLevel(100, 12_000)]));
    const updated = second.active[0];

    expect(original).toBeDefined();
    expect(updated).toBeDefined();
    expect(updated).not.toBe(original);
    expect(updated?.wallId).toBe(original?.wallId);
    expect(updated?.firstSeenAt).toBe(original?.firstSeenAt);
    expect(updated?.updateCount).toBe(2);
    expect(updated?.notionalQuote).toBe(1_200_000);
    expect(original?.notionalQuote).toBe(1_000_000);
    expect(second.newWhales).toHaveLength(0);
    expect(second.removedWhales).toHaveLength(0);
    expect(second.movedWhales).toHaveLength(0);
  });

  it('keeps wallId and firstSeenAt when a wall moves slightly', () => {
    const tracker = new WhaleTracker();
    const first = tracker.scan(createBook([createLevel(100, 10_000)]));
    const original = first.active[0];

    expect(original).toBeDefined();
    if (!original) {
      throw new Error('Expected original whale');
    }

    vi.advanceTimersByTime(30_000);
    const second = tracker.scan(createBook([createLevel(100.01, 10_000)]));
    const moved = second.active[0];

    expect(moved).toBeDefined();
    if (!moved) {
      throw new Error('Expected moved whale');
    }

    expect(moved.wallId).toBe(original.wallId);
    expect(moved.firstSeenAt).toBe(original.firstSeenAt);
    expect(moved.ageSeconds).toBe(30);
    expect(second.movedWhales).toHaveLength(1);
    expect(second.movedWhales[0]?.wallId).toBe(original.wallId);
    expect(second.newWhales).toHaveLength(0);
    expect(second.removedWhales).toHaveLength(0);
  });

  it('preserves first-candidate order across simultaneous nearby movements', () => {
    const tracker = new WhaleTracker();
    const first = tracker.scan(
      createBook([createLevel(100, 10_000), createLevel(100.2, 10_000)]),
    );

    const second = tracker.scan(
      createBook([createLevel(100.1, 10_000), createLevel(100.3, 10_000)]),
    );

    expect(second.movedWhales).toHaveLength(2);
    expect(
      second.movedWhales.map((movement) => movement.previousPrice),
    ).toEqual([100, 100.2]);
    expect(second.movedWhales.map((movement) => movement.price)).toEqual([
      100.1, 100.3,
    ]);
    expect(second.active.map((whale) => whale.wallId)).toEqual(
      first.active.map((whale) => whale.wallId),
    );
  });

  it('does not reuse one new wall for two old walls', () => {
    const tracker = new WhaleTracker();

    tracker.scan(
      createBook([createLevel(100, 10_000), createLevel(100.02, 10_000)]),
    );

    const result = tracker.scan(createBook([createLevel(100.01, 10_000)]));
    expect(result.movedWhales).toHaveLength(1);
  });

  it('keeps unmatched new whales after movement matching', () => {
    const tracker = new WhaleTracker();

    tracker.scan(createBook([createLevel(100, 10_000)]));
    const result = tracker.scan(
      createBook([createLevel(100.1, 10_000), createLevel(102, 10_000)]),
    );

    expect(result.movedWhales).toHaveLength(1);
    expect(result.newWhales).toHaveLength(1);
    expect(result.newWhales[0]?.price).toBe(102);
    expect(result.removedWhales).toHaveLength(0);
  });

  it('rejects movement outside the configured size ratio', () => {
    const tracker = new WhaleTracker();
    const first = tracker.scan(createBook([createLevel(100, 10_000)]));
    const second = tracker.scan(createBook([createLevel(100.1, 7_000)]));

    expect(second.movedWhales).toHaveLength(0);
    expect(second.newWhales).toHaveLength(1);
    expect(second.removedWhales).toEqual(first.active);
    expect(second.newWhales[0]?.wallId).not.toBe(first.active[0]?.wallId);
  });

  it('accepts movement at the price-tolerance boundary', () => {
    const tracker = new WhaleTracker();
    const first = tracker.scan(createBook([createLevel(100, 10_000)]));
    const second = tracker.scan(createBook([createLevel(100.5, 10_000)]));

    expect(second.movedWhales).toHaveLength(1);
    expect(second.active[0]?.wallId).toBe(first.active[0]?.wallId);
  });

  it('rejects movement beyond the price-tolerance boundary', () => {
    const tracker = new WhaleTracker();
    const first = tracker.scan(createBook([createLevel(100, 10_000)]));
    const second = tracker.scan(createBook([createLevel(100.5001, 10_000)]));

    expect(second.movedWhales).toHaveLength(0);
    expect(second.newWhales).toHaveLength(1);
    expect(second.removedWhales).toEqual(first.active);
  });

  it('reports the strongest whale on each side without changing identity', () => {
    const tracker = new WhaleTracker();
    const result = tracker.scan(
      createBook(
        [createLevel(100, 6_000), createLevel(99, 20_000)],
        [createLevel(101, 7_000), createLevel(102, 30_000)],
      ),
    );

    expect(result.strongestBid?.price).toBe(99);
    expect(result.strongestAsk?.price).toBe(102);
    expect(result.strongestBid?.wallId).toBe(
      result.active.find((whale) => whale.price === 99)?.wallId,
    );
    expect(result.strongestAsk?.wallId).toBe(
      result.active.find((whale) => whale.price === 102)?.wallId,
    );
    expect(result.totalBidNotionalQuote).toBe(2_580_000);
    expect(result.totalAskNotionalQuote).toBe(3_767_000);
  });

  it('counts persistent and strong active walls after repeated scans', () => {
    const tracker = new WhaleTracker();
    const book = createBook(
      [createLevel(100, 10_000)],
      [createLevel(101, 10_000)],
    );

    tracker.scan(book);
    vi.advanceTimersByTime(60_000);
    const result = tracker.scan(book);

    expect(result.persistentWalls).toBe(2);
    expect(result.strongWalls).toBe(2);
    expect(result.trackedWalls).toBe(2);
  });

  it('preserves tracked-wall insertion order after a cross-side movement', () => {
    const tracker = new WhaleTracker();

    tracker.scan(
      createBook([createLevel(100, 10_000)], [createLevel(101, 10_000)]),
    );
    tracker.scan(
      createBook([createLevel(100.1, 10_000)], [createLevel(101, 10_000)]),
    );

    expect(
      tracker.getTrackedWalls().map((whale) => `${whale.side}:${whale.price}`),
    ).toEqual(['ASK:101', 'BID:100.1']);
  });

  it('keeps independent tracker instances isolated', () => {
    const btcTracker = new WhaleTracker();
    const ethTracker = new WhaleTracker();

    const btc = btcTracker.scan(createBook([createLevel(100, 10_000)]));
    const eth = ethTracker.scan(createBook([], [createLevel(100, 10_000)]));

    expect(btc.active).toHaveLength(1);
    expect(eth.active).toHaveLength(1);
    expect(btc.active[0]?.side).toBe('BID');
    expect(eth.active[0]?.side).toBe('ASK');
    expect(btcTracker.getTrackedWalls()).toEqual(btc.active);
    expect(ethTracker.getTrackedWalls()).toEqual(eth.active);
  });
});
