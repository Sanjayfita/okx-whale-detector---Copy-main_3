import { describe, expect, it } from 'vitest';

import { TradeFlowTracker } from '../src/core/TradeFlowTracker';
import type { Whale } from '../src/types/whale';

const whale = (side: 'BID' | 'ASK', ageSeconds = 1): Whale => ({
  wallId: `wall:${side}`,
  side,
  price: 100,
  size: 10,
  notionalQuote: 1_000,
  quoteCurrency: 'USDT',
  detectedAt: 1_000,
  firstSeenAt: 1_000,
  lastSeenAt: 2_000,
  ageSeconds,
});

describe('TradeFlowTracker', () => {
  it('classifies a removed ask wall as likely executed after aggressive buying', () => {
    const now = 5_000;
    const tracker = new TradeFlowTracker(1, {
      clock: () => now,
      executionConfirmationRatio: 0.25,
    });

    tracker.record({
      instId: 'BTC-USDT',
      tradeId: 'trade-1',
      price: 100.05,
      size: 3,
      side: 'BUY',
      timestamp: 4_900,
    });

    const assessment = tracker.assessRemoval(whale('ASK'), 10_000, now);

    expect(assessment.classification).toBe('LIKELY_EXECUTED');
    expect(assessment.executedRatio).toBeCloseTo(0.30015, 5);
    expect(assessment.confidence).toBeGreaterThan(55);
  });

  it('uses cautious cancellation language when trade confirmation is absent', () => {
    const tracker = new TradeFlowTracker(1, { clock: () => 5_000 });

    const assessment = tracker.assessRemoval(whale('BID', 2), 5_000, 5_000);

    expect(assessment.classification).toBe('POSSIBLE_CANCELLATION');
    expect(assessment.confidence).toBeLessThanOrEqual(65);
    expect(assessment.reason).toContain('without sufficient executed-trade');
  });

  it('deduplicates trades and prunes old observations', () => {
    let now = 10_000;
    const tracker = new TradeFlowTracker(1, {
      clock: () => now,
      lookbackMs: 1_000,
    });
    const trade = {
      instId: 'BTC-USDT',
      tradeId: 'trade-1',
      price: 100,
      size: 1,
      side: 'SELL' as const,
      timestamp: 9_500,
    };

    expect(tracker.record(trade)).toBe(true);
    expect(tracker.record(trade)).toBe(false);
    expect(tracker.getSnapshot().tradeCount).toBe(1);

    now = 11_001;
    expect(tracker.getSnapshot().tradeCount).toBe(0);
  });

  it('keeps out-of-order trades sorted so stale observations are pruned', () => {
    let now = 10_000;
    const tracker = new TradeFlowTracker(1, {
      clock: () => now,
      lookbackMs: 1_000,
    });

    expect(
      tracker.record({
        instId: 'BTC-USDT',
        tradeId: 'newer',
        price: 100,
        size: 1,
        side: 'SELL',
        timestamp: 9_800,
      }),
    ).toBe(true);
    expect(
      tracker.record({
        instId: 'BTC-USDT',
        tradeId: 'older',
        price: 100,
        size: 1,
        side: 'SELL',
        timestamp: 9_500,
      }),
    ).toBe(true);
    expect(tracker.getSnapshot()).toMatchObject({
      tradeCount: 2,
      oldestTimestamp: 9_500,
      newestTimestamp: 9_800,
    });

    now = 10_501;
    expect(tracker.getSnapshot()).toMatchObject({
      tradeCount: 1,
      oldestTimestamp: 9_800,
      newestTimestamp: 9_800,
    });
  });

  it('rejects implausibly future trades and never uses future flow early', () => {
    let now = 5_000;
    const tracker = new TradeFlowTracker(1, {
      clock: () => now,
      maximumFutureSkewMs: 5_000,
    });

    expect(
      tracker.record({
        instId: 'BTC-USDT',
        tradeId: 'too-far-ahead',
        price: 100,
        size: 3,
        side: 'BUY',
        timestamp: 10_001,
      }),
    ).toBe(false);
    expect(
      tracker.record({
        instId: 'BTC-USDT',
        tradeId: 'within-clock-skew',
        price: 100,
        size: 3,
        side: 'BUY',
        timestamp: 9_000,
      }),
    ).toBe(true);

    expect(tracker.getSnapshot().tradeCount).toBe(0);
    expect(tracker.assessRemoval(whale('ASK'), 10_000).classification).toBe(
      'POSSIBLE_CANCELLATION',
    );

    now = 9_000;
    expect(tracker.getSnapshot().tradeCount).toBe(1);
    expect(tracker.assessRemoval(whale('ASK'), 10_000).classification).toBe(
      'LIKELY_EXECUTED',
    );
  });

  it('calculates a liquidity-normalized whale threshold', () => {
    expect(
      TradeFlowTracker.calculateLiquidityNormalizedThreshold(
        20_000_000,
        500_000,
        0.05,
      ),
    ).toBe(1_000_000);
  });

  it('retains a bounded event-time research window without widening behavior flow', () => {
    let now = 60_000;
    const tracker = new TradeFlowTracker(2, {
      clock: () => now,
      lookbackMs: 5_000,
      researchRetentionMs: 60_000,
    });
    expect(
      tracker.record({
        instId: 'BTC-USDT',
        tradeId: 'research-trade',
        price: 100,
        size: 3,
        side: 'BUY',
        timestamp: now - 1_000,
      }),
    ).toBe(true);

    now += 10_000;
    expect(tracker.getSnapshot().tradeCount).toBe(0);
    expect(tracker.getResearchTrades(now, 60_000)).toEqual([
      {
        tradeId: 'research-trade',
        eventTimestamp: 59_000,
        availabilityTimestamp: 60_000,
        side: 'BUY',
        price: 100,
        size: 3,
        notionalQuote: 600,
      },
    ]);
  });
});
