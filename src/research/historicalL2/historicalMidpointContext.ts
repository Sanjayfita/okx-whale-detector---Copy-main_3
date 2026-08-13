import { appendFile } from 'node:fs/promises';

import type { LiveMarketPriceObservation } from '../../market/MarketEngine';

interface MinuteBar {
  startAt: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HistoricalDerivedContextRecord {
  readonly schemaVersion: 1;
  readonly alertId: string;
  readonly instrumentId: string;
  readonly detectedAt: number;
  readonly source: 'DERIVED_FROM_HISTORICAL_L2_MIDPOINT';
  readonly completedMinuteBars: number;
  readonly ema20: number | null;
  readonly ema50: number | null;
  readonly ema200: number | null;
  readonly realizedVolatility20Percent: number | null;
  readonly marketStructure: 'UPTREND' | 'DOWNTREND' | 'RANGE' | 'UNAVAILABLE';
  readonly volumeAvailable: false;
  readonly fundingAvailable: false;
}

const ema = (values: readonly number[], period: number): number | null => {
  if (values.length < period) return null;
  const alpha = 2 / (period + 1);
  let result = values[values.length - period]!;
  for (const value of values.slice(values.length - period + 1)) {
    result = alpha * value + (1 - alpha) * result;
  }
  return result;
};

const realizedVolatility = (values: readonly number[], period: number): number | null => {
  if (values.length < period + 1) return null;
  const sample = values.slice(-(period + 1));
  const returns = sample.slice(1).map((value, index) => Math.log(value / sample[index]!));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(period) * 100;
};

class InstrumentTracker {
  private current?: MinuteBar;
  private readonly completed: MinuteBar[] = [];

  public observe(timestamp: number, price: number): void {
    const startAt = Math.floor(timestamp / 60_000) * 60_000;
    if (this.current === undefined || this.current.startAt !== startAt) {
      if (this.current !== undefined) {
        this.completed.push(this.current);
        if (this.completed.length > 2_000) this.completed.shift();
      }
      this.current = { startAt, open: price, high: price, low: price, close: price };
      return;
    }
    this.current.high = Math.max(this.current.high, price);
    this.current.low = Math.min(this.current.low, price);
    this.current.close = price;
  }

  public snapshot(alertId: string, instrumentId: string, detectedAt: number): HistoricalDerivedContextRecord {
    const bars = this.completed.filter((bar) => bar.startAt + 60_000 <= detectedAt);
    const closes = bars.map((bar) => bar.close);
    let marketStructure: HistoricalDerivedContextRecord['marketStructure'] = 'UNAVAILABLE';
    if (bars.length >= 4) {
      const recent = bars.slice(-4);
      const risingHighs = recent.every((bar, index) => index === 0 || bar.high >= recent[index - 1]!.high);
      const risingLows = recent.every((bar, index) => index === 0 || bar.low >= recent[index - 1]!.low);
      const fallingHighs = recent.every((bar, index) => index === 0 || bar.high <= recent[index - 1]!.high);
      const fallingLows = recent.every((bar, index) => index === 0 || bar.low <= recent[index - 1]!.low);
      marketStructure = risingHighs && risingLows ? 'UPTREND' : fallingHighs && fallingLows ? 'DOWNTREND' : 'RANGE';
    }
    return Object.freeze({
      schemaVersion: 1,
      alertId,
      instrumentId,
      detectedAt,
      source: 'DERIVED_FROM_HISTORICAL_L2_MIDPOINT',
      completedMinuteBars: bars.length,
      ema20: ema(closes, 20),
      ema50: ema(closes, 50),
      ema200: ema(closes, 200),
      realizedVolatility20Percent: realizedVolatility(closes, 20),
      marketStructure,
      volumeAvailable: false,
      fundingAvailable: false,
    });
  }
}

export class HistoricalMidpointContextTracker {
  private readonly byInstrument = new Map<string, InstrumentTracker>();
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(private readonly outputPath: string) {}

  public observe = (observation: LiveMarketPriceObservation): void => {
    let tracker = this.byInstrument.get(observation.instrumentId);
    if (tracker === undefined) {
      tracker = new InstrumentTracker();
      this.byInstrument.set(observation.instrumentId, tracker);
    }
    tracker.observe(observation.observedAt, observation.price);
  };

  public recordAlert(alertId: string, instrumentId: string, detectedAt: number): void {
    const record = this.byInstrument.get(instrumentId)?.snapshot(alertId, instrumentId, detectedAt) ?? Object.freeze({
      schemaVersion: 1 as const,
      alertId,
      instrumentId,
      detectedAt,
      source: 'DERIVED_FROM_HISTORICAL_L2_MIDPOINT' as const,
      completedMinuteBars: 0,
      ema20: null,
      ema50: null,
      ema200: null,
      realizedVolatility20Percent: null,
      marketStructure: 'UNAVAILABLE' as const,
      volumeAvailable: false as const,
      fundingAvailable: false as const,
    });
    const operation = () => appendFile(this.outputPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
    const next = this.writeChain.then(operation, operation);
    this.writeChain = next.catch(() => undefined);
  }

  public async flush(): Promise<void> { await this.writeChain; }
}
