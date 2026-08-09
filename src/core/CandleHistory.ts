import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';

export class CandleHistory {
  private readonly candles: OKXCandle[] = [];

  constructor(private readonly maxSize: number = 100) {
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new Error('maxSize must be a positive integer');
    }
  }

  public add(candle: OKXCandle): boolean {
    if (!this.isValid(candle)) {
      return false;
    }

    const existingIndex = this.findTimestamp(candle.timestamp);
    const stored = Object.freeze({ ...candle });

    if (existingIndex >= 0) {
      const existing = this.candles[existingIndex];

      if (existing?.confirm && !candle.confirm) {
        return false;
      }

      this.candles[existingIndex] = stored;
      return true;
    }

    const insertionIndex = -existingIndex - 1;

    if (this.candles.length >= this.maxSize && insertionIndex === 0) {
      return false;
    }

    this.candles.splice(insertionIndex, 0, stored);

    if (this.candles.length > this.maxSize) {
      this.candles.shift();
    }

    return true;
  }

  public getAll(): OKXCandle[] {
    return [...this.candles];
  }

  public getLatest(): OKXCandle | undefined {
    return this.candles[this.candles.length - 1];
  }

  public getSize(): number {
    return this.candles.length;
  }

  public isReady(minimumCandles: number): boolean {
    if (!Number.isInteger(minimumCandles) || minimumCandles < 0) {
      throw new Error('minimumCandles must be a non-negative integer');
    }

    return this.candles.length >= minimumCandles;
  }

  public clear(): void {
    this.candles.length = 0;
  }

  private findTimestamp(timestamp: number): number {
    let lower = 0;
    let upper = this.candles.length - 1;

    while (lower <= upper) {
      const middle = Math.floor((lower + upper) / 2);
      const candidate = this.candles[middle];

      if (!candidate) {
        break;
      }
      if (candidate.timestamp === timestamp) {
        return middle;
      }
      if (candidate.timestamp < timestamp) {
        lower = middle + 1;
      } else {
        upper = middle - 1;
      }
    }

    return -lower - 1;
  }

  private isValid(candle: OKXCandle): boolean {
    return (
      candle.instId.trim().length > 0 &&
      Number.isSafeInteger(candle.timestamp) &&
      candle.timestamp >= 0 &&
      Number.isFinite(candle.open) &&
      candle.open > 0 &&
      Number.isFinite(candle.high) &&
      candle.high > 0 &&
      Number.isFinite(candle.low) &&
      candle.low > 0 &&
      Number.isFinite(candle.close) &&
      candle.close > 0 &&
      candle.high >= Math.max(candle.open, candle.close) &&
      candle.low <= Math.min(candle.open, candle.close) &&
      Number.isFinite(candle.volume) &&
      candle.volume >= 0 &&
      Number.isFinite(candle.volumeCurrency) &&
      candle.volumeCurrency >= 0 &&
      Number.isFinite(candle.volumeCurrencyQuote) &&
      candle.volumeCurrencyQuote >= 0
    );
  }
}
