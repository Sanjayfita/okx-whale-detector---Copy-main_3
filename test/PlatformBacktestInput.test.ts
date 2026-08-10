import { describe, expect, it } from 'vitest';
import { parsePlatformBacktestInput } from '../src/tools/runPlatformBacktest';

describe('platform backtest input', () => {
  it('parses explicit timestamped funding settlements', () => {
    const parsed = parsePlatformBacktestInput(
      JSON.stringify({
        schemaVersion: 1,
        datasetId: 'btc-test-v1',
        createdAt: 1_000,
        expectedCandleIntervalMs: 60_000,
        instrumentSpecification: {
          instrumentId: 'BTC-USDT-SWAP',
          tickSize: 0.1,
          lotSizeBaseUnits: 0.001,
          minimumOrderBaseUnits: 0.001,
          minimumOrderValue: 1,
          maximumLeverage: 100,
        },
        candles: [
          {
            timestamp: 1,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            confirm: true,
          },
        ],
        fundingEvents: [
          {
            eventId: 'BTC:funding:1',
            timestamp: 1,
            fundingRatePercent: 0.01,
            markPrice: 100,
          },
        ],
      }),
    );

    expect(parsed.candles).toHaveLength(1);
    expect(parsed.datasetId).toBe('btc-test-v1');
    expect(parsed.createdAt).toBe(1_000);
    expect(parsed.expectedCandleIntervalMs).toBe(60_000);
    expect(parsed.instrumentSpecification?.tickSize).toBe(0.1);
    expect(parsed.fundingEvents).toEqual([
      {
        eventId: 'BTC:funding:1',
        timestamp: 1,
        fundingRatePercent: 0.01,
        markPrice: 100,
      },
    ]);
  });

  it('rejects ambiguous candle-level funding rates', () => {
    expect(() =>
      parsePlatformBacktestInput(
        JSON.stringify([
          {
            timestamp: 1,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            fundingRatePercent: 0.01,
          },
        ]),
      ),
    ).toThrow('timestamped fundingEvents');
  });
});
