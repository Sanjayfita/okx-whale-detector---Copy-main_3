import { describe, expect, it, vi } from 'vitest';

import { OKXResilientPriceReader } from '../src/research/okxResilientPriceReader';

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('OKXResilientPriceReader', () => {
  it('uses the streaming order-book midpoint without touching REST', async () => {
    const fetchFn = vi.fn();
    const reader = new OKXResilientPriceReader({
      clock: () => 10_000,
      fetchFn: fetchFn as typeof fetch,
    });

    reader.observe({
      instrumentId: 'BTC-USDT-SWAP',
      observedAt: 9_900,
      sourceMarketTimestamp: 9_890,
      price: 100.5,
    });

    await expect(reader.readPrice('BTC-USDT-SWAP', 9_500)).resolves.toMatchObject({
      instrumentId: 'BTC-USDT-SWAP',
      observedAt: 9_900,
      sourceMarketDataSource: 'OKX_ORDER_BOOK_WEBSOCKET_MIDPOINT',
      price: 100.5,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('waits for the streaming grace period before activating REST fallback', async () => {
    const fetchFn = vi.fn();
    const reader = new OKXResilientPriceReader({
      clock: () => 11_999,
      fetchFn: fetchFn as typeof fetch,
      fallbackActivationDelayMs: 2_000,
    });

    await expect(reader.readPrice('BTC-USDT-SWAP', 10_000)).rejects.toThrow(
      'No live order-book price is available',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('shares one batched REST refresh across instruments during a WebSocket gap', async () => {
    const fetchFn = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/v5/market/tickers');
      expect(url.searchParams.get('instType')).toBe('SWAP');
      return response({
        code: '0',
        msg: '',
        data: [
          {
            instId: 'BTC-USDT-SWAP',
            bidPx: '99',
            askPx: '101',
            last: '100',
            ts: '11000',
          },
          {
            instId: 'ETH-USDT-SWAP',
            bidPx: '1999',
            askPx: '2001',
            last: '2000',
            ts: '11001',
          },
        ],
      });
    });
    const reader = new OKXResilientPriceReader({
      clock: () => 12_000,
      fetchFn: fetchFn as typeof fetch,
      fallbackActivationDelayMs: 2_000,
    });

    const [btc, eth] = await Promise.all([
      reader.readPrice('BTC-USDT-SWAP', 10_000),
      reader.readPrice('ETH-USDT-SWAP', 10_000),
    ]);

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(btc).toMatchObject({
      instrumentId: 'BTC-USDT-SWAP',
      sourceMarketTimestamp: 11_000,
      sourceMarketDataSource: 'OKX_REST_TICKER_MIDPOINT',
      price: 100,
    });
    expect(eth).toMatchObject({
      instrumentId: 'ETH-USDT-SWAP',
      sourceMarketTimestamp: 11_001,
      sourceMarketDataSource: 'OKX_REST_TICKER_MIDPOINT',
      price: 2_000,
    });
  });

  it('rejects a REST quote generated before the requested horizon', async () => {
    const reader = new OKXResilientPriceReader({
      clock: () => 12_000,
      fallbackActivationDelayMs: 2_000,
      fetchFn: vi.fn(async () =>
        response({
          code: '0',
          data: [
            {
              instId: 'BTC-USDT-SWAP',
              bidPx: '99',
              askPx: '101',
              ts: '9999',
            },
          ],
        }),
      ) as typeof fetch,
    });

    await expect(reader.readPrice('BTC-USDT-SWAP', 10_000)).rejects.toThrow(
      'No fresh OKX price is available from the WebSocket or REST fallback',
    );
  });

  it('aborts a hung REST fallback without consuming the evidence window', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(
        async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          }),
      );
      const reader = new OKXResilientPriceReader({
        clock: () => 12_000,
        fetchFn: fetchFn as typeof fetch,
        fallbackActivationDelayMs: 2_000,
        fallbackRequestTimeoutMs: 1_500,
      });

      const pending = reader.readPrice('BTC-USDT-SWAP', 10_000);
      await vi.advanceTimersByTimeAsync(1_500);

      await expect(pending).rejects.toThrow(
        'No fresh OKX price is available from the WebSocket or REST fallback',
      );
      expect(fetchFn).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
