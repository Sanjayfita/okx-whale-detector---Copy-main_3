import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class MockWebSocket {
    public static readonly CONNECTING = 0;

    public static readonly OPEN = 1;

    public static readonly CLOSING = 2;

    public static readonly CLOSED = 3;

    public readyState = MockWebSocket.CONNECTING;

    public readonly sentMessages: string[] = [];

    public closeCallCount = 0;

    public terminateCallCount = 0;

    private readonly listeners = new Map<string, Listener[]>();

    private readonly onceListeners = new Map<string, Listener[]>();

    public constructor(
      public readonly url: string,

      public readonly options?: unknown,
    ) {
      state.sockets.push(this);
    }

    public on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? [];

      listeners.push(listener);

      this.listeners.set(event, listeners);

      return this;
    }

    public once(event: string, listener: Listener): this {
      const listeners = this.onceListeners.get(event) ?? [];

      listeners.push(listener);

      this.onceListeners.set(event, listeners);

      return this;
    }

    public send(data: string): void {
      this.sentMessages.push(data);
    }

    public close(): void {
      this.closeCallCount += 1;

      this.readyState = MockWebSocket.CLOSED;

      this.emit('close');
    }

    public terminate(): void {
      this.terminateCallCount += 1;
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close');
    }

    public triggerOpen(): void {
      this.readyState = MockWebSocket.OPEN;

      this.emit('open');
    }

    public triggerClose(): void {
      this.readyState = MockWebSocket.CLOSED;

      this.emit('close');
    }

    public triggerMessage(data: string): void {
      this.emit('message', data);
    }

    private emit(event: string, ...args: unknown[]): void {
      const regularListeners = this.listeners.get(event) ?? [];

      for (const listener of regularListeners) {
        listener(...args);
      }

      const oneTimeListeners = this.onceListeners.get(event) ?? [];

      this.onceListeners.delete(event);

      for (const listener of oneTimeListeners) {
        listener(...args);
      }
    }
  }

  const state = {
    sockets: [] as MockWebSocket[],
    MockWebSocket,
  };

  return state;
});

type MockSocket = InstanceType<typeof mockState.MockWebSocket>;

vi.mock('ws', () => ({
  default: mockState.MockWebSocket,
}));

import { OKXWebSocketClient } from '../src/clients/okx/OKXWebSocketClient';
import { PipelineProfiler } from '../src/core/PipelineProfiler';

const WATCHLIST = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT'];

interface SubscribeMessage {
  op: string;

  args: Array<{
    channel: string;
    instId: string;
    instType?: string;
  }>;
}

const getSubscriptions = (socket: MockSocket): SubscribeMessage[] =>
  socket.sentMessages
    .filter((message) => message !== 'ping')
    .map((message) => JSON.parse(message) as SubscribeMessage);

const requireSocket = (index: number): MockSocket => {
  const socket = mockState.sockets[index];

  if (!socket) {
    throw new Error(`Expected mock socket at index ${index}`);
  }

  return socket;
};

describe('OKXWebSocketClient lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    mockState.sockets.length = 0;

    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates one socket and sends all five subscriptions after open', () => {
    const client = new OKXWebSocketClient();

    expect(mockState.sockets).toHaveLength(1);

    const socket = requireSocket(0);

    for (const symbol of WATCHLIST) {
      client.subscribeToOrderBook(symbol, 'SPOT');
    }

    expect(getSubscriptions(socket)).toHaveLength(0);

    socket.triggerOpen();

    const subscriptions = getSubscriptions(socket);

    expect(subscriptions).toHaveLength(5);

    expect(subscriptions.map((message) => message.args[0]?.instId)).toEqual(
      WATCHLIST,
    );

    expect(
      subscriptions.every((message) => message.args[0]?.channel === 'books'),
    ).toBe(true);

    client.close();
  });

  it('creates one reconnect socket after the first backoff delay', () => {
    const client = new OKXWebSocketClient();

    const firstSocket = requireSocket(0);

    firstSocket.triggerOpen();
    firstSocket.triggerClose();

    expect(mockState.sockets).toHaveLength(1);

    vi.advanceTimersByTime(999);

    expect(mockState.sockets).toHaveLength(1);

    vi.advanceTimersByTime(1);

    expect(mockState.sockets).toHaveLength(2);

    client.close();
  });

  it('does not schedule multiple reconnects for repeated close events', () => {
    const client = new OKXWebSocketClient();

    const firstSocket = requireSocket(0);

    firstSocket.triggerOpen();

    firstSocket.triggerClose();
    firstSocket.triggerClose();
    firstSocket.triggerClose();

    vi.advanceTimersByTime(1_000);

    expect(mockState.sockets).toHaveLength(2);

    client.close();
  });

  it('runs reconnect callback and replays subscriptions after reopen', () => {
    const client = new OKXWebSocketClient();

    for (const symbol of WATCHLIST) {
      client.subscribeToOrderBook(symbol, 'SPOT');
    }

    const reconnectCallback = vi.fn();

    client.onReconnect(reconnectCallback);

    const firstSocket = requireSocket(0);

    firstSocket.triggerOpen();

    expect(getSubscriptions(firstSocket)).toHaveLength(5);

    firstSocket.triggerClose();

    vi.advanceTimersByTime(1_000);

    const secondSocket = requireSocket(1);

    expect(reconnectCallback).not.toHaveBeenCalled();

    expect(getSubscriptions(secondSocket)).toHaveLength(0);

    secondSocket.triggerOpen();

    expect(reconnectCallback).toHaveBeenCalledTimes(1);

    expect(getSubscriptions(secondSocket)).toHaveLength(5);

    expect(
      getSubscriptions(secondSocket).map((message) => message.args[0]?.instId),
    ).toEqual(WATCHLIST);

    client.close();
  });

  it('sends heartbeat ping while the socket is open', () => {
    const client = new OKXWebSocketClient();

    const socket = requireSocket(0);

    socket.triggerOpen();

    vi.advanceTimersByTime(20_000);

    expect(socket.sentMessages).toContain('ping');

    client.close();
  });

  it('terminates and reconnects when a heartbeat receives no response', () => {
    const client = new OKXWebSocketClient();
    const socket = requireSocket(0);

    socket.triggerOpen();
    vi.advanceTimersByTime(20_000);
    vi.advanceTimersByTime(20_000);

    expect(socket.terminateCallCount).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(
      'OKX WebSocket heartbeat timed out; reconnecting',
    );

    vi.advanceTimersByTime(1_000);
    expect(mockState.sockets).toHaveLength(2);

    client.close();
  });

  it('accepts a pong as proof that the heartbeat connection is alive', () => {
    const client = new OKXWebSocketClient();
    const socket = requireSocket(0);

    socket.triggerOpen();
    vi.advanceTimersByTime(20_000);
    socket.triggerMessage('pong');
    vi.advanceTimersByTime(20_000);

    expect(socket.terminateCallCount).toBe(0);
    expect(
      socket.sentMessages.filter((message) => message === 'ping'),
    ).toHaveLength(2);

    client.close();
  });

  it('records callback queue delay separately from handler duration', () => {
    const profiler = new PipelineProfiler();
    const client = new OKXWebSocketClient(profiler);
    const callback = vi.fn();

    client.onOrderBook(callback);
    requireSocket(0).triggerMessage(
      JSON.stringify({
        arg: { channel: 'books', instId: 'BTC-USDT' },
        action: 'snapshot',
        data: [
          {
            asks: [['101', '2', '0', '1']],
            bids: [['100', '3', '0', '1']],
            ts: '1000',
            seqId: 1,
            prevSeqId: -1,
          },
        ],
      }),
    );

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]?.[1]).toMatchObject({
      queueDelayMs: expect.any(Number),
      stages: expect.arrayContaining([
        expect.objectContaining({ stage: 'okx.raw.toString' }),
        expect.objectContaining({ stage: 'okx.json.parse' }),
        expect.objectContaining({
          stage: 'okx.orderBook.validationTransform',
        }),
      ]),
    });
    expect(profiler.getRecentStage('okx.orderBook.queueDelay')?.count).toBe(1);
    expect(profiler.getRecentStage('okx.orderBook.handler')?.count).toBe(1);

    client.close();
  });

  it('rejects an order-book message with a fractional exchange timestamp', () => {
    const client = new OKXWebSocketClient();
    const callback = vi.fn();

    client.onOrderBook(callback);
    requireSocket(0).triggerMessage(
      JSON.stringify({
        arg: { channel: 'books', instId: 'BTC-USDT' },
        action: 'snapshot',
        data: [
          {
            asks: [['101', '2', '0', '1']],
            bids: [['100', '3', '0', '1']],
            ts: '1000.5',
            seqId: 1,
            prevSeqId: -1,
          },
        ],
      }),
    );

    expect(callback).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      'Rejected invalid OKX sequence or timestamp',
    );

    client.close();
  });

  it('does not reconnect after intentional close', () => {
    const client = new OKXWebSocketClient();

    const socket = requireSocket(0);

    socket.triggerOpen();

    client.close();

    expect(socket.closeCallCount).toBe(1);

    vi.advanceTimersByTime(60_000);

    expect(mockState.sockets).toHaveLength(1);
  });
});
