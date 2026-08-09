import { describe, expect, it, vi } from 'vitest';

import type { OKXCandle } from '../src/clients/okx/OKXCandleWebSocketClient';
import type { OKXOrderBookUpdate } from '../src/clients/okx/OKXWebSocketClient';
import { SubscriptionManager } from '../src/core/SubscriptionManager';
import type { MarketInstrumentConfig } from '../src/types/instrument';

class MockOrderBookClient {
  public readonly subscriptions: Array<[string, string]> = [];
  public closeCount = 0;
  public reconnectCallback?: () => void;
  public orderBookCallback?: (update: OKXOrderBookUpdate) => void;

  public onReconnect(callback: () => void): void {
    this.reconnectCallback = callback;
  }

  public onOrderBook(callback: (update: OKXOrderBookUpdate) => void): void {
    this.orderBookCallback = callback;
  }

  public subscribeToOrderBook(instId: string, instType: string): void {
    this.subscriptions.push([instId, instType]);
  }

  public close(): void {
    this.closeCount += 1;
  }
}

class MockCandleClient {
  public readonly subscriptions: string[] = [];
  public closeCount = 0;
  public candleCallback?: (candle: OKXCandle) => void;

  public onCandle(callback: (candle: OKXCandle) => void): void {
    this.candleCallback = callback;
  }

  public subscribeToCandle(instId: string): void {
    this.subscriptions.push(instId);
  }

  public close(): void {
    this.closeCount += 1;
  }
}

const instrument = (
  instId: string,
  instType: 'SPOT' | 'SWAP' = 'SPOT',
): MarketInstrumentConfig => ({
  instId,
  instType,
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
});

const instruments = Array.from({ length: 12 }, (_, index) =>
  instrument(`TOKEN${index + 1}-USDT`),
);

describe('SubscriptionManager', () => {
  it('splits twelve instruments into two six-symbol shards', () => {
    const orderBookClients: MockOrderBookClient[] = [];
    const candleClients: MockCandleClient[] = [];
    const manager = new SubscriptionManager({
      maximumSymbolsPerConnection: 6,
      createOrderBookClient: () => {
        const client = new MockOrderBookClient();
        orderBookClients.push(client);
        return client;
      },
      createCandleClient: () => {
        const client = new MockCandleClient();
        candleClients.push(client);
        return client;
      },
      onOrderBook: vi.fn(),
      onCandle: vi.fn(),
      onShardReconnect: vi.fn(),
    });

    manager.start(instruments);

    expect(manager.getShards()).toEqual([
      {
        index: 0,
        symbols: instruments.slice(0, 6).map((entry) => entry.instId),
      },
      {
        index: 1,
        symbols: instruments.slice(6).map((entry) => entry.instId),
      },
    ]);
    expect(orderBookClients).toHaveLength(2);
    expect(candleClients).toHaveLength(2);
  });

  it('subscribes every instrument exactly once on both channels', () => {
    const orderBookClients: MockOrderBookClient[] = [];
    const candleClients: MockCandleClient[] = [];
    const manager = new SubscriptionManager({
      maximumSymbolsPerConnection: 5,
      createOrderBookClient: () => {
        const client = new MockOrderBookClient();
        orderBookClients.push(client);
        return client;
      },
      createCandleClient: () => {
        const client = new MockCandleClient();
        candleClients.push(client);
        return client;
      },
      onOrderBook: vi.fn(),
      onCandle: vi.fn(),
      onShardReconnect: vi.fn(),
    });

    manager.start([
      instrument('BTC-USDT'),
      instrument('XAU-USDT-SWAP', 'SWAP'),
      instrument('ETH-USDT'),
    ]);

    expect(orderBookClients.flatMap((client) => client.subscriptions)).toEqual([
      ['BTC-USDT', 'SPOT'],
      ['XAU-USDT-SWAP', 'SWAP'],
      ['ETH-USDT', 'SPOT'],
    ]);
    expect(candleClients.flatMap((client) => client.subscriptions)).toEqual([
      'BTC-USDT',
      'XAU-USDT-SWAP',
      'ETH-USDT',
    ]);
  });

  it('reports only the symbols belonging to the reconnected shard', () => {
    const orderBookClients: MockOrderBookClient[] = [];
    const onShardReconnect = vi.fn();
    const manager = new SubscriptionManager({
      maximumSymbolsPerConnection: 2,
      createOrderBookClient: () => {
        const client = new MockOrderBookClient();
        orderBookClients.push(client);
        return client;
      },
      createCandleClient: () => new MockCandleClient(),
      onOrderBook: vi.fn(),
      onCandle: vi.fn(),
      onShardReconnect,
    });

    manager.start(instruments.slice(0, 5));
    orderBookClients[1]?.reconnectCallback?.();

    expect(onShardReconnect).toHaveBeenCalledTimes(1);
    expect(onShardReconnect).toHaveBeenCalledWith([
      'TOKEN3-USDT',
      'TOKEN4-USDT',
    ]);
  });

  it('forwards order-book and candle callbacks', () => {
    const orderBookClient = new MockOrderBookClient();
    const candleClient = new MockCandleClient();
    const onOrderBook = vi.fn();
    const onCandle = vi.fn();
    const manager = new SubscriptionManager({
      maximumSymbolsPerConnection: 5,
      createOrderBookClient: () => orderBookClient,
      createCandleClient: () => candleClient,
      onOrderBook,
      onCandle,
      onShardReconnect: vi.fn(),
    });

    manager.start([instrument('BTC-USDT')]);

    const update = {
      instId: 'BTC-USDT',
      action: 'snapshot',
      asks: [],
      bids: [],
      timestamp: 1,
      seqId: 1,
      prevSeqId: -1,
    } satisfies OKXOrderBookUpdate;
    const candle = {
      instId: 'BTC-USDT',
      timestamp: 1,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
      volumeCurrency: 1,
      volumeCurrencyQuote: 1,
      confirm: true,
    } satisfies OKXCandle;

    orderBookClient.orderBookCallback?.(update);
    candleClient.candleCallback?.(candle);

    expect(onOrderBook).toHaveBeenCalledWith(update);
    expect(onCandle).toHaveBeenCalledWith(candle);
  });

  it('closes every shard client', () => {
    const orderBookClients: MockOrderBookClient[] = [];
    const candleClients: MockCandleClient[] = [];
    const manager = new SubscriptionManager({
      maximumSymbolsPerConnection: 4,
      createOrderBookClient: () => {
        const client = new MockOrderBookClient();
        orderBookClients.push(client);
        return client;
      },
      createCandleClient: () => {
        const client = new MockCandleClient();
        candleClients.push(client);
        return client;
      },
      onOrderBook: vi.fn(),
      onCandle: vi.fn(),
      onShardReconnect: vi.fn(),
    });

    manager.start(instruments.slice(0, 9));
    manager.close();

    expect(orderBookClients.every((client) => client.closeCount === 1)).toBe(
      true,
    );
    expect(candleClients.every((client) => client.closeCount === 1)).toBe(true);
    expect(manager.getShards()).toEqual([]);
  });

  it('rejects duplicate instruments and repeated startup', () => {
    const manager = new SubscriptionManager({
      maximumSymbolsPerConnection: 2,
      createOrderBookClient: () => new MockOrderBookClient(),
      createCandleClient: () => new MockCandleClient(),
      onOrderBook: vi.fn(),
      onCandle: vi.fn(),
      onShardReconnect: vi.fn(),
    });

    expect(() =>
      manager.start([instrument('BTC-USDT'), instrument('BTC-USDT')]),
    ).toThrow('Duplicate subscription instrument');

    const freshManager = new SubscriptionManager({
      maximumSymbolsPerConnection: 2,
      createOrderBookClient: () => new MockOrderBookClient(),
      createCandleClient: () => new MockCandleClient(),
      onOrderBook: vi.fn(),
      onCandle: vi.fn(),
      onShardReconnect: vi.fn(),
    });

    freshManager.start([instrument('BTC-USDT')]);

    expect(() => freshManager.start([instrument('ETH-USDT')])).toThrow(
      'already been started',
    );
  });
});
