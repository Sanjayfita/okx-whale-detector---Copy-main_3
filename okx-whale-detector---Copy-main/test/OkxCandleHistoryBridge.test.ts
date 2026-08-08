import { describe, expect, it } from 'vitest';

import { OKXHistoricalDataClient } from '../src/clients/okx/OKXHistoricalDataClient';
import { OkxCandleHistoryBridge } from '../src/platform/OkxCandleHistoryBridge';
import type { OKXCandle } from '../src/clients/okx/OKXCandleWebSocketClient';

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

  it('rejects an unsafe requested candle count', async () => {
    const bridge = new OkxCandleHistoryBridge({ maximumCandles: 100 });

    await expect(
      bridge.syncInstrument('BTC-USDT-SWAP', { onCandle: () => undefined }, 0),
    ).rejects.toThrow('requestedCandles must be a positive safe integer');
  });
});
