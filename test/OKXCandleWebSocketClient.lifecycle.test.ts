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

import { OKXCandleWebSocketClient } from '../src/clients/okx/OKXCandleWebSocketClient';

const WATCHLIST = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'XRP-USDT', 'DOGE-USDT'];

interface SubscribeMessage {
  op: string;

  args: Array<{
    channel: string;
    instId: string;
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

describe('OKXCandleWebSocketClient lifecycle', () => {
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
    const client = new OKXCandleWebSocketClient();

    expect(mockState.sockets).toHaveLength(1);

    const socket = requireSocket(0);

    for (const symbol of WATCHLIST) {
      client.subscribeToCandle(symbol);
    }

    /*
     * Subscriptions are remembered
     * but are not sent until open.
     */
    expect(getSubscriptions(socket)).toHaveLength(0);

    socket.triggerOpen();

    const subscriptions = getSubscriptions(socket);

    expect(subscriptions).toHaveLength(5);

    expect(subscriptions.map((message) => message.args[0]?.instId)).toEqual(
      WATCHLIST,
    );

    expect(
      subscriptions.every((message) => message.args[0]?.channel === 'candle1m'),
    ).toBe(true);

    client.close();
  });

  it('creates one reconnect socket after the first backoff delay', () => {
    const client = new OKXCandleWebSocketClient();

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
    const client = new OKXCandleWebSocketClient();

    const firstSocket = requireSocket(0);

    firstSocket.triggerOpen();

    firstSocket.triggerClose();
    firstSocket.triggerClose();
    firstSocket.triggerClose();

    vi.advanceTimersByTime(1_000);

    expect(mockState.sockets).toHaveLength(2);

    client.close();
  });

  it('replays all candle subscriptions when the new socket opens', () => {
    const client = new OKXCandleWebSocketClient();

    for (const symbol of WATCHLIST) {
      client.subscribeToCandle(symbol);
    }

    const firstSocket = requireSocket(0);

    firstSocket.triggerOpen();

    expect(getSubscriptions(firstSocket)).toHaveLength(5);

    firstSocket.triggerClose();

    vi.advanceTimersByTime(1_000);

    const secondSocket = requireSocket(1);

    /*
     * Replay should wait until the
     * reconnect socket is open.
     */
    expect(getSubscriptions(secondSocket)).toHaveLength(0);

    secondSocket.triggerOpen();

    const replayedSubscriptions = getSubscriptions(secondSocket);

    expect(replayedSubscriptions).toHaveLength(5);

    expect(
      replayedSubscriptions.map((message) => message.args[0]?.instId),
    ).toEqual(WATCHLIST);

    client.close();
  });

  it('sends heartbeat ping while the socket is open', () => {
    const client = new OKXCandleWebSocketClient();

    const socket = requireSocket(0);

    socket.triggerOpen();

    vi.advanceTimersByTime(20_000);

    expect(socket.sentMessages).toContain('ping');

    client.close();
  });

  it('terminates and reconnects when a heartbeat receives no response', () => {
    const client = new OKXCandleWebSocketClient();
    const socket = requireSocket(0);

    socket.triggerOpen();
    vi.advanceTimersByTime(20_000);
    vi.advanceTimersByTime(20_000);

    expect(socket.terminateCallCount).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(
      'OKX Candle WebSocket heartbeat timed out; reconnecting',
    );

    vi.advanceTimersByTime(1_000);
    expect(mockState.sockets).toHaveLength(2);

    client.close();
  });

  it('accepts a pong as proof that the heartbeat connection is alive', () => {
    const client = new OKXCandleWebSocketClient();
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

  it('does not send heartbeat while the socket is closed', () => {
    const client = new OKXCandleWebSocketClient();

    const socket = requireSocket(0);

    /*
     * Never trigger open.
     */
    vi.advanceTimersByTime(20_000);

    expect(socket.sentMessages).not.toContain('ping');

    client.close();
  });

  it('rejects a candle whose high and low do not contain its open and close', () => {
    const client = new OKXCandleWebSocketClient();
    const callback = vi.fn();

    client.onCandle(callback);
    requireSocket(0).triggerMessage(
      JSON.stringify({
        arg: { channel: 'candle1m', instId: 'BTC-USDT' },
        data: [['1000', '100', '99', '98', '101', '10', '10', '1000', '1']],
      }),
    );

    expect(callback).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      'Rejected invalid OKX candle values',
    );

    client.close();
  });

  it('does not reconnect after intentional close', () => {
    const client = new OKXCandleWebSocketClient();

    const socket = requireSocket(0);

    socket.triggerOpen();

    client.close();

    expect(socket.closeCallCount).toBe(1);

    vi.advanceTimersByTime(60_000);

    expect(mockState.sockets).toHaveLength(1);
  });
});
