import { describe, expect, it } from 'vitest';
import type { OKXOrderBookUpdate } from '../src/clients/okx/OKXWebSocketClient';
import type { SymbolProfile } from '../src/config/symbolProfiles';
import {
  startLeanPaperExecutionMarketData,
  type LeanExecutionOrderBookClient,
} from '../src/platform/LeanPaperExecutionMarketData';
import type { MarketInstrumentConfig } from '../src/types/instrument';

class FakeOrderBookClient implements LeanExecutionOrderBookClient {
  public readonly subscriptions: string[] = [];
  public readonly resubscriptions: string[] = [];
  public closed = false;
  private orderBookCallback: ((update: OKXOrderBookUpdate) => void) | null = null;
  private reconnectCallback: (() => void) | null = null;

  public onOrderBook(callback: (update: OKXOrderBookUpdate) => void): void {
    this.orderBookCallback = callback;
  }

  public onReconnect(callback: () => void): void {
    this.reconnectCallback = callback;
  }

  public subscribeToOrderBook(instId: string): void {
    this.subscriptions.push(instId);
  }

  public resubscribeOrderBook(instId: string): void {
    this.resubscriptions.push(instId);
  }

  public close(): void {
    this.closed = true;
  }

  public emit(update: OKXOrderBookUpdate): void {
    this.orderBookCallback?.(update);
  }

  public reconnect(): void {
    this.reconnectCallback?.();
  }
}

const profile: SymbolProfile = {
  symbol: 'BTC-USDT-SWAP',
  instrumentType: 'SWAP',
};

const instrument: MarketInstrumentConfig = {
  instId: profile.symbol,
  instType: 'SWAP',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 0.01,
};

const update = (
  action: 'snapshot' | 'update',
  sequence: number,
  previousSequence: number,
): OKXOrderBookUpdate => ({
  instId: profile.symbol,
  action,
  asks: [['101', '10', '0', '1']],
  bids: [['100', '10', '0', '1']],
  timestamp: 1_000 + sequence,
  seqId: sequence,
  prevSeqId: previousSequence,
});

describe('startLeanPaperExecutionMarketData', () => {
  it('runs with only instrument metadata and bounded order-book state', async () => {
    const client = new FakeOrderBookClient();
    const observed: number[] = [];
    const runtime = await startLeanPaperExecutionMarketData({
      profiles: [profile],
      instrumentLoader: {
        loadMarketInstruments: async () => new Map([[profile.symbol, instrument]]),
      },
      orderBookClient: client,
      onOrderBook: (_instrumentId, state) => {
        observed.push(state.orderBookManager.getOrderBook().lastSeqId ?? -1);
      },
    });

    expect(runtime.instruments).toBe(1);
    expect(client.subscriptions).toEqual([profile.symbol]);

    client.emit(update('snapshot', 10, 0));
    expect(observed).toEqual([10]);

    client.emit(update('update', 11, 999));
    client.emit(update('update', 12, 999));
    expect(client.resubscriptions).toEqual([profile.symbol]);

    client.emit(update('snapshot', 20, 0));
    client.emit(update('update', 21, 999));
    expect(client.resubscriptions).toEqual([profile.symbol, profile.symbol]);

    runtime.close();
    expect(client.closed).toBe(true);
  });

  it('marks books for fresh snapshots after a websocket reconnect', async () => {
    const client = new FakeOrderBookClient();
    let usable = false;
    const runtime = await startLeanPaperExecutionMarketData({
      profiles: [profile],
      instrumentLoader: {
        loadMarketInstruments: async () => new Map([[profile.symbol, instrument]]),
      },
      orderBookClient: client,
      onOrderBook: (_instrumentId, state) => {
        usable = state.orderBookManager.isUsableForSignals();
      },
    });

    client.emit(update('snapshot', 10, 0));
    expect(usable).toBe(true);
    client.reconnect();
    client.emit(update('update', 11, 10));
    expect(client.resubscriptions).toEqual([profile.symbol]);
    runtime.close();
  });
});
