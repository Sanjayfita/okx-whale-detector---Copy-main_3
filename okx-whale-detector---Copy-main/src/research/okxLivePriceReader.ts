import type { LivePriceSnapshot } from './liveEvidenceCollector';

export interface OKXLivePriceReaderOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  clock?: () => number;
  maximumTickerAgeMs?: number;
  maximumFutureSkewMs?: number;
}

const positiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const timestamp = (value: unknown): number | undefined => {
  const parsed = positiveNumber(value);
  return parsed !== undefined && Number.isSafeInteger(parsed)
    ? parsed
    : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class OKXLivePriceReader {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly clock: () => number;
  private readonly maximumTickerAgeMs: number;
  private readonly maximumFutureSkewMs: number;

  public constructor(options: OKXLivePriceReaderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://www.okx.com').replace(
      /\/$/,
      '',
    );
    this.fetchFn = options.fetchFn ?? fetch;
    this.clock = options.clock ?? Date.now;
    this.maximumTickerAgeMs = options.maximumTickerAgeMs ?? 10_000;
    this.maximumFutureSkewMs = options.maximumFutureSkewMs ?? 5_000;

    if (
      !Number.isSafeInteger(this.maximumTickerAgeMs) ||
      this.maximumTickerAgeMs < 0 ||
      !Number.isSafeInteger(this.maximumFutureSkewMs) ||
      this.maximumFutureSkewMs < 0
    ) {
      throw new Error(
        'Ticker timestamp tolerances must be non-negative safe integers',
      );
    }
  }

  public readPrice = async (
    instrumentId: string,
    dueAt: number,
  ): Promise<LivePriceSnapshot> => {
    const normalizedInstrumentId = instrumentId.trim();
    if (normalizedInstrumentId.length === 0) {
      throw new Error('instrumentId must not be empty');
    }
    if (!Number.isSafeInteger(dueAt) || dueAt < 0) {
      throw new Error('dueAt must be a non-negative safe integer');
    }

    const url = new URL('/api/v5/market/ticker', this.baseUrl);
    url.searchParams.set('instId', normalizedInstrumentId);
    const response = await this.fetchFn(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`OKX ticker request failed with HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      throw new Error('OKX ticker response is invalid');
    }
    if (
      payload.code !== '0' ||
      !Array.isArray(payload.data) ||
      payload.data.length !== 1
    ) {
      throw new Error(
        `OKX ticker response is invalid: ${String(payload.msg ?? payload.code)}`,
      );
    }

    const row = payload.data[0];
    if (!isRecord(row)) {
      throw new Error('OKX ticker response row is invalid');
    }
    if (row.instId !== normalizedInstrumentId) {
      throw new Error('OKX ticker instrument does not match the request');
    }

    const bid = positiveNumber(row.bidPx);
    const ask = positiveNumber(row.askPx);
    const last = positiveNumber(row.last);
    if (bid !== undefined && ask !== undefined && ask < bid) {
      throw new Error('OKX ticker contains a crossed bid/ask quote');
    }
    const price =
      bid !== undefined && ask !== undefined ? bid + (ask - bid) / 2 : last;
    if (price === undefined || !Number.isFinite(price)) {
      throw new Error('OKX ticker does not contain a usable positive price');
    }

    const serverTimestamp = timestamp(row.ts);
    const now = this.clock();
    if (serverTimestamp === undefined) {
      throw new Error('OKX ticker does not contain a valid exchange timestamp');
    }
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('Local clock must return a non-negative safe integer');
    }
    if (now - serverTimestamp > this.maximumTickerAgeMs) {
      throw new Error('OKX ticker snapshot is stale');
    }
    if (serverTimestamp - now > this.maximumFutureSkewMs) {
      throw new Error('OKX ticker timestamp is implausibly far in the future');
    }
    if (serverTimestamp < dueAt) {
      throw new Error(
        'OKX ticker snapshot was captured before the requested due time',
      );
    }

    return Object.freeze({
      instrumentId: normalizedInstrumentId,
      observedAt: serverTimestamp,
      price,
      maximumFavorableExcursionPercent: 0,
      maximumAdverseExcursionPercent: 0,
      excursionMeasurement: 'UNAVAILABLE',
    });
  };
}
