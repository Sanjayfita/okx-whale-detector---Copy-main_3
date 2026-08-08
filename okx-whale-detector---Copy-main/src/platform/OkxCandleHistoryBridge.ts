import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import { OKXHistoricalDataClient } from '../clients/okx/OKXHistoricalDataClient';

export interface HistoricalCandleSink {
  onCandle(candle: OKXCandle): void;
}

export interface CandleHistorySyncResult {
  readonly instrumentId: string;
  readonly requestedCandles: number;
  readonly confirmedCandles: number;
  readonly firstTimestamp: number | null;
  readonly lastTimestamp: number | null;
}

export interface OkxCandleHistoryBridgeOptions {
  readonly client?: OKXHistoricalDataClient;
  readonly interval?: string;
  readonly intervalMs?: number;
  readonly maximumCandles?: number;
}

/**
 * Bridges OKX REST candle history into the same candle contract used by the
 * live OKX WebSocket. Keeping both sources on OKX avoids cross-vendor timestamp
 * and price differences (for example, TradingView vs OKX) in strategy inputs.
 *
 * The bridge only transports confirmed historical candles. Whether those
 * candles are allowed to execute trades is controlled by the caller; startup
 * and reconnect reconciliation intentionally run in monitoring-only mode.
 */
export class OkxCandleHistoryBridge {
  private readonly client: OKXHistoricalDataClient;
  private readonly interval: string;
  private readonly intervalMs: number;
  private readonly maximumCandles: number;

  public constructor(options: OkxCandleHistoryBridgeOptions = {}) {
    this.client = options.client ?? new OKXHistoricalDataClient();
    this.interval = options.interval ?? '1m';
    this.intervalMs = options.intervalMs ?? 60_000;
    this.maximumCandles = options.maximumCandles ?? 100;

    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs <= 0) {
      throw new Error('intervalMs must be a positive safe integer');
    }
    if (
      !Number.isSafeInteger(this.maximumCandles) ||
      this.maximumCandles <= 0 ||
      this.maximumCandles > 100
    ) {
      throw new Error('maximumCandles must be an integer in [1, 100]');
    }
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

    const page = await this.client.fetchCandlesPage({
      instrumentId,
      interval: this.interval,
      intervalMs: this.intervalMs,
      limit,
    });
    const records = page.records
      .filter((record) => record.confirmed)
      .slice()
      .sort((left, right) => left.observedAt - right.observedAt);

    for (const record of records) {
      sink.onCandle({
        instId: record.instrumentId,
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

    // Sequential requests deliberately keep startup/reconnect traffic gentle on
    // the public OKX REST API and make log ordering deterministic.
    for (const instrumentId of uniqueIds) {
      results.push(
        await this.syncInstrument(instrumentId, sink, requestedCandles),
      );
    }
    return results;
  }
}
