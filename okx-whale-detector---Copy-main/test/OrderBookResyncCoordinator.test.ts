import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderBookResyncCoordinator } from '../src/core/OrderBookResyncCoordinator';

describe('OrderBookResyncCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deduplicates requests and completes after a fresh snapshot', () => {
    const resubscribe = vi.fn();
    const recovered = vi.fn();
    const coordinator = new OrderBookResyncCoordinator(resubscribe, {
      snapshotTimeoutMs: 1_000,
      onRecovered: recovered,
    });

    expect(coordinator.request('BTC-USDT')).toBe(true);
    expect(coordinator.request('BTC-USDT')).toBe(false);

    vi.advanceTimersByTime(0);

    expect(resubscribe).toHaveBeenCalledTimes(1);
    expect(coordinator.isPending('BTC-USDT')).toBe(true);
    expect(coordinator.complete('BTC-USDT')).toBe(true);
    expect(coordinator.isPending('BTC-USDT')).toBe(false);
    expect(recovered).toHaveBeenCalledWith('BTC-USDT', 1);

    vi.advanceTimersByTime(5_000);
    expect(resubscribe).toHaveBeenCalledTimes(1);
  });

  it('retries with bounded exponential backoff and reports failure', () => {
    const resubscribe = vi.fn();
    const failed = vi.fn();
    const coordinator = new OrderBookResyncCoordinator(resubscribe, {
      maximumAttempts: 3,
      baseBackoffMs: 100,
      snapshotTimeoutMs: 500,
      onFailed: failed,
    });

    coordinator.request('ETH-USDT');
    vi.advanceTimersByTime(0);
    expect(resubscribe).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(100);
    expect(resubscribe).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(200);
    expect(resubscribe).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(500);

    expect(failed).toHaveBeenCalledWith('ETH-USDT', 3, undefined);
    expect(coordinator.isPending('ETH-USDT')).toBe(false);
  });

  it('cancels all pending work during shutdown', () => {
    const resubscribe = vi.fn();
    const coordinator = new OrderBookResyncCoordinator(resubscribe);

    coordinator.request('XRP-USDT');
    coordinator.close();
    vi.runAllTimers();

    expect(resubscribe).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot()).toEqual([]);
    expect(coordinator.request('XRP-USDT')).toBe(false);
  });
});
