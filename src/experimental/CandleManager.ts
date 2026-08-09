import type { Candle, CandleInterval } from '../types/candle';

export class CandleManager {
  private readonly candles = new Map<CandleInterval, Candle[]>();

  private readonly maxCandles = 200;

  constructor() {
    const intervals: CandleInterval[] = [
      '1m',
      '5m',
      '15m',
      '30m',
      '1H',
      '4H',
      '1D',
      '1W',
    ];

    for (const interval of intervals) {
      this.candles.set(interval, []);
    }
  }

  public addCandle(interval: CandleInterval, candle: Candle): void {
    const history = this.candles.get(interval);

    if (!history) {
      return;
    }

    const last = history[history.length - 1];

    /*
     * If the candle has the same timestamp,
     * update the current candle.
     */
    if (last && last.timestamp === candle.timestamp) {
      history[history.length - 1] = candle;
      return;
    }

    history.push(candle);

    /*
     * Keep memory under control.
     */
    if (history.length > this.maxCandles) {
      history.shift();
    }
  }

  public getCandles(interval: CandleInterval): Candle[] {
    return this.candles.get(interval) ?? [];
  }

  public getLatest(interval: CandleInterval): Candle | undefined {
    const history = this.getCandles(interval);

    return history[history.length - 1];
  }

  public getConfirmedCandles(interval: CandleInterval): Candle[] {
    return this.getCandles(interval).filter((candle) => candle.confirmed);
  }
}
