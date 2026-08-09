import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import { OKXHistoricalDataClient } from '../clients/okx/OKXHistoricalDataClient';
import {
  tradingTimeframeSpec,
  type TradingTimeframe,
} from '../config/tradingTimeframes';
import type { CandleRecord } from '../data/ResearchMarketData';

export interface HistoricalCandleSink {
  onCandle(candle: OKXCandle): void;
}

export interface CandleHistorySyncResult {
  readonly instrumentId: string;
  readonly timeframe: TradingTimeframe;
  readonly requestedCandles: number;
  readonly confirmedCandles: number;
  readonly recoveredCandles: number;
  readonly pagesFetched: number;
  readonly firstTimestamp: number | null;
  readonly lastTimestamp: number | null;
}

export interface OkxCandleHistoryBridgeOptions {
  readonly client?: OKXHistoricalDataClient;
  readonly timeframe?: TradingTimeframe;
  readonly maximumCandles?: number;
  readonly maximumRecoveryPages?: number;
  readonly maximumRestRetries?: number;
  readonly retryBaseDelayMs?: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

const defaultSleep = async (delayMs: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));

/**
 * Bridges native OKX REST candles into the exact candle contract used by the
 * live OKX WebSocket. One bridge instance represents one timeframe, preventing
 * accidental cross-timeframe mixing during strategy initialization/rebuilds.
 */
export class OkxCandleHistoryBridge {
  private readonly client: OKXHistoricalDataClient;
  private readonly timeframe: TradingTimeframe;
  private readonly maximumCandles: number;
  private readonly maximumRecoveryPages: number;
  private readonly maximumRestRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;

  public constructor(options: OkxCandleHistoryBridgeOptions = {}) {
    this.client = options.client ?? new OKXHistoricalDataClient();
    this.timeframe = options.timeframe ?? '1m';
    this.maximumCandles = options.maximumCandles ?? 100;
    this.maximumRecoveryPages = options.maximumRecoveryPages ?? 250;
    this.maximumRestRetries = options.maximumRestRetries ?? 4;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.sleep = options.sleep ?? defaultSleep;

    if (
      !Number.isSafeInteger(this.maximumCandles) ||
      this.maximumCandles <= 0 ||
      this.maximumCandles > 100
    ) {
      throw new Error('maximumCandles must be an integer in [1, 100]');
    }
    if (
      !Number.isSafeInteger(this.maximumRecoveryPages) ||
      this.maximumRecoveryPages <= 0
    ) {
      throw new Error('maximumRecoveryPages must be a positive safe integer');
    }
    if (
      !Number.isSafeInteger(this.maximumRestRetries) ||
      this.maximumRestRetries < 0
    ) {
      throw new Error('maximumRestRetries must be a non-negative safe integer');
    }
    if (
      !Number.isSafeInteger(this.retryBaseDelayMs) ||
      this.retryBaseDelayMs <= 0
    ) {
      throw new Error('retryBaseDelayMs must be a positive safe integer');
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
    const page = await this.fetchCandlesPageWithRetry({
      instrumentId,
      interval: spec.okxBar,
      intervalMs: spec.intervalMs,
      limit,
    });
    const records = this.confirmedChronological(page.records);
    this.emit(records, sink);
    return this.result({
      instrumentId,
      requestedCandles: limit,
      records,
      recoveredAfterTimestamp: null,
      pagesFetched: 1,
    });
  }

  /**
   * Recovers every available confirmed candle from the latest OKX page backward
   * until the requested oldest timestamp is covered. Pages are deduplicated by
   * exchange timestamp before chronological replay. recoveredAfterTimestamp is
   * used only for reconciliation reporting; it does not affect emitted history.
   */
  public async syncInstrumentFrom(input: {
    readonly instrumentId: string;
    readonly sink: HistoricalCandleSink;
    readonly oldestRequiredTimestamp: number;
    readonly recoveredAfterTimestamp?: number | null;
  }): Promise<CandleHistorySyncResult> {
    if (
      !Number.isSafeInteger(input.oldestRequiredTimestamp) ||
      input.oldestRequiredTimestamp < 0
    ) {
      throw new Error('oldestRequiredTimestamp must be a non-negative safe integer');
    }
    if (
      input.recoveredAfterTimestamp !== undefined &&
      input.recoveredAfterTimestamp !== null &&
      (!Number.isSafeInteger(input.recoveredAfterTimestamp) ||
        input.recoveredAfterTimestamp < 0)
    ) {
      throw new Error('recoveredAfterTimestamp must be a non-negative safe integer');
    }

    const spec = tradingTimeframeSpec(this.timeframe);
    const byTimestamp = new Map<number, CandleRecord>();
    let after: string | undefined;
    let pagesFetched = 0;
    let reachedRequiredBoundary = false;

    while (pagesFetched < this.maximumRecoveryPages) {
      const page = await this.fetchCandlesPageWithRetry({
        instrumentId: input.instrumentId,
        interval: spec.okxBar,
        intervalMs: spec.intervalMs,
        after,
        limit: 100,
      });
      pagesFetched += 1;
      if (page.records.length === 0) {
        reachedRequiredBoundary = true;
        break;
      }

      let oldestTimestamp = Number.POSITIVE_INFINITY;
      for (const record of page.records) {
        oldestTimestamp = Math.min(oldestTimestamp, record.observedAt);
        if (record.confirmed) byTimestamp.set(record.observedAt, record);
      }
      if (oldestTimestamp <= input.oldestRequiredTimestamp) {
        reachedRequiredBoundary = true;
        break;
      }
      if (!Number.isFinite(oldestTimestamp)) {
        reachedRequiredBoundary = true;
        break;
      }
      const nextAfter = String(oldestTimestamp);
      if (after === nextAfter) break;
      after = nextAfter;
    }

    if (!reachedRequiredBoundary && byTimestamp.size > 0) {
      const oldestLoaded = Math.min(...byTimestamp.keys());
      if (oldestLoaded > input.oldestRequiredTimestamp) {
        throw new Error(
          `OKX candle recovery exceeded ${this.maximumRecoveryPages} pages before reaching ${input.oldestRequiredTimestamp}`,
        );
      }
    }

    const records = [...byTimestamp.values()]
      .filter((record) => record.observedAt >= input.oldestRequiredTimestamp)
      .sort((left, right) => left.observedAt - right.observedAt);
    this.emit(records, input.sink);
    return this.result({
      instrumentId: input.instrumentId,
      requestedCandles: records.length,
      records,
      recoveredAfterTimestamp: input.recoveredAfterTimestamp ?? null,
      pagesFetched,
    });
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

  private async fetchCandlesPageWithRetry(
    input: Parameters<OKXHistoricalDataClient['fetchCandlesPage']>[0],
  ): ReturnType<OKXHistoricalDataClient['fetchCandlesPage']> {
    let attempt = 0;
    while (true) {
      try {
        return await this.client.fetchCandlesPage(input);
      } catch (error: unknown) {
        if (attempt >= this.maximumRestRetries) throw error;
        const delayMs = Math.min(10_000, this.retryBaseDelayMs * 2 ** attempt);
        attempt += 1;
        await this.sleep(delayMs);
      }
    }
  }

  private confirmedChronological(
    records: readonly CandleRecord[],
  ): CandleRecord[] {
    const byTimestamp = new Map<number, CandleRecord>();
    for (const record of records) {
      if (record.confirmed) byTimestamp.set(record.observedAt, record);
    }
    return [...byTimestamp.values()].sort(
      (left, right) => left.observedAt - right.observedAt,
    );
  }

  private emit(records: readonly CandleRecord[], sink: HistoricalCandleSink): void {
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
  }

  private result(input: {
    readonly instrumentId: string;
    readonly requestedCandles: number;
    readonly records: readonly CandleRecord[];
    readonly recoveredAfterTimestamp: number | null;
    readonly pagesFetched: number;
  }): CandleHistorySyncResult {
    return {
      instrumentId: input.instrumentId,
      timeframe: this.timeframe,
      requestedCandles: input.requestedCandles,
      confirmedCandles: input.records.length,
      recoveredCandles:
        input.recoveredAfterTimestamp === null
          ? 0
          : input.records.filter(
              (record) => record.observedAt > input.recoveredAfterTimestamp!,
            ).length,
      pagesFetched: input.pagesFetched,
      firstTimestamp: input.records[0]?.observedAt ?? null,
      lastTimestamp: input.records.at(-1)?.observedAt ?? null,
    };
  }
}
