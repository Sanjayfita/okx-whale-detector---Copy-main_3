import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import { OKXHistoricalDataClient } from '../clients/okx/OKXHistoricalDataClient';
import {
  tradingTimeframeSpec,
  type TradingTimeframe,
} from '../config/tradingTimeframes';

export interface HistoricalCandleSink {
  onCandle(candle: OKXCandle): void;
}

export interface CandleHistorySyncResult {
  readonly instrumentId: string;
  readonly timeframe: TradingTimeframe;
  readonly requestedCandles: number;
  readonly confirmedCandles: number;
  readonly firstTimestamp: number | null;
  readonly lastTimestamp: number | null;
}

export interface OkxCandleHistoryBridgeOptions {
  readonly client?: OKXHistoricalDataClient;
  readonly timeframe?: TradingTimeframe;
  readonly maximumCandles?: number;
}

/**
 * Bridges native OKX REST candles into the exact candle contract used by the
 * live OKX WebSocket. One bridge instance represents one timeframe, preventing
 * accidental cross-timeframe mixing during strategy initialization/rebuilds.
 */
export class OkxCandleHistoryBridge {
  private readonly client: OKXHistoricalDataClient;
  private readonly timeframe: TradingTimeframe;
  private readonly maximumCandles: number;

  public constructor(options: OkxCandleHistoryBridgeOptions = {}) {
    this.client = options.client ?? new OKXHistoricalDataClient();
    this.timeframe = options.timeframe ?? '1m';
    this.maximumCandles = options.maximumCandles ?? 100;

    if (
      !Number.isSafeInteger(this.maximumCandles) ||
      this.maximumCandles <= 0 ||
      this.maximumCandles > 100
    ) {
      throw new Error('maximumCandles must be an integer in [1, 100]');
    }
  }

  public getTimeframe(): TradingTimeframe {
    return this.timeframe;
  }

  public async syncInstrument(
    instrumentId: string,
    sink: HistoricalCandleSink,
    requestedCandles = this.maximumCandles,
  ): Promise<CandleHistorySyncResult> {
    const limit = Math.min(this.maximumCandles, requestedCandles);
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('requestedCandles must be a positive safe integer');
    }

    const spec = tradingTimeframeSpec(this.timeframe);
    const page = await this.client.fetchCandlesPage({
      instrumentId,
      interval: spec.okxBar,
      intervalMs: spec.intervalMs,
      limit,
    });
    const records = page.records
      .filter((record) => record.confirmed)
      .slice()
      .sort((left, right) => left.observedAt - right.observedAt);

    for (const record of records) {
      sink.onCandle({
        instId: record.instrumentId,
        interval: this.timeframe,
        timestamp: record.observedAt,
        open: record.open,
        high: record.high,
        low: record.low,
        close: record.close,
        volume: record.contractVolume,
        volumeCurrency: record.baseVolume ?? 0,
        volumeCurrencyQuote: record.quoteVolume ?? 0,
        confirm: true,
      });
    }

    return {
      instrumentId,
      timeframe: this.timeframe,
      requestedCandles: limit,
      confirmedCandles: records.length,
      firstTimestamp: records[0]?.observedAt ?? null,
      lastTimestamp: records.at(-1)?.observedAt ?? null,
    };
  }

  public async syncSymbols(
    instrumentIds: readonly string[],
    sink: HistoricalCandleSink,
    requestedCandles = this.maximumCandles,
  ): Promise<readonly CandleHistorySyncResult[]> {
    const uniqueIds = [...new Set(instrumentIds)];
    const results: CandleHistorySyncResult[] = [];

    for (const instrumentId of uniqueIds) {
      results.push(
        await this.syncInstrument(instrumentId, sink, requestedCandles),
      );
    }
    return results;
  }
}
