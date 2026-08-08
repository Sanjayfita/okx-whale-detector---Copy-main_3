import { describe, expect, it } from 'vitest';
import { OKXHistoricalDataClient } from '../src/clients/okx/OKXHistoricalDataClient';
import { OkxCandleHistoryBridge } from '../src/platform/OkxCandleHistoryBridge';

describe('OkxCandleHistoryBridge REST recovery', () => {
  it('retries temporary OKX REST failures with bounded exponential backoff', async () => {
    let calls = 0;
    const delays: number[] = [];
    const client = new OKXHistoricalDataClient({
      now: () => 2_000,
      loader: async () => {
        calls += 1;
        if (calls < 3) throw new Error('temporary network failure');
        return {
          code: '0',
          msg: '',
          data: [
            ['1800000000000', '100', '102', '99', '101', '10', '5', '1010', '1'],
          ],
        };
      },
    });
    const bridge = new OkxCandleHistoryBridge({
      client,
      maximumRestRetries: 2,
      retryBaseDelayMs: 100,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    const result = await bridge.syncInstrument('BTC-USDT-SWAP', {
      onCandle: () => undefined,
    });

    expect(calls).toBe(3);
    expect(delays).toEqual([100, 200]);
    expect(result.confirmedCandles).toBe(1);
  });

  it('stops retrying after the configured maximum', async () => {
    let calls = 0;
    const client = new OKXHistoricalDataClient({
      loader: async () => {
        calls += 1;
        throw new Error('REST unavailable');
      },
    });
    const bridge = new OkxCandleHistoryBridge({
      client,
      maximumRestRetries: 2,
      retryBaseDelayMs: 1,
      sleep: async () => undefined,
    });

    await expect(
      bridge.syncInstrument('BTC-USDT-SWAP', { onCandle: () => undefined }),
    ).rejects.toThrow('REST unavailable');
    expect(calls).toBe(3);
  });
});
