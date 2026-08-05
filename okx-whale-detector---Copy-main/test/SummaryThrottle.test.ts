import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SummaryThrottle } from '../src/core/SummaryThrottle';

describe('SummaryThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-07-25T12:00:00Z'));
  });

  it('allows BTC and ETH once during the same five-second window', () => {
    const throttle = new SummaryThrottle(5_000);

    expect(throttle.shouldDisplay('BTC-USDT')).toBe(true);

    expect(throttle.shouldDisplay('ETH-USDT')).toBe(true);

    /*
     * Repeated updates for each
     * symbol remain blocked.
     */
    expect(throttle.shouldDisplay('BTC-USDT')).toBe(false);

    expect(throttle.shouldDisplay('ETH-USDT')).toBe(false);
  });

  it('allows each symbol again after five seconds', () => {
    const throttle = new SummaryThrottle(5_000);

    expect(throttle.shouldDisplay('BTC-USDT')).toBe(true);

    expect(throttle.shouldDisplay('ETH-USDT')).toBe(true);

    vi.advanceTimersByTime(4_999);

    expect(throttle.shouldDisplay('BTC-USDT')).toBe(false);

    expect(throttle.shouldDisplay('ETH-USDT')).toBe(false);

    vi.advanceTimersByTime(1);

    expect(throttle.shouldDisplay('BTC-USDT')).toBe(true);

    expect(throttle.shouldDisplay('ETH-USDT')).toBe(true);
  });

  it('tracks symbols independently', () => {
    const throttle = new SummaryThrottle(5_000);

    expect(throttle.shouldDisplay('BTC-USDT')).toBe(true);

    vi.advanceTimersByTime(2_000);

    /*
     * BTC is still throttled,
     * but ETH has never displayed.
     */
    expect(throttle.shouldDisplay('BTC-USDT')).toBe(false);

    expect(throttle.shouldDisplay('ETH-USDT')).toBe(true);

    vi.advanceTimersByTime(3_000);

    /*
     * BTC has now waited 5 seconds.
     * ETH has waited only 3 seconds.
     */
    expect(throttle.shouldDisplay('BTC-USDT')).toBe(true);

    expect(throttle.shouldDisplay('ETH-USDT')).toBe(false);
  });

  it('allows summaries again after reset', () => {
    const throttle = new SummaryThrottle(5_000);

    expect(throttle.shouldDisplay('BTC-USDT')).toBe(true);

    expect(throttle.shouldDisplay('BTC-USDT')).toBe(false);

    throttle.reset('BTC-USDT');

    expect(throttle.shouldDisplay('BTC-USDT')).toBe(true);
  });

  it('can reset all symbols', () => {
    const throttle = new SummaryThrottle(5_000);

    throttle.shouldDisplay('BTC-USDT');

    throttle.shouldDisplay('ETH-USDT');

    throttle.reset();

    expect(throttle.shouldDisplay('BTC-USDT')).toBe(true);

    expect(throttle.shouldDisplay('ETH-USDT')).toBe(true);
  });
});
