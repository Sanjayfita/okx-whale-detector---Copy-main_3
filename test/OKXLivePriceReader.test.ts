import { describe, expect, it, vi } from 'vitest';

import { OKXLivePriceReader } from '../src/research/okxLivePriceReader';

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('OKXLivePriceReader', () => {
  it('reads a public ticker midpoint without trading credentials', async () => {
    const fetchFn = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/v5/market/ticker');
      expect(url.searchParams.get('instId')).toBe('BTC-USDT');
      return response({
        code: '0',
        msg: '',
        data: [
          {
            instId: 'BTC-USDT',
            bidPx: '59999',
            askPx: '60001',
            last: '60002',
            ts: '2000',
          },
        ],
      });
    });
    const reader = new OKXLivePriceReader({
      baseUrl: 'https://example.test/',
      fetchFn: fetchFn as typeof fetch,
      clock: () => 2_001,
    });

    await expect(reader.readPrice('BTC-USDT', 2_000)).resolves.toEqual({
      instrumentId: 'BTC-USDT',
      observedAt: 2_000,
      price: 60_000,
      maximumFavorableExcursionPercent: 0,
      maximumAdverseExcursionPercent: 0,
      excursionMeasurement: 'UNAVAILABLE',
    });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('falls back to the last price when the bid and ask are unavailable', async () => {
    const reader = new OKXLivePriceReader({
      fetchFn: vi.fn(async () =>
        response({
          code: '0',
          data: [
            {
              instId: 'ETH-USDT',
              bidPx: '',
              askPx: '',
              last: '3000.5',
              ts: '5000',
            },
          ],
        }),
      ) as typeof fetch,
      clock: () => 5_001,
    });

    const snapshot = await reader.readPrice('ETH-USDT', 5_000);
    expect(snapshot.price).toBe(3_000.5);
  });

  it('rejects a crossed ticker quote instead of hiding it with the last price', async () => {
    const reader = new OKXLivePriceReader({
      fetchFn: vi.fn(async () =>
        response({
          code: '0',
          data: [
            {
              instId: 'BTC-USDT',
              bidPx: '101',
              askPx: '100',
              last: '100.5',
              ts: '5000',
            },
          ],
        }),
      ) as typeof fetch,
      clock: () => 5_001,
    });

    await expect(reader.readPrice('BTC-USDT', 5_000)).rejects.toThrow(
      'crossed',
    );
  });

  it('rejects HTTP failures, mismatched instruments, and stale snapshots', async () => {
    const httpFailure = new OKXLivePriceReader({
      fetchFn: vi.fn(async () => response({}, 503)) as typeof fetch,
    });
    await expect(httpFailure.readPrice('BTC-USDT', 0)).rejects.toThrow(
      'HTTP 503',
    );

    const mismatch = new OKXLivePriceReader({
      fetchFn: vi.fn(async () =>
        response({
          code: '0',
          data: [{ instId: 'ETH-USDT', last: '1', ts: '1000' }],
        }),
      ) as typeof fetch,
      clock: () => 1_001,
    });
    await expect(mismatch.readPrice('BTC-USDT', 1_000)).rejects.toThrow(
      'does not match',
    );

    const stale = new OKXLivePriceReader({
      fetchFn: vi.fn(async () =>
        response({
          code: '0',
          data: [{ instId: 'BTC-USDT', last: '1', ts: '999' }],
        }),
      ) as typeof fetch,
      clock: () => 999,
    });
    await expect(stale.readPrice('BTC-USDT', 1_000)).rejects.toThrow(
      'before the requested due time',
    );
  });

  it('rejects stale, missing, and implausibly future exchange timestamps', async () => {
    const makeReader = (ts: unknown) =>
      new OKXLivePriceReader({
        fetchFn: vi.fn(async () =>
          response({
            code: '0',
            data: [{ instId: 'BTC-USDT', last: '1', ts }],
          }),
        ) as typeof fetch,
        clock: () => 20_000,
        maximumTickerAgeMs: 5_000,
        maximumFutureSkewMs: 1_000,
      });

    await expect(makeReader('14_999').readPrice('BTC-USDT', 0)).rejects.toThrow(
      'valid exchange timestamp',
    );
    await expect(makeReader('14999').readPrice('BTC-USDT', 0)).rejects.toThrow(
      'stale',
    );
    await expect(
      makeReader(undefined).readPrice('BTC-USDT', 0),
    ).rejects.toThrow('valid exchange timestamp');
    await expect(makeReader('21001').readPrice('BTC-USDT', 0)).rejects.toThrow(
      'future',
    );
  });
});
