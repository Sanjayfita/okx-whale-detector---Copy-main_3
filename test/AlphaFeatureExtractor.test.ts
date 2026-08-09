import { describe, expect, it } from 'vitest';

import { extractAlphaFeatures } from '../src/research/alphaFeatureExtractor';
import { ALPHA_FEATURE_NAMES } from '../src/research/alphaFeatureTypes';
import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { parseAlphaResearchEventSnapshot } from '../src/research/alphaSnapshotParser';
import {
  createAlphaCandleFixtures,
  createAlphaSnapshotFixture,
} from './AlphaResearchFixtures';

describe('alpha feature extraction', () => {
  it('computes all 50 configured features from information available at alert time', () => {
    const snapshot = createAlphaSnapshotFixture();
    const result = extractAlphaFeatures(
      snapshot,
      createAlphaResearchConfig().extraction,
    );

    expect(ALPHA_FEATURE_NAMES).toHaveLength(50);
    expect(result.availableFeatureCount).toBe(50);
    expect(result.missingFeatureCount).toBe(0);
    expect(result.values.ema_alignment_directional).toBe(1);
    expect(result.values.ema_multi_timeframe_alignment_directional).toBe(1);
    expect(result.values.book_imbalance_l1_directional).toBeCloseTo(0.5);
    expect(result.values.cvd_ratio_directional).toBeCloseTo(0.6);
    expect(result.values.wall_persistence_seconds).toBe(12);
    expect(result.values.refill_count).toBe(3);
    expect(result.values.execution_ratio).toBe(0.6);
    expect(Object.isFrozen(result.values)).toBe(true);
    expect(result.synthetic).toBe(true);
  });

  it('uses direction-normalized features for bearish whale alerts', () => {
    const bullish = extractAlphaFeatures(
      createAlphaSnapshotFixture({ direction: 'BULLISH' }),
      createAlphaResearchConfig().extraction,
    );
    const bearish = extractAlphaFeatures(
      createAlphaSnapshotFixture({ direction: 'BEARISH' }),
      createAlphaResearchConfig().extraction,
    );

    expect(bearish.values.ema_alignment_directional).toBe(-1);
    expect(bearish.values.cvd_ratio_directional).toBeCloseTo(
      -(bullish.values.cvd_ratio_directional ?? 0),
    );
    expect(bearish.values.spread_bps).toBe(bullish.values.spread_bps);
  });

  it('rejects future candles, future trades, and duplicate trade IDs', () => {
    const snapshot = createAlphaSnapshotFixture();
    const latestCandle = snapshot.candles[snapshot.candles.length - 1];
    expect(() =>
      extractAlphaFeatures(
        {
          ...snapshot,
          candles: [
            ...snapshot.candles.slice(0, -1),
            {
              ...latestCandle,
              availabilityTimestamp: snapshot.evidence.detectedAt + 1,
            },
          ],
        },
        createAlphaResearchConfig().extraction,
      ),
    ).toThrow('future information');

    expect(() =>
      extractAlphaFeatures(
        {
          ...snapshot,
          trades: [
            ...snapshot.trades,
            {
              ...snapshot.trades[0],
              tradeId: 'future-trade',
              eventTimestamp: snapshot.evidence.detectedAt + 1,
              availabilityTimestamp: snapshot.evidence.detectedAt + 1,
            },
          ],
        },
        createAlphaResearchConfig().extraction,
      ),
    ).toThrow('future information');

    expect(() =>
      extractAlphaFeatures(
        { ...snapshot, trades: [...snapshot.trades, snapshot.trades[0]] },
        createAlphaResearchConfig().extraction,
      ),
    ).toThrow('duplicate tradeId');
  });

  it('marks stale books and candle histories with gaps unavailable', () => {
    const snapshot = createAlphaSnapshotFixture();
    const staleBook = extractAlphaFeatures(
      {
        ...snapshot,
        orderBook:
          snapshot.orderBook === null
            ? null
            : {
                ...snapshot.orderBook,
                eventTimestamp: snapshot.evidence.detectedAt - 6_100,
                availabilityTimestamp: snapshot.evidence.detectedAt - 6_000,
              },
      },
      createAlphaResearchConfig().extraction,
    );
    expect(staleBook.values.book_imbalance_l1_directional).toBeNull();
    expect(staleBook.values.spread_bps).toBeNull();

    const lateStaleBook = extractAlphaFeatures(
      {
        ...snapshot,
        orderBook:
          snapshot.orderBook === null
            ? null
            : {
                ...snapshot.orderBook,
                eventTimestamp: snapshot.evidence.detectedAt - 6_000,
                availabilityTimestamp: snapshot.evidence.detectedAt,
              },
      },
      createAlphaResearchConfig().extraction,
    );
    expect(lateStaleBook.values.book_imbalance_l1_directional).toBeNull();

    const candlesWithGap = snapshot.candles.filter(
      (_, index) => index !== snapshot.candles.length - 5,
    );
    const gapped = extractAlphaFeatures(
      { ...snapshot, candles: candlesWithGap },
      createAlphaResearchConfig().extraction,
    );
    expect(gapped.values.ema_fast_distance_directional_percent).toBeNull();
    expect(gapped.values.session_asia).not.toBeNull();

    const staleCandles = snapshot.candles.map((candle) => ({
      ...candle,
      intervalStart: candle.intervalStart - 10 * 60_000,
      intervalEnd: candle.intervalEnd - 10 * 60_000,
      availabilityTimestamp: snapshot.evidence.detectedAt,
    }));
    const stale = extractAlphaFeatures(
      { ...snapshot, candles: staleCandles },
      createAlphaResearchConfig().extraction,
    );
    expect(stale.values.ema_alignment_directional).toBeNull();
  });

  it('rejects crossed books, invalid whale probabilities, and unconfirmed candles', () => {
    const snapshot = createAlphaSnapshotFixture();
    expect(() =>
      extractAlphaFeatures(
        {
          ...snapshot,
          orderBook:
            snapshot.orderBook === null
              ? null
              : {
                  ...snapshot.orderBook,
                  bids: [{ price: 100.2, size: 1 }],
                  asks: [{ price: 100.1, size: 1 }],
                },
        },
        createAlphaResearchConfig().extraction,
      ),
    ).toThrow('crossed or locked');

    expect(() =>
      extractAlphaFeatures(
        {
          ...snapshot,
          whale: { ...snapshot.whale, spoofProbability: 1.1 },
        },
        createAlphaResearchConfig().extraction,
      ),
    ).toThrow('spoofProbability');

    expect(() =>
      extractAlphaFeatures(
        {
          ...snapshot,
          whale: {
            ...snapshot.whale,
            availabilityTimestamp: snapshot.evidence.detectedAt + 1,
          },
        },
        createAlphaResearchConfig().extraction,
      ),
    ).toThrow('future information');

    const candles = createAlphaCandleFixtures(snapshot.evidence.detectedAt);
    expect(() =>
      extractAlphaFeatures(
        {
          ...snapshot,
          candles: [
            ...candles.slice(0, -1),
            {
              ...candles[candles.length - 1],
              availabilityTimestamp:
                candles[candles.length - 1].intervalEnd - 1,
            },
          ],
        },
        createAlphaResearchConfig().extraction,
      ),
    ).toThrow('before it was confirmed');
  });

  it('keeps disabled candidates null and validates configurable periods', () => {
    const config = createAlphaResearchConfig({
      extraction: {
        enabledFeatures: ['session_asia'],
        emaFastPeriod: 10,
        emaMediumPeriod: 30,
        emaSlowPeriod: 100,
      },
    });
    const result = extractAlphaFeatures(
      createAlphaSnapshotFixture(),
      config.extraction,
    );
    expect(result.availableFeatureCount).toBe(1);
    expect(result.values.session_asia).not.toBeNull();
    expect(result.values.ema_alignment_directional).toBeNull();

    expect(() =>
      createAlphaResearchConfig({
        extraction: { emaFastPeriod: 50, emaMediumPeriod: 20 },
      }),
    ).toThrow('strictly increasing');
  });

  it('round-trips only the versioned research-only snapshot envelope', () => {
    const snapshot = createAlphaSnapshotFixture();
    const roundTrip = parseAlphaResearchEventSnapshot(
      JSON.parse(JSON.stringify(snapshot)) as unknown,
    );
    expect(roundTrip).toEqual(snapshot);
    expect(
      parseAlphaResearchEventSnapshot({
        ...snapshot,
        liveOrderExecutionAllowed: true,
      }),
    ).toBeUndefined();
    expect(
      parseAlphaResearchEventSnapshot({ ...snapshot, schemaVersion: 99 }),
    ).toBeUndefined();
  });
});
