import { describe, expect, it } from 'vitest';

import { OKXHistoricalDataClient } from '../src/clients/okx/OKXHistoricalDataClient';

const now = 1_700_000_001_000;

const envelope = (data: readonly unknown[]) => ({ code: '0', msg: '', data });

describe('OKXHistoricalDataClient', () => {
  it('normalizes paginated public trades with millisecond timestamps', async () => {
    const requested: string[] = [];
    const client = new OKXHistoricalDataClient({
      baseUrl: 'https://example.test',
      now: () => now,
      loader: async (url) => {
        requested.push(url);
        return envelope([
          {
            instId: 'BTC-USDT-SWAP',
            tradeId: '42',
            side: 'buy',
            px: '100.5',
            sz: '3',
            ts: '1700000000000',
          },
        ]);
      },
    });

    const page = await client.fetchTradesPage({
      instrumentId: 'BTC-USDT-SWAP',
      after: '1700000001000',
      limit: 50,
    });

    expect(requested[0]).toContain('/api/v5/market/history-trades');
    expect(requested[0]).toContain('instId=BTC-USDT-SWAP');
    expect(requested[0]).toContain('type=2');
    expect(page.records[0]).toEqual({
      kind: 'TRADE',
      instrumentId: 'BTC-USDT-SWAP',
      tradeId: '42',
      side: 'BUY',
      price: 100.5,
      contracts: 3,
      observedAt: 1_700_000_000_000,
      receivedAt: now,
      source: 'OKX_REST',
    });
  });

  it('normalizes confirmed candles and funding history', async () => {
    const client = new OKXHistoricalDataClient({
      baseUrl: 'https://example.test',
      now: () => now,
      loader: async (url) =>
        url.includes('funding-rate-history')
          ? envelope([
              {
                instId: 'BTC-USDT-SWAP',
                fundingRate: '0.0001',
                realizedRate: '0.00009',
                fundingTime: '1700000000000',
              },
            ])
          : envelope([
              [
                '1700000000000',
                '100',
                '102',
                '99',
                '101',
                '10',
                '0.1',
                '1000',
                '1',
              ],
            ]),
    });

    const candles = await client.fetchCandlesPage({
      instrumentId: 'BTC-USDT-SWAP',
      interval: '1m',
      intervalMs: 60_000,
    });
    const funding = await client.fetchFundingHistoryPage({
      instrumentId: 'BTC-USDT-SWAP',
    });

    expect(candles.records[0]?.confirmed).toBe(true);
    expect(candles.records[0]?.quoteVolume).toBe(1_000);
    expect(funding.records[0]?.fundingRate).toBe(0.0001);
    expect(funding.records[0]?.realizedRate).toBe(0.00009);
  });

  it('normalizes current open interest and a sequence-aware book snapshot', async () => {
    const client = new OKXHistoricalDataClient({
      baseUrl: 'https://example.test',
      now: () => now,
      loader: async (url) =>
        url.includes('open-interest')
          ? envelope([
              {
                instId: 'BTC-USDT-SWAP',
                oi: '1000',
                oiCcy: '10',
                oiUsd: '1000000',
                ts: '1700000000000',
              },
            ])
          : envelope([
              {
                bids: [['99.9', '10', '0', '2']],
                asks: [['100.1', '11', '0', '3']],
                ts: '1700000000000',
                seqId: 99,
              },
            ]),
    });

    const openInterest = await client.fetchOpenInterestSnapshot({
      instrumentType: 'SWAP',
      instrumentId: 'BTC-USDT-SWAP',
    });
    const book = await client.fetchOrderBookSnapshot({
      instrumentId: 'BTC-USDT-SWAP',
    });

    expect(openInterest[0]?.contracts).toBe(1_000);
    expect(book.sequenceId).toBe(99);
    expect(book.bids[0]).toEqual({
      price: 99.9,
      contracts: 10,
      orderCount: 2,
    });
  });

  it('rejects non-zero OKX response codes', async () => {
    const client = new OKXHistoricalDataClient({
      loader: async () => ({ code: '50011', msg: 'rate limit', data: [] }),
    });

    await expect(
      client.fetchTradesPage({ instrumentId: 'BTC-USDT-SWAP' }),
    ).rejects.toThrow('OKX API error 50011: rate limit');
  });
});
