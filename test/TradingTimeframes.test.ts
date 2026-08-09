import { describe, expect, it } from 'vitest';
import {
  TRADING_TIMEFRAMES,
  isTradingTimeframe,
  tradingTimeframeFromWebSocketChannel,
  tradingTimeframeSpec,
} from '../src/config/tradingTimeframes';

describe('trading timeframe mapping', () => {
  it('keeps 1m as the backward-compatible default option', () => {
    expect(TRADING_TIMEFRAMES[0]).toBe('1m');
    expect(isTradingTimeframe('1m')).toBe(true);
    expect(isTradingTimeframe('1h')).toBe(false);
  });

  it('maps every dashboard timeframe to the native OKX REST and WebSocket value', () => {
    expect(
      Object.fromEntries(
        TRADING_TIMEFRAMES.map((timeframe) => {
          const spec = tradingTimeframeSpec(timeframe);
          return [timeframe, [spec.okxBar, spec.websocketChannel, spec.intervalMs]];
        }),
      ),
    ).toEqual({
      '1m': ['1m', 'candle1m', 60_000],
      '3m': ['3m', 'candle3m', 180_000],
      '5m': ['5m', 'candle5m', 300_000],
      '15m': ['15m', 'candle15m', 900_000],
      '30m': ['30m', 'candle30m', 1_800_000],
      '1H': ['1H', 'candle1H', 3_600_000],
      '2H': ['2H', 'candle2H', 7_200_000],
      '4H': ['4H', 'candle4H', 14_400_000],
    });
  });

  it('round trips supported WebSocket channels only', () => {
    for (const timeframe of TRADING_TIMEFRAMES) {
      expect(
        tradingTimeframeFromWebSocketChannel(
          tradingTimeframeSpec(timeframe).websocketChannel,
        ),
      ).toBe(timeframe);
    }
    expect(tradingTimeframeFromWebSocketChannel('candle6H')).toBeNull();
  });
});
