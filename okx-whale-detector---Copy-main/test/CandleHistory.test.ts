import { describe, expect, it } from 'vitest';

import type { OKXCandle } from '../src/clients/okx/OKXCandleWebSocketClient';
import { CandleHistory } from '../src/core/CandleHistory';

const candle = (
  timestamp: number,
  overrides: Partial<OKXCandle> = {},
): OKXCandle => ({
  instId: 'BTC-USDT',
  timestamp,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 10,
  volumeCurrency: 10,
  volumeCurrencyQuote: 1_010,
  confirm: false,
  ...overrides,
});

describe('CandleHistory', () => {
  it('keeps out-of-order candles sorted without changing the latest candle', () => {
    const history = new CandleHistory();

    history.add(candle(120_000));
    expect(history.add(candle(0))).toBe(true);
    history.add(candle(60_000));

    expect(history.getAll().map((item) => item.timestamp)).toEqual([
      0, 60_000, 120_000,
    ]);
    expect(history.getLatest()?.timestamp).toBe(120_000);
  });

  it('allows confirmation but does not downgrade a confirmed candle', () => {
    const history = new CandleHistory();

    expect(history.add(candle(0))).toBe(true);
    expect(history.add(candle(0, { close: 101.5, confirm: true }))).toBe(true);
    expect(history.add(candle(0, { close: 100.5, confirm: false }))).toBe(
      false,
    );

    expect(history.getLatest()).toMatchObject({ close: 101.5, confirm: true });
    expect(history.getSize()).toBe(1);
  });

  it('retains only the newest bounded history after a late insertion', () => {
    const history = new CandleHistory(2);

    history.add(candle(60_000));
    history.add(candle(120_000));
    expect(history.add(candle(0))).toBe(false);

    expect(history.getAll().map((item) => item.timestamp)).toEqual([
      60_000, 120_000,
    ]);
  });

  it('rejects invalid timestamps, prices, and OHLC ranges', () => {
    const history = new CandleHistory();

    expect(history.add(candle(0.5))).toBe(false);
    expect(history.add(candle(0, { close: Number.NaN }))).toBe(false);
    expect(history.add(candle(0, { high: 100.5 }))).toBe(false);
    expect(history.getSize()).toBe(0);
  });
});
