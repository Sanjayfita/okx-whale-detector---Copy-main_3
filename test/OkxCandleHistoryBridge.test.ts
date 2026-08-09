import { describe, expect, it } from 'vitest';

import { OKXHistoricalDataClient } from '../src/clients/okx/OKXHistoricalDataClient';
import type { OKXCandle } from '../src/clients/okx/OKXCandleWebSocketClient';
import { OkxCandleHistoryBridge } from '../src/platform/OkxCandleHistoryBridge';

describe('OkxCandleHistoryBridge', () => {
  it('feeds only confirmed OKX candles in chronological order', async () => {
    const client = new OKXHistoricalDataClient({
      now: () => 2_000_000,
      loader: async () => ({
        code: '0',
        msg: '',
        data: [
          ['1800000120000', '102', '104', '101', '103', '12', '6', '1236', '1'],
          ['1800000060000', '101', '103', '100', '102', '11', '5.5', '1122', '0'],
          ['1800000000000', '100', '102', '99', '101', '10', '5', '1010', '1'],
        ],
      }),
    });
    const bridge = new OkxCandleHistoryBridge({ client, maximumCandles: 100 });
    const received: OKXCandle[] = [];

    const result = await bridge.syncInstrument(
      'BTC-USDT-SWAP',
      { onCandle: (candle) => received.push(candle) },
      75,
    );

    expect(received.map((candle) => candle.timestamp)).toEqual([
      1_800_000_000_000,
      1_800_000_120_000,
    ]);
    expect(received.every((candle) => candle.confirm)).toBe(true);
    expect(received.every((candle) => candle.interval === '1m')).toBe(true);
    expect(result).toMatchObject({
      instrumentId: 'BTC-USDT-SWAP',
      timeframe: '1m',
      requestedCandles: 75,
      confirmedCandles: 2,
      firstTimestamp: 1_800_000_000_000,
      lastTimestamp: 1_800_000_120_000,
    });
  });

  it('requests the selected native OKX timeframe instead of relabeling 1m candles', async () => {
    let requestedUrl = '';
    const client = new OKXHistoricalDataClient({
      now: () => 2_000_000,
      loader: async (url) => {
        requestedUrl = url;
        return {
          code: '0',
          msg: '',
          data: [['1800000000000', '100', '102', '99', '101', '10', '5', '1010', '1']],
        };
      },
    });
    const bridge = new OkxCandleHistoryBridge({
      client,
      timeframe: '5m',
      maximumCandles: 100,
    });
    const received: OKXCandle[] = [];

    const result = await bridge.syncInstrument('BTC-USDT-SWAP', {
      onCandle: (candle) => received.push(candle),
    });

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe('/api/v5/market/history-candles');
    expect(url.searchParams.get('bar')).toBe('5m');
    expect(received[0]?.interval).toBe('5m');
    expect(result.timeframe).toBe('5m');
  });

  it('recovers paginated missing history once, confirmed-only and chronological', async () => {
    const base = 1_800_000_000_000;
    const requests: string[] = [];
    const row = (timestamp: number, confirmed: '0' | '1') => [
      String(timestamp),
      '100',
      '102',
      '99',
      '101',
      '10',
      '5',
      '1010',
      confirmed,
    ];
    const client = new OKXHistoricalDataClient({
      now: () => base + 2_000_000,
      loader: async (rawUrl) => {
        requests.push(rawUrl);
        const url = new URL(rawUrl);
        const after = url.searchParams.get('after');
        if (after === null) {
          return {
            code: '0',
            msg: '',
            data: [
              row(base + 900_000, '1'),
              row(base + 600_000, '0'),
              row(base + 300_000, '1'),
            ],
          };
        }
        expect(after).toBe(String(base + 300_000));
        return {
          code: '0',
          msg: '',
          data: [row(base + 300_000, '1'), row(base, '1')],
        };
      },
    });
    const bridge = new OkxCandleHistoryBridge({
      client,
      timeframe: '5m',
      maximumRecoveryPages: 5,
    });
    const received: OKXCandle[] = [];

    const result = await bridge.syncInstrumentFrom({
      instrumentId: 'BTC-USDT-SWAP',
      sink: { onCandle: (candle) => received.push(candle) },
      oldestRequiredTimestamp: base,
      recoveredAfterTimestamp: base + 300_000,
    });

    expect(requests).toHaveLength(2);
    expect(received.map((candle) => candle.timestamp)).toEqual([
      base,
      base + 300_000,
      base + 900_000,
    ]);
    expect(received.every((candle) => candle.confirm && candle.interval === '5m')).toBe(
      true,
    );
    expect(new Set(received.map((candle) => candle.timestamp)).size).toBe(
      received.length,
    );
    expect(result).toMatchObject({
      timeframe: '5m',
      confirmedCandles: 3,
      recoveredCandles: 1,
      pagesFetched: 2,
      firstTimestamp: base,
      lastTimestamp: base + 900_000,
    });
  });

  it('rejects an unsafe requested candle count', async () => {
    const bridge = new OkxCandleHistoryBridge({ maximumCandles: 100 });

    await expect(
      bridge.syncInstrument('BTC-USDT-SWAP', { onCandle: () => undefined }, 0),
    ).rejects.toThrow('requestedCandles must be a positive safe integer');
  });
});
