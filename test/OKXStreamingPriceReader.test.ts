import { describe, expect, it } from 'vitest';

import { OKXStreamingPriceReader } from '../src/research/okxStreamingPriceReader';

describe('OKXStreamingPriceReader', () => {
  it('returns the latest post-due order-book midpoint without an HTTP request', async () => {
    const now = 10_000;
    const reader = new OKXStreamingPriceReader({ clock: () => now });

    reader.observe({
      instrumentId: 'BTC-USDT-SWAP',
      observedAt: 9_900,
      sourceMarketTimestamp: 9_880,
      price: 100.5,
    });

    await expect(reader.readPrice('BTC-USDT-SWAP', 9_500)).resolves.toEqual({
      instrumentId: 'BTC-USDT-SWAP',
      observedAt: 9_900,
      sourceMarketTimestamp: 9_880,
      sourceMarketAgeMs: 20,
      sourceMarketDataSource: 'OKX_ORDER_BOOK_WEBSOCKET_MIDPOINT',
      price: 100.5,
    });
  });

  it('keeps a job retryable until a market update arrives after its due time', async () => {
    let now = 10_000;
    const reader = new OKXStreamingPriceReader({ clock: () => now });

    reader.observe({
      instrumentId: 'BTC-USDT-SWAP',
      observedAt: 9_900,
      sourceMarketTimestamp: 9_890,
      price: 100,
    });

    await expect(reader.readPrice('BTC-USDT-SWAP', 9_950)).rejects.toThrow(
      'predates the requested due time',
    );

    now = 10_100;
    reader.observe({
      instrumentId: 'BTC-USDT-SWAP',
      observedAt: 10_050,
      sourceMarketTimestamp: 10_040,
      price: 101,
    });

    await expect(
      reader.readPrice('BTC-USDT-SWAP', 9_950),
    ).resolves.toMatchObject({
      observedAt: 10_050,
      price: 101,
    });
  });

  it('rejects a locally stale cached price', async () => {
    const reader = new OKXStreamingPriceReader({
      clock: () => 20_001,
      maximumSnapshotAgeMs: 10_000,
    });

    reader.observe({
      instrumentId: 'BTC-USDT-SWAP',
      observedAt: 10_000,
      sourceMarketTimestamp: 9_990,
      price: 100,
    });

    await expect(reader.readPrice('BTC-USDT-SWAP', 9_500)).rejects.toThrow(
      'Latest live order-book price is stale',
    );
  });

  it('rejects stale or future exchange timestamps before caching', () => {
    const reader = new OKXStreamingPriceReader({
      maximumSourceAgeMs: 10_000,
    });

    expect(() =>
      reader.observe({
        instrumentId: 'BTC-USDT-SWAP',
        observedAt: 20_001,
        sourceMarketTimestamp: 10_000,
        price: 100,
      }),
    ).toThrow('source timestamp is stale');

    expect(() =>
      reader.observe({
        instrumentId: 'BTC-USDT-SWAP',
        observedAt: 10_000,
        sourceMarketTimestamp: 15_001,
        price: 100,
      }),
    ).toThrow('source timestamp is in the future');
  });

  it('does not replace a newer cached observation with an older update', async () => {
    const reader = new OKXStreamingPriceReader({ clock: () => 10_100 });

    reader.observe({
      instrumentId: 'BTC-USDT-SWAP',
      observedAt: 10_050,
      sourceMarketTimestamp: 10_040,
      price: 101,
    });
    reader.observe({
      instrumentId: 'BTC-USDT-SWAP',
      observedAt: 10_000,
      sourceMarketTimestamp: 9_990,
      price: 99,
    });

    await expect(
      reader.readPrice('BTC-USDT-SWAP', 10_000),
    ).resolves.toMatchObject({
      observedAt: 10_050,
      price: 101,
    });
  });
});
