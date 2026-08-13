import type { LiveMarketPriceObserver } from '../market/MarketEngine';
import type { LivePriceSnapshot } from './liveEvidenceCollector';
import { OKXStreamingPriceReader } from './okxStreamingPriceReader';

export interface OKXResilientPriceReaderOptions {
  clock?: () => number;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  streamingReader?: OKXStreamingPriceReader;
  fallbackActivationDelayMs?: number;
  fallbackRequestTimeoutMs?: number;
  fallbackCacheMaximumAgeMs?: number;
  minimumFallbackRequestIntervalMs?: number;
  maximumTickerAgeMs?: number;
}

const STREAMING_AVAILABILITY_ERRORS = new Set([
  'No live order-book price is available for the instrument',
  'Latest live order-book price predates the requested due time',
  'Latest live order-book price is stale',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const positiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const safeTimestamp = (value: unknown): number | undefined => {
  const parsed = positiveNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed)
    ? parsed
    : undefined;
};

const requireNonNegativeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
};

/**
 * Evidence price source with independent transport redundancy.
 *
 * Primary: validated midpoint from the live OKX order-book WebSocket.
 * Fallback: public OKX REST /market/tickers snapshot over HTTPS, activated only
 * after the WebSocket has failed to produce a post-due observation for a short
 * grace period. One batched REST request is shared by all instruments.
 *
 * The fallback does not extend the collector's observation window. The caller
 * still enforces the frozen maximum observation delay and fails closed if both
 * transports are unavailable.
 */
export class OKXResilientPriceReader {
  private readonly streamingReader: OKXStreamingPriceReader;
  private readonly clock: () => number;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly fallbackActivationDelayMs: number;
  private readonly fallbackRequestTimeoutMs: number;
  private readonly fallbackCacheMaximumAgeMs: number;
  private readonly minimumFallbackRequestIntervalMs: number;
  private readonly maximumTickerAgeMs: number;
  private readonly fallbackSnapshots = new Map<string, LivePriceSnapshot>();
  private fallbackRefresh?: Promise<void>;
  private lastFallbackRequestStartedAt = Number.NEGATIVE_INFINITY;

  public constructor(options: OKXResilientPriceReaderOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.fetchFn = options.fetchFn ?? fetch;
    this.baseUrl = (options.baseUrl ?? 'https://openapi.okx.com').replace(
      /\/$/,
      '',
    );
    this.fallbackActivationDelayMs = requireNonNegativeInteger(
      options.fallbackActivationDelayMs ?? 2_000,
      'fallbackActivationDelayMs',
    );
    this.fallbackRequestTimeoutMs = requireNonNegativeInteger(
      options.fallbackRequestTimeoutMs ?? 1_500,
      'fallbackRequestTimeoutMs',
    );
    this.fallbackCacheMaximumAgeMs = requireNonNegativeInteger(
      options.fallbackCacheMaximumAgeMs ?? 1_000,
      'fallbackCacheMaximumAgeMs',
    );
    this.minimumFallbackRequestIntervalMs = requireNonNegativeInteger(
      options.minimumFallbackRequestIntervalMs ?? 750,
      'minimumFallbackRequestIntervalMs',
    );
    this.maximumTickerAgeMs = requireNonNegativeInteger(
      options.maximumTickerAgeMs ?? 10_000,
      'maximumTickerAgeMs',
    );
    this.streamingReader =
      options.streamingReader ?? new OKXStreamingPriceReader({ clock: this.clock });
  }

  public observe: LiveMarketPriceObserver = (observation): void => {
    this.streamingReader.observe(observation);
  };

  public readPrice = async (
    instrumentId: string,
    dueAt: number,
  ): Promise<LivePriceSnapshot> => {
    let streamingError: unknown;
    try {
      return await this.streamingReader.readPrice(instrumentId, dueAt);
    } catch (error: unknown) {
      if (!this.isStreamingAvailabilityError(error)) {
        throw error;
      }
      streamingError = error;
    }

    const now = this.requireClock();
    if (now < dueAt) {
      throw streamingError;
    }
    if (now - dueAt < this.fallbackActivationDelayMs) {
      throw streamingError;
    }

    try {
      return await this.readFallbackPrice(instrumentId, dueAt, now);
    } catch (fallbackError: unknown) {
      throw new AggregateError(
        [streamingError, fallbackError],
        'No fresh OKX price is available from the WebSocket or REST fallback',
      );
    }
  };

  private isStreamingAvailabilityError(error: unknown): boolean {
    return (
      error instanceof Error && STREAMING_AVAILABILITY_ERRORS.has(error.message)
    );
  }

  private async readFallbackPrice(
    instrumentId: string,
    dueAt: number,
    now: number,
  ): Promise<LivePriceSnapshot> {
    const normalizedInstrumentId = instrumentId.trim();
    if (normalizedInstrumentId.length === 0) {
      throw new Error('instrumentId must not be empty');
    }
    requireNonNegativeInteger(dueAt, 'dueAt');

    const cached = this.getUsableFallbackSnapshot(
      normalizedInstrumentId,
      dueAt,
      now,
    );
    if (cached !== undefined) {
      return cached;
    }

    if (this.fallbackRefresh !== undefined) {
      await this.fallbackRefresh;
    } else {
      const elapsedSinceLastRequest = now - this.lastFallbackRequestStartedAt;
      if (elapsedSinceLastRequest < this.minimumFallbackRequestIntervalMs) {
        throw new Error('OKX REST fallback refresh is temporarily rate-limited');
      }

      this.lastFallbackRequestStartedAt = now;
      const refresh = this.refreshFallbackSnapshots();
      this.fallbackRefresh = refresh;
      try {
        await refresh;
      } finally {
        if (this.fallbackRefresh === refresh) {
          this.fallbackRefresh = undefined;
        }
      }
    }

    const refreshedNow = this.requireClock();
    const refreshed = this.getUsableFallbackSnapshot(
      normalizedInstrumentId,
      dueAt,
      refreshedNow,
    );
    if (refreshed === undefined) {
      throw new Error(
        'OKX REST fallback did not contain a fresh post-due ticker snapshot',
      );
    }
    return refreshed;
  }

  private getUsableFallbackSnapshot(
    instrumentId: string,
    dueAt: number,
    now: number,
  ): LivePriceSnapshot | undefined {
    const snapshot = this.fallbackSnapshots.get(instrumentId);
    if (snapshot === undefined) return undefined;
    if (snapshot.observedAt < dueAt) return undefined;
    if ((snapshot.sourceMarketTimestamp ?? -1) < dueAt) return undefined;
    if (now - snapshot.observedAt > this.fallbackCacheMaximumAgeMs) {
      return undefined;
    }
    return snapshot;
  }

  private async refreshFallbackSnapshots(): Promise<void> {
    const url = new URL('/api/v5/market/tickers', this.baseUrl);
    url.searchParams.set('instType', 'SWAP');

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.fallbackRequestTimeoutMs,
    );

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(
        `OKX REST fallback request failed with HTTP ${response.status}`,
      );
    }

    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      payload.code !== '0' ||
      !Array.isArray(payload.data)
    ) {
      throw new Error('OKX REST fallback response is invalid');
    }

    const observedAt = this.requireClock();
    const snapshots = new Map<string, LivePriceSnapshot>();

    for (const value of payload.data) {
      if (!isRecord(value) || typeof value.instId !== 'string') continue;
      const instrumentId = value.instId.trim();
      if (instrumentId.length === 0 || !instrumentId.endsWith('-SWAP')) continue;

      const bid = positiveNumber(value.bidPx);
      const ask = positiveNumber(value.askPx);
      if (bid === undefined || ask === undefined || ask < bid) continue;
      const price = bid + (ask - bid) / 2;
      const sourceMarketTimestamp = safeTimestamp(value.ts);
      if (sourceMarketTimestamp === undefined) continue;
      if (sourceMarketTimestamp > observedAt) continue;

      const sourceMarketAgeMs = observedAt - sourceMarketTimestamp;
      if (sourceMarketAgeMs > this.maximumTickerAgeMs) continue;

      snapshots.set(
        instrumentId,
        Object.freeze({
          instrumentId,
          observedAt,
          sourceMarketTimestamp,
          sourceMarketAgeMs,
          sourceMarketDataSource: 'OKX_REST_TICKER_MIDPOINT',
          price,
        }),
      );
    }

    if (snapshots.size === 0) {
      throw new Error('OKX REST fallback response contained no usable SWAP tickers');
    }

    for (const [instrumentId, snapshot] of snapshots) {
      this.fallbackSnapshots.set(instrumentId, snapshot);
    }
  }

  private requireClock(): number {
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('Local clock must return a non-negative safe integer');
    }
    return now;
  }
}
