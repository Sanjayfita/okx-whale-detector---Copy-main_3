import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  class MockWebSocket {
    public static readonly CONNECTING = 0;
    public static readonly OPEN = 1;
    public static readonly CLOSED = 3;
    public readyState = MockWebSocket.CONNECTING;
    public readonly sentMessages: string[] = [];
    private readonly listeners = new Map<string, Listener[]>();

    public constructor() {
      state.sockets.push(this);
    }

    public on(event: string, listener: Listener): this {
      const values = this.listeners.get(event) ?? [];
      values.push(listener);
      this.listeners.set(event, values);
      return this;
    }

    public send(data: string): void {
      this.sentMessages.push(data);
    }

    public close(): void {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close');
    }

    public terminate(): void {
      this.close();
    }

    public triggerOpen(): void {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open');
    }

    public triggerMessage(data: string): void {
      this.emit('message', data);
    }

    private emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }

  const state = { sockets: [] as MockWebSocket[], MockWebSocket };
  return state;
});

vi.mock('ws', () => ({ default: mockState.MockWebSocket }));

import { OKXCandleWebSocketClient } from '../src/clients/okx/OKXCandleWebSocketClient';

const candleMessage = (channel: string): string =>
  JSON.stringify({
    arg: { channel, instId: 'BTC-USDT-SWAP' },
    data: [['1800000000000', '100', '102', '99', '101', '10', '5', '1010', '1']],
  });

const subscriptionMessages = (socket: InstanceType<typeof mockState.MockWebSocket>) =>
  socket.sentMessages
    .filter((message) => message !== 'ping')
    .map((message) => JSON.parse(message) as {
      op: string;
      args: Array<{ channel: string; instId: string }>;
    });

describe('OKXCandleWebSocketClient timeframe switching', () => {
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

  it('unsubscribes 1m, subscribes 15m, and ignores a late 1m candle', () => {
    const client = new OKXCandleWebSocketClient();
    const received: Array<{ interval?: string }> = [];
    client.onCandle((candle) => received.push(candle));
    client.subscribeToCandle('BTC-USDT-SWAP');

    const socket = mockState.sockets[0];
    if (!socket) throw new Error('Expected mock socket');
    socket.triggerOpen();
    client.setCandleInterval('BTC-USDT-SWAP', '15m');

    expect(
      subscriptionMessages(socket).map((message) => [
        message.op,
        message.args[0]?.channel,
      ]),
    ).toEqual([
      ['subscribe', 'candle1m'],
      ['unsubscribe', 'candle1m'],
      ['subscribe', 'candle15m'],
    ]);

    socket.triggerMessage(candleMessage('candle1m'));
    expect(received).toHaveLength(0);

    socket.triggerMessage(candleMessage('candle15m'));
    expect(received).toHaveLength(1);
    expect(received[0]?.interval).toBe('15m');
    client.close();
  });

  it('reconnects directly to the selected 15m channel without falling back to 1m', () => {
    const client = new OKXCandleWebSocketClient();
    const reconnect = vi.fn();
    client.onReconnect(reconnect);
    client.subscribeToCandle('BTC-USDT-SWAP', '1m');

    const first = mockState.sockets[0];
    if (!first) throw new Error('Expected first mock socket');
    first.triggerOpen();
    client.setCandleInterval('BTC-USDT-SWAP', '15m');
    first.close();

    vi.advanceTimersByTime(1_000);
    const second = mockState.sockets[1];
    if (!second) throw new Error('Expected reconnect mock socket');
    expect(subscriptionMessages(second)).toHaveLength(0);
    second.triggerOpen();

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(
      subscriptionMessages(second).map((message) => [
        message.op,
        message.args[0]?.channel,
      ]),
    ).toEqual([['subscribe', 'candle15m']]);
    expect(
      subscriptionMessages(second).some(
        (message) => message.args[0]?.channel === 'candle1m',
      ),
    ).toBe(false);

    client.close();
  });
});
