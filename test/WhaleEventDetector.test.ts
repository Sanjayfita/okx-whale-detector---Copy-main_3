import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WhaleEventDetector } from '../src/core/WhaleEventDetector';
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

const createBook = (bids: readonly OrderLevel[]): OrderBook => ({
  bids: new Map(bids.map((level) => [level.price, level])),
  asks: new Map(),
  lastSeqId: 1,
  status: 'SYNCED',
  initialized: true,
  updatedAt: Date.now(),
});

describe('WhaleEventDetector with WhaleTracker snapshots', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('compares notional changes against an unchanged previous snapshot', () => {
    const tracker = new WhaleTracker();
    const detector = new WhaleEventDetector();
    const first = tracker.scan(createBook([createLevel(100, 10_000)]));

    expect(detector.detect(first.active).map((event) => event.type)).toEqual([
      'NEW',
    ]);

    const original = first.active[0];
    const second = tracker.scan(createBook([createLevel(100, 12_000)]));
    const events = detector.detect(second.active);

    expect(second.active[0]).not.toBe(original);
    expect(original?.notionalQuote).toBe(1_000_000);
    expect(events.map((event) => event.type)).toContain('INCREASED');
    expect(events.find((event) => event.type === 'INCREASED')?.previous).toBe(
      original,
    );
  });

  it('observes a nearby move under the restored stable wall identity', () => {
    const tracker = new WhaleTracker();
    const detector = new WhaleEventDetector();
    const first = tracker.scan(createBook([createLevel(100, 10_000)]));

    detector.detect(first.active);

    const second = tracker.scan(createBook([createLevel(100.1, 10_000)]));
    const events = detector.detect(second.active);
    const movement = events.find((event) => event.type === 'MOVED');

    expect(second.active[0]?.wallId).toBe(first.active[0]?.wallId);
    expect(movement?.previous).toBe(first.active[0]);
    expect(movement?.previous?.price).toBe(100);
    expect(movement?.whale.price).toBe(100.1);
  });
});
