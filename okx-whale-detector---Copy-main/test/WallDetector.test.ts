import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WallDetector } from '../src/core/WallDetector';

import type { OrderBook, OrderLevel } from '../src/types/orderbook';
import { WallSide, WallStatus } from '../src/types/wall';

const createLevel = (price: number, size: number): OrderLevel => ({
  price,
  rawPrice: price.toString(),
  size,
  rawSize: size.toString(),
  notionalQuote: price * size,
  quoteCurrency: 'USDT',
  updatedAt: Date.now(),
});

const createOrderBook = (
  bids: OrderLevel[],
  asks: OrderLevel[] = [],
): OrderBook => ({
  bids: new Map(bids.map((level) => [level.price, level])),
  asks: new Map(asks.map((level) => [level.price, level])),
  lastSeqId: 1,
  status: 'SYNCED',
  initialized: true,
  updatedAt: Date.now(),
});

const createDetector = (
  overrides: Partial<ConstructorParameters<typeof WallDetector>[0]> = {},
): WallDetector =>
  new WallDetector({
    minNotionalQuote: 500_000,
    persistentAfterMs: 30_000,
    strongAfterMs: 120_000,
    priceTolerancePercent: 0.1,
    removalGracePeriodMs: 2_000,
    ...overrides,
  });

describe('WallDetector one-to-one matching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T12:00:00Z'));
  });

  it('creates two walls for two nearby qualifying bid levels', () => {
    const detector = createDetector();
    const orderBook = createOrderBook([
      createLevel(100, 6_000),
      createLevel(100.05, 6_000),
    ]);

    const walls = detector.detect(orderBook);

    expect(walls).toHaveLength(2);
    expect(walls.map((wall) => wall.currentPrice)).toEqual([100, 100.05]);
    expect(new Set(walls.map((wall) => wall.wallId)).size).toBe(2);
  });

  it('keeps one wall when an old wall moves slightly', () => {
    const detector = createDetector();
    const firstOrderBook = createOrderBook([createLevel(100, 6_000)]);
    const firstResult = detector.detect(firstOrderBook);

    expect(firstResult).toHaveLength(1);

    const originalWall = firstResult[0];

    expect(originalWall).toBeDefined();

    if (!originalWall) {
      throw new Error('Expected the original wall');
    }

    const originalWallId = originalWall.wallId;
    const originalFirstSeen = originalWall.firstSeen;

    vi.advanceTimersByTime(30_000);

    const movedOrderBook = createOrderBook([createLevel(100.05, 6_100)]);
    const secondResult = detector.detect(movedOrderBook);

    expect(secondResult).toHaveLength(1);

    const movedWall = secondResult[0];

    expect(movedWall).toBeDefined();

    if (!movedWall) {
      throw new Error('Expected the moved wall');
    }

    expect(movedWall.wallId).toBe(originalWallId);
    expect(movedWall.firstSeen).toBe(originalFirstSeen);
    expect(movedWall.initialPrice).toBe(100);
    expect(movedWall.currentPrice).toBe(100.05);
    expect(movedWall.ageMs).toBe(30_000);
  });

  it('keeps both walls when a moved wall vacates and then reuses its initial price', () => {
    const detector = createDetector();
    const original = detector.detect(
      createOrderBook([createLevel(100, 6_000)]),
    )[0];

    detector.detect(createOrderBook([createLevel(100.05, 6_000)]));

    const walls = detector.detect(
      createOrderBook([createLevel(100.05, 6_000), createLevel(100, 7_000)]),
    );

    expect(walls).toHaveLength(2);
    expect(walls[0]).toBe(original);
    expect(walls.map((wall) => wall.currentPrice)).toEqual([100.05, 100]);
    expect(new Set(walls.map((wall) => wall.wallId)).size).toBe(2);
    expect(walls[1]?.wallId).toBe(`${WallSide.BUY}:100#2`);
  });

  it('reuses the exact-price wall and updates its notional', () => {
    const detector = createDetector();

    const firstResult = detector.detect(
      createOrderBook([createLevel(100, 6_000)]),
    );
    const originalWall = firstResult[0];

    expect(originalWall).toBeDefined();

    if (!originalWall) {
      throw new Error('Expected the original wall');
    }

    vi.advanceTimersByTime(5_000);

    const secondResult = detector.detect(
      createOrderBook([createLevel(100, 7_000)]),
    );
    const updatedWall = secondResult[0];

    expect(secondResult).toHaveLength(1);
    expect(updatedWall?.wallId).toBe(originalWall.wallId);
    expect(updatedWall).toBe(originalWall);
    expect(updatedWall?.currentNotional).toBe(700_000);
    expect(updatedWall?.ageMs).toBe(5_000);
    expect(updatedWall?.initialNotional).toBe(600_000);
    expect(updatedWall?.highestNotional).toBe(700_000);
    expect(updatedWall?.lowestNotional).toBe(600_000);
    expect(updatedWall?.notionalChangePercent).toBeCloseTo(100 / 6);
    expect(updatedWall?.priceMovementPercent).toBe(0);
    expect(updatedWall?.status).toBe(WallStatus.ACTIVE);
  });

  it('keeps bid and ask walls separate at the same price', () => {
    const detector = createDetector();
    const walls = detector.detect(
      createOrderBook([createLevel(100, 6_000)], [createLevel(100, 7_000)]),
    );

    expect(walls).toHaveLength(2);
    expect(new Set(walls.map((wall) => wall.wallId)).size).toBe(2);
    expect(walls.map((wall) => wall.side).sort()).toEqual(['BUY', 'SELL']);
  });

  it('advances through persistent and strong states without changing identity', () => {
    const detector = createDetector();
    const orderBook = createOrderBook([createLevel(100, 6_000)]);
    const created = detector.detect(orderBook)[0];

    expect(created?.status).toBe(WallStatus.NEW);

    vi.advanceTimersByTime(30_000);

    const persistent = detector.detect(orderBook)[0];

    expect(persistent).toBe(created);
    expect(persistent?.status).toBe(WallStatus.PERSISTENT);
    expect(persistent?.ageMs).toBe(30_000);

    vi.advanceTimersByTime(90_000);

    const strong = detector.detect(orderBook)[0];

    expect(strong).toBe(created);
    expect(strong?.status).toBe(WallStatus.STRONG);
    expect(strong?.ageMs).toBe(120_000);
  });

  it('retains the last status while a missing wall is in its fading grace period', () => {
    const detector = createDetector();
    const orderBook = createOrderBook([createLevel(100, 6_000)]);

    detector.detect(orderBook);
    vi.advanceTimersByTime(1);

    const active = detector.detect(orderBook)[0];

    expect(active?.status).toBe(WallStatus.ACTIVE);

    vi.advanceTimersByTime(1_999);

    const fading = detector.detect(createOrderBook([]));

    expect(fading).toHaveLength(1);
    expect(fading[0]).toBe(active);
    expect(fading[0]?.status).toBe(WallStatus.ACTIVE);
    expect(fading[0]?.lastSeen).toBe(active?.lastSeen);
  });

  it('removes a missing wall when its grace period expires', () => {
    const detector = createDetector();

    detector.detect(createOrderBook([createLevel(100, 6_000)]));
    vi.advanceTimersByTime(2_000);

    expect(detector.detect(createOrderBook([]))).toEqual([]);
  });

  it('restores the same wall when it reappears during the grace period', () => {
    const detector = createDetector();
    const original = detector.detect(
      createOrderBook([createLevel(100, 6_000)]),
    )[0];

    vi.advanceTimersByTime(1_000);
    detector.detect(createOrderBook([]));
    vi.advanceTimersByTime(500);

    const restored = detector.detect(
      createOrderBook([createLevel(100, 7_000)]),
    )[0];

    expect(restored).toBe(original);
    expect(restored?.wallId).toBe(original?.wallId);
    expect(restored?.firstSeen).toBe(original?.firstSeen);
    expect(restored?.lastSeen).toBe(Date.now());
    expect(restored?.currentNotional).toBe(700_000);
  });

  it('matches simultaneous nearby movements one-to-one on each side', () => {
    const detector = createDetector();
    const original = detector.detect(
      createOrderBook(
        [createLevel(100, 6_000), createLevel(99.95, 6_100)],
        [createLevel(101, 6_000), createLevel(101.05, 6_100)],
      ),
    );
    const originalIds = original.map((wall) => wall.wallId);

    const moved = detector.detect(
      createOrderBook(
        [createLevel(100.005, 6_200), createLevel(99.955, 6_300)],
        [createLevel(101.005, 6_200), createLevel(101.055, 6_300)],
      ),
    );

    expect(moved.map((wall) => wall.wallId)).toEqual(originalIds);
    expect(moved.map((wall) => wall.currentPrice)).toEqual([
      100.005, 99.955, 101.005, 101.055,
    ]);
    expect(new Set(moved.map((wall) => wall.wallId))).toHaveLength(4);
  });

  it('uses each nearby wall at most once', () => {
    const detector = createDetector();
    const original = detector.detect(
      createOrderBook([createLevel(100, 6_000), createLevel(100.05, 6_000)]),
    );

    const moved = detector.detect(
      createOrderBook([createLevel(100.01, 6_100), createLevel(100.02, 6_200)]),
    );

    expect(moved).toHaveLength(2);
    expect(new Set(moved.map((wall) => wall.wallId))).toEqual(
      new Set(original.map((wall) => wall.wallId)),
    );
  });

  it('preserves first-candidate tie behavior for equally close walls', () => {
    const detector = createDetector({ priceTolerancePercent: 1 });
    const original = detector.detect(
      createOrderBook([createLevel(100, 6_000), createLevel(101, 6_000)]),
    );
    const tiedPrice = (2 * 100 * 101) / (100 + 101);

    const moved = detector.detect(
      createOrderBook([createLevel(tiedPrice, 6_100)]),
    );

    expect(moved[0]?.wallId).toBe(original[0]?.wallId);
    expect(moved[0]?.currentPrice).toBe(tiedPrice);
  });

  it('accepts the movement tolerance boundary and rejects a price beyond it', () => {
    const atBoundary = createDetector();
    const boundaryWall = atBoundary.detect(
      createOrderBook([createLevel(100, 6_000)]),
    )[0];

    const boundaryResult = atBoundary.detect(
      createOrderBook([createLevel(100.1, 6_100)]),
    );

    expect(boundaryResult).toHaveLength(1);
    expect(boundaryResult[0]).toBe(boundaryWall);

    const outside = createDetector();
    const outsideWall = outside.detect(
      createOrderBook([createLevel(100, 6_000)]),
    )[0];
    const outsideResult = outside.detect(
      createOrderBook([createLevel(100.1001, 6_100)]),
    );

    expect(outsideResult).toHaveLength(2);
    expect(outsideResult[0]).toBe(outsideWall);
    expect(outsideResult[1]?.currentPrice).toBe(100.1001);
  });

  it('preserves global insertion order across movement and expiry', () => {
    const detector = createDetector({ removalGracePeriodMs: 0 });
    const first = detector.detect(
      createOrderBook(
        [createLevel(100, 6_000), createLevel(99, 6_000)],
        [createLevel(101, 6_000)],
      ),
    );
    const firstIds = first.map((wall) => wall.wallId);

    const moved = detector.detect(
      createOrderBook(
        [createLevel(100.05, 6_100), createLevel(99, 6_100)],
        [createLevel(101, 6_100)],
      ),
    );

    expect(moved.map((wall) => wall.wallId)).toEqual(firstIds);

    const afterExpiry = detector.detect(
      createOrderBook(
        [createLevel(100.05, 6_100)],
        [createLevel(101, 6_100), createLevel(102, 6_000)],
      ),
    );

    expect(afterExpiry.map((wall) => wall.wallId)).toEqual([
      firstIds[0],
      firstIds[2],
      `${WallSide.SELL}:102`,
    ]);
  });

  it('clears walls and both persistent side indexes on reset', () => {
    const detector = createDetector();

    detector.detect(
      createOrderBook([createLevel(100, 6_000)], [createLevel(100, 7_000)]),
    );
    detector.reset();

    expect(detector.detect(createOrderBook([]))).toEqual([]);

    const afterReset = detector.detect(
      createOrderBook([createLevel(100, 8_000)]),
    );

    expect(afterReset).toHaveLength(1);
    expect(afterReset[0]?.side).toBe(WallSide.BUY);
    expect(afterReset[0]?.status).toBe(WallStatus.NEW);
    expect(afterReset[0]?.initialNotional).toBe(800_000);
  });

  it('preserves identity and output order across full-book snapshots', () => {
    const detector = createDetector();
    const first = detector.detect(
      createOrderBook(
        [createLevel(100, 6_000), createLevel(99, 6_100)],
        [createLevel(101, 6_200)],
      ),
    );
    const firstIds = first.map((wall) => wall.wallId);
    const firstSeen = first.map((wall) => wall.firstSeen);

    vi.advanceTimersByTime(5_000);

    const second = detector.detect(
      createOrderBook(
        [createLevel(100, 6_500), createLevel(99, 6_600)],
        [createLevel(101, 6_700)],
      ),
    );

    expect(second.map((wall) => wall.wallId)).toEqual(firstIds);
    expect(second.map((wall) => wall.firstSeen)).toEqual(firstSeen);
    expect(second.map((wall) => wall.currentNotional)).toEqual([
      650_000, 653_400, 676_700,
    ]);
    expect(second.map((wall) => wall.status)).toEqual([
      WallStatus.ACTIVE,
      WallStatus.ACTIVE,
      WallStatus.ACTIVE,
    ]);
  });

  it('returns a fresh collection that cannot mutate detector state', () => {
    const detector = createDetector();
    const orderBook = createOrderBook(
      [createLevel(100, 6_000)],
      [createLevel(101, 6_000)],
    );
    const first = detector.detect(orderBook);

    first.pop();
    first.splice(0, 1);

    const second = detector.detect(orderBook);

    expect(second).not.toBe(first);
    expect(second).toHaveLength(2);
    expect(second.map((wall) => wall.side)).toEqual([
      WallSide.BUY,
      WallSide.SELL,
    ]);
  });

  it('keeps detector instances isolated for separate symbols', () => {
    const btc = createDetector();
    const eth = createDetector();

    const btcWalls = btc.detect(createOrderBook([createLevel(100, 6_000)]));
    const ethWalls = eth.detect(createOrderBook([], [createLevel(200, 3_000)]));

    expect(btcWalls.map((wall) => wall.side)).toEqual([WallSide.BUY]);
    expect(ethWalls.map((wall) => wall.side)).toEqual([WallSide.SELL]);
  });
});
