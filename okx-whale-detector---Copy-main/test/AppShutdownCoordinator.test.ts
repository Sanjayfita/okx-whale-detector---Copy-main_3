import { describe, expect, it, vi } from 'vitest';

import { AppShutdownCoordinator } from '../src/runtime/AppShutdownCoordinator';

describe('AppShutdownCoordinator', () => {
  it('closes resources once in deterministic order', async () => {
    const order: string[] = [];
    let finishMarketClose: (() => void) | undefined;
    const marketClose = new Promise<void>((resolve) => {
      finishMarketClose = resolve;
    });
    const coordinator = new AppShutdownCoordinator({
      beforeClose: () => order.push('beforeClose'),
      stopPolymarket: () => order.push('polymarket'),
      stopHealthMonitor: () => order.push('health'),
      stopThroughputMonitor: () => order.push('throughput'),
      closeSubscriptions: () => order.push('subscriptions'),
      closeAlertRecorder: () => order.push('alerts'),
      closeMarketRecorder: async (reason) => {
        order.push(`market:${reason}`);
        await marketClose;
      },
    });

    const first = coordinator.shutdown('SIGINT');
    const duplicate = coordinator.shutdown('SIGTERM');

    expect(duplicate).toBe(first);
    expect(order).toEqual([
      'beforeClose',
      'polymarket',
      'health',
      'throughput',
      'subscriptions',
      'alerts',
      'market:SIGINT',
    ]);

    finishMarketClose?.();
    await first;
  });

  it('attempts every close step and surfaces the first failure', async () => {
    const closeMarketRecorder = vi.fn(async () => undefined);
    const closeAlertRecorder = vi.fn(() => {
      throw new Error('alert close failed');
    });
    const coordinator = new AppShutdownCoordinator({
      beforeClose: vi.fn(),
      stopPolymarket: vi.fn(),
      stopHealthMonitor: vi.fn(),
      stopThroughputMonitor: vi.fn(),
      closeSubscriptions: vi.fn(),
      closeAlertRecorder,
      closeMarketRecorder,
    });

    await expect(coordinator.shutdown('APPLICATION_CLOSE')).rejects.toThrow(
      'alert close failed',
    );
    expect(closeAlertRecorder).toHaveBeenCalledOnce();
    expect(closeMarketRecorder).toHaveBeenCalledWith('APPLICATION_CLOSE');
  });
});
