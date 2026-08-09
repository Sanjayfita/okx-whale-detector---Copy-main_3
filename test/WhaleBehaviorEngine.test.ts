import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WhaleBehaviorEngine } from '../src/core/WhaleBehaviorEngine';

import type { Whale, WhaleSide } from '../src/types/whale';

const createWhale = (overrides: Partial<Whale> = {}): Whale => ({
  wallId: 'wall-1',
  side: 'BID',

  price: 100,

  size: 10_000,

  notionalQuote: 1_000_000,

  quoteCurrency: 'USDT',

  detectedAt: Date.now(),

  firstSeenAt: Date.now(),

  lastSeenAt: Date.now(),

  ageSeconds: 0,

  updateCount: 1,

  maxNotionalQuote: 1_000_000,

  ...overrides,
});

const hasBehavior = (
  behaviors: ReturnType<WhaleBehaviorEngine['analyze']>,

  type: string,
): boolean => behaviors.some((behavior) => behavior.type === type);

describe('WhaleBehaviorEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-07-26T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not emit ABSORPTION for a near-market whale without trade data', () => {
    const engine = new WhaleBehaviorEngine();

    const whale = createWhale({
      price: 100,

      ageSeconds: 10,
    });

    const behaviors = engine.analyze(whale);

    expect(hasBehavior(behaviors, 'ABSORPTION')).toBe(false);
  });

  it('does not emit ABSORPTION after a whale remains active for a long time', () => {
    const engine = new WhaleBehaviorEngine();

    const firstSeenAt = Date.now();

    engine.analyze(
      createWhale({
        firstSeenAt,
        ageSeconds: 0,
      }),
    );

    vi.advanceTimersByTime(10 * 60 * 1_000);

    const behaviors = engine.analyze(
      createWhale({
        firstSeenAt,
        detectedAt: firstSeenAt,

        lastSeenAt: Date.now(),

        ageSeconds: 600,
      }),
    );

    expect(hasBehavior(behaviors, 'ABSORPTION')).toBe(false);
  });

  it.each<WhaleSide>(['BID', 'ASK'])(
    'does not infer ABSORPTION from %s wall age or side',
    (side) => {
      const engine = new WhaleBehaviorEngine();

      const behaviors = engine.analyze(
        createWhale({
          side,

          price: side === 'BID' ? 99.99 : 100.01,

          ageSeconds: 120,
        }),
      );

      expect(behaviors.map((behavior) => behavior.type)).not.toContain(
        'ABSORPTION',
      );
    },
  );

  it('still emits PERSISTENT for an old whale', () => {
    const engine = new WhaleBehaviorEngine();

    const behaviors = engine.analyze(
      createWhale({
        ageSeconds: 30,
      }),
    );

    expect(behaviors.map((behavior) => behavior.type)).toContain('PERSISTENT');
  });

  it('exposes immutable event-time lifecycle metrics without changing behavior', () => {
    const engine = new WhaleBehaviorEngine();
    const firstSeenAt = Date.now();
    engine.analyze(
      createWhale({
        firstSeenAt,
        price: 100,
        notionalQuote: 1_000_000,
      }),
    );
    vi.advanceTimersByTime(1_000);
    engine.analyze(
      createWhale({
        firstSeenAt,
        price: 101,
        notionalQuote: 1_200_000,
        ageSeconds: 1,
      }),
    );
    vi.advanceTimersByTime(1_000);
    const current = createWhale({
      firstSeenAt,
      price: 99,
      notionalQuote: 900_000,
      ageSeconds: 2,
    });
    engine.analyze(current);

    const metrics = engine.getLifecycleMetrics(current);
    expect(metrics).toEqual(
      expect.objectContaining({
        wallId: 'wall-1',
        firstSeenAt,
        availabilityTimestamp: Date.now(),
        lifetimeMs: 2_000,
        updateCount: 3,
        initialNotionalQuote: 1_000_000,
        currentNotionalQuote: 900_000,
        highestNotionalQuote: 1_200_000,
        lowestNotionalQuote: 900_000,
        increaseCount: 1,
        decreaseCount: 1,
        initialPrice: 100,
        currentPrice: 99,
      }),
    );
    expect(metrics?.priceChangePercent).toBeCloseTo(-1);
    expect(metrics?.notionalChangeFromInitialPercent).toBeCloseTo(-10);
    expect(metrics?.peakDrawdownPercent).toBeCloseTo(25);
    expect(metrics?.recoveryFromMinimumPercent).toBe(0);
    expect(Object.isFrozen(metrics)).toBe(true);
  });

  it('still detects a young removed wall as SPOOF', () => {
    const engine = new WhaleBehaviorEngine();

    const behavior = engine.analyzeRemoval(
      createWhale({
        ageSeconds: 2,
      }),
    );

    expect(behavior?.type).toBe('SPOOF');
  });

  it('does not label an older removed wall as SPOOF', () => {
    const engine = new WhaleBehaviorEngine();

    const behavior = engine.analyzeRemoval(
      createWhale({
        ageSeconds: 10,
      }),
    );

    expect(behavior).toBeUndefined();
  });
});
