import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OKXCandle } from '../src/clients/okx/OKXCandleWebSocketClient';
import type { OKXOrderBookUpdate } from '../src/clients/okx/OKXWebSocketClient';
import { SubscriptionManager } from '../src/core/SubscriptionManager';

class MockOrderBookClient {
  public resubscriptions: string[] = [];
  public orderBookCallback?: (update: OKXOrderBookUpdate) => void;

  public onReconnect(_callback: () => void): void {}

  public onOrderBook(callback: (update: OKXOrderBookUpdate) => void): void {
    this.orderBookCallback = callback;
  }

  public subscribeToOrderBook(): void {}

  public resubscribeOrderBook(instId: string): void {
    this.resubscriptions.push(instId);
  }

  public close(): void {}
}

class MockCandleClient {
  public onCandle(_callback: (candle: OKXCandle) => void): void {}

  public subscribeToCandle(): void {}

  public close(): void {}
}

describe('SubscriptionManager per-symbol resync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resubscribes only the affected symbol and completes on snapshot', () => {
    const orderBookClient = new MockOrderBookClient();
    const recovered = vi.fn();
    const manager = new SubscriptionManager({
      maximumSymbolsPerConnection: 6,
      createOrderBookClient: () => orderBookClient,
      createCandleClient: () => new MockCandleClient(),
      onOrderBook: vi.fn(),
      onCandle: vi.fn(),
      onShardReconnect: vi.fn(),
      orderBookResync: {
        snapshotTimeoutMs: 1_000,
        onRecovered: recovered,
      },
    });

    manager.start([
      {
        instId: 'BTC-USDT',
        instType: 'SPOT',
        quoteCurrency: 'USDT',
        baseUnitsPerSize: 1,
      },
      {
        instId: 'ETH-USDT',
        instType: 'SPOT',
        quoteCurrency: 'USDT',
        baseUnitsPerSize: 1,
      },
    ]);

    expect(manager.requestOrderBookResync('BTC-USDT')).toBe(true);
    expect(manager.requestOrderBookResync('BTC-USDT')).toBe(false);
    vi.advanceTimersByTime(0);

    expect(orderBookClient.resubscriptions).toEqual(['BTC-USDT']);
    expect(manager.getOrderBookResyncSnapshot()).toHaveLength(1);

    orderBookClient.orderBookCallback?.({
      instId: 'BTC-USDT',
      action: 'snapshot',
      bids: [],
      asks: [],
      timestamp: 1,
      seqId: 1,
      prevSeqId: -1,
    });

    expect(manager.getOrderBookResyncSnapshot()).toEqual([]);
    expect(recovered).toHaveBeenCalledWith('BTC-USDT', 1);
    expect(orderBookClient.resubscriptions).not.toContain('ETH-USDT');
  });
});
