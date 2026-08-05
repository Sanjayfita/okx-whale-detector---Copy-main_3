import { describe, expect, it, vi } from 'vitest';

import { WallDetector } from '../src/core/WallDetector';

import { SummaryThrottle } from '../src/core/SummaryThrottle';

import { appConfig } from '../src/config/appConfig';

import type { OrderBook, OrderLevel } from '../src/types/orderbook';

const createLevel = (price: number, notionalQuote: number): OrderLevel => {
  const size = notionalQuote / price;

  return {
    price,
    rawPrice: price.toString(),
    size,
    rawSize: size.toString(),
    notionalQuote,
    quoteCurrency: 'USDT',
    updatedAt: Date.now(),
  };
};

const createOrderBook = (bidLevels: OrderLevel[]): OrderBook => ({
  bids: new Map(bidLevels.map((level) => [level.price, level])),

  asks: new Map(),

  lastSeqId: 1,
  status: 'SYNCED',
  initialized: true,
  updatedAt: Date.now(),
});

describe('central configuration injection', () => {
  it('contains the expected application defaults', () => {
    expect(appConfig.whale.minimumNotionalQuote).toBe(500_000);

    expect(appConfig.whale.persistentAfterMs).toBe(30_000);

    expect(appConfig.whale.strongAfterMs).toBe(120_000);

    expect(appConfig.events.removalGraceMs).toBe(2_000);

    expect(appConfig.reporting.summaryIntervalMs).toBe(5_000);

    expect(appConfig.correlation).toEqual({
      okxWeight: 0.7,
      externalWeight: 0.3,
      minimumEffectiveConfidence: 5,
      agreementBonus: 8,
      contradictionPenalty: 15,
      maximumConfidence: 100,
    });

    expect(appConfig.correlatedAlerts).toEqual({
      enabled: true,
      minimumAgreementAlertImportance: 55,
      minimumContradictionAlertImportance: 55,
      externalOnlyAlertsEnabled: false,
      minimumExternalOnlyAlertImportance: 55,
      cooldownSeconds: 60,
      confidenceChangeThreshold: 10,
      severityThresholds: {
        watch: 55,
        strong: 65,
        critical: 80,
      },
    });

    expect(appConfig.correlatedAlertRecording).toEqual({
      enabled: true,
      outputPath: 'data/alerts/correlated-alerts.jsonl',
      flushAfterEachAlert: true,
    });
  });

  it('changes wall detection when a smaller threshold is injected', () => {
    const orderBook = createOrderBook([
      /*
       * This level is below the
       * production $500,000 threshold.
       */
      createLevel(100, 10_000),
    ]);

    const productionDetector = new WallDetector({
      minNotionalQuote: appConfig.whale.minimumNotionalQuote,

      persistentAfterMs: appConfig.whale.persistentAfterMs,

      strongAfterMs: appConfig.whale.strongAfterMs,

      priceTolerancePercent: 0.1,

      removalGracePeriodMs: appConfig.events.removalGraceMs,
    });

    const testDetector = new WallDetector({
      /*
       * Very small test threshold.
       */
      minNotionalQuote: 1_000,

      persistentAfterMs: 100,

      strongAfterMs: 200,

      priceTolerancePercent: 0.1,

      removalGracePeriodMs: 50,
    });

    const productionWalls = productionDetector.detect(orderBook);

    const testWalls = testDetector.detect(orderBook);

    expect(productionWalls).toHaveLength(0);

    expect(testWalls).toHaveLength(1);

    expect(testWalls[0]?.currentNotional).toBe(10_000);
  });

  it('changes persistence behavior when smaller ages are injected', () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-07-25T12:00:00Z'));

    const detector = new WallDetector({
      minNotionalQuote: 1_000,

      persistentAfterMs: 100,

      strongAfterMs: 200,

      priceTolerancePercent: 0.1,

      removalGracePeriodMs: 50,
    });

    const orderBook = createOrderBook([createLevel(100, 10_000)]);

    const firstResult = detector.detect(orderBook);

    expect(firstResult[0]?.status).toBe('NEW');

    vi.advanceTimersByTime(100);

    const persistentResult = detector.detect(orderBook);

    expect(persistentResult[0]?.status).toBe('PERSISTENT');

    vi.advanceTimersByTime(100);

    const strongResult = detector.detect(orderBook);

    expect(strongResult[0]?.status).toBe('STRONG');

    vi.useRealTimers();
  });

  it('changes reporting timing when a smaller interval is injected', () => {
    const productionThrottle = new SummaryThrottle(
      appConfig.reporting.summaryIntervalMs,
    );

    const testThrottle = new SummaryThrottle(100);

    expect(productionThrottle.shouldDisplay('BTC-USDT', 1_000)).toBe(true);

    expect(testThrottle.shouldDisplay('BTC-USDT', 1_000)).toBe(true);

    /*
     * Only 100 milliseconds later:
     *
     * production interval = blocked
     * test interval = allowed
     */
    expect(productionThrottle.shouldDisplay('BTC-USDT', 1_100)).toBe(false);

    expect(testThrottle.shouldDisplay('BTC-USDT', 1_100)).toBe(true);
  });
});
