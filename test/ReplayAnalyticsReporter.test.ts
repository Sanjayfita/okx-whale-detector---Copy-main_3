import { describe, expect, it } from 'vitest';

import { ReplayAnalyticsReporter } from '../src/recording/ReplayAnalyticsReporter';

import type { WhaleBehavior } from '../src/core/WhaleBehaviorEngine';
import type { WhaleEvent } from '../src/core/WhaleEventDetector';
import type { Whale } from '../src/types/whale';

const whale: Whale = {
  wallId: 'wall-1',
  side: 'BID',
  price: 100,
  size: 10_000,
  notionalQuote: 1_000_000,
  quoteCurrency: 'USDT',
  detectedAt: 1,
};

describe('ReplayAnalyticsReporter', () => {
  it('counts replay detector events without console parsing', () => {
    const reporter = new ReplayAnalyticsReporter();
    const event: WhaleEvent = { type: 'NEW', whale };
    const behavior: WhaleBehavior = {
      type: 'PERSISTENT',
      whale,
      confidence: 90,
      reason: 'Test behavior',
      detectedAt: 2,
    };

    reporter.reportSequenceGap('BTC-USDT');
    reporter.reportWhaleEvent('BTC-USDT', event);
    reporter.reportBehavior(behavior);
    reporter.reportMovedWhale('BTC-USDT', {
      wallId: whale.wallId,
      type: 'MOVED',
      side: whale.side,
      price: 101,
      previousPrice: 100,
      previousSize: whale.size,
      currentSize: whale.size,
      sizeDifference: 0,
      previousNotionalQuote: whale.notionalQuote,
      currentNotionalQuote: whale.notionalQuote,
      timestamp: 2,
    });

    expect(reporter.getTotals()).toMatchObject({
      sequenceGaps: 1,
      whaleEvents: { NEW: 1 },
      movedWhales: 1,
      behaviorEvents: { PERSISTENT: 1 },
    });
  });

  it('returns defensive copies of nested totals', () => {
    const reporter = new ReplayAnalyticsReporter();
    const first = reporter.getTotals();
    first.whaleEvents.NEW = 99;

    expect(reporter.getTotals().whaleEvents.NEW).toBe(0);
  });
});
