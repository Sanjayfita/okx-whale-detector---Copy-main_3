import type {
  CandleRecord,
  ContractMetadataRecord,
  FundingRateRecord,
  HistoricalTradeRecord,
  MarkIndexRecord,
  OpenInterestRecord,
  OrderBookDepthLevel,
  OrderBookSnapshotRecord,
} from '../../data/ResearchMarketData';
import type { DerivativeInstType } from '../../types/instrument';

export type HistoricalJsonLoader = (url: string) => Promise<unknown>;

interface OkxEnvelope {
  readonly code: string;
  readonly msg: string;
  readonly data: readonly unknown[];
}

export interface HistoricalPage<T> {
  readonly records: readonly T[];
  readonly nextBefore: string | null;
  readonly nextAfter: string | null;
}

export interface OkxHistoricalDataClientOptions {
  readonly baseUrl?: string;
  readonly loader?: HistoricalJsonLoader;
  readonly now?: () => number;
}

export interface HistoricalCoverageCapability {
  readonly dataType:
    | 'TRADES'
    | 'CANDLES'
    | 'ORDER_BOOK'
    | 'OPEN_INTEREST'
    | 'FUNDING'
    | 'LIQUIDATIONS'
    | 'MARK_INDEX'
    | 'CONTRACT_METADATA';
  readonly mode: 'REST_BACKFILL' | 'LIVE_CAPTURE_REQUIRED' | 'REST_SNAPSHOT_ONLY';
  readonly reason: string;
}

export const OKX_HISTORICAL_COVERAGE: readonly HistoricalCoverageCapability[] = [
  {
    dataType: 'TRADES',
    mode: 'REST_BACKFILL',
    reason: 'OKX history-trades supports paginated recent public trades.',
  },
  {
    dataType: 'CANDLES',
    mode: 'REST_BACKFILL',
    reason: 'OKX history-candles supports historical confirmed candles.',
  },
  {
    dataType: 'ORDER_BOOK',
    mode: 'LIVE_CAPTURE_REQUIRED',
    reason:
      'Depth history availability and retention vary; the platform records sequence-aware depth locally for reproducible replay.',
  },
  {
    dataType: 'OPEN_INTEREST',
    mode: 'REST_SNAPSHOT_ONLY',
    reason:
      'The public open-interest endpoint provides current state; event-time history must be captured or imported from a verified archive.',
  },
  {
    dataType: 'FUNDING',
    mode: 'REST_BACKFILL',
    reason: 'OKX exposes public funding-rate history for perpetual futures.',
  },
  {
    dataType: 'LIQUIDATIONS',
    mode: 'LIVE_CAPTURE_REQUIRED',
    reason:
      'Public liquidation events are collected from the WebSocket channel and persisted at event time.',
  },
  {
    dataType: 'MARK_INDEX',
    mode: 'LIVE_CAPTURE_REQUIRED',
    reason:
      'Historical mark/index candles are not tick-equivalent; synchronized point-in-time prices are captured live.',
  },
  {
    dataType: 'CONTRACT_METADATA',
    mode: 'REST_SNAPSHOT_ONLY',
    reason:
      'Instrument metadata is snapshotted and versioned whenever collection starts or metadata changes.',
  },
];

const defaultLoader: HistoricalJsonLoader = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OKX request failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
};

const asObject = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
};

const asArray = (value: unknown, name: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value;
};

const asString = (value: unknown, name: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  return value;
};

const parseNumber = (value: unknown, name: string): number => {
  const parsed = Number(asString(value, name));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be finite`);
  }
  return parsed;
};

const parseOptionalNumber = (value: unknown, name: string): number | null => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  return parseNumber(value, name);
};

const parseTimestamp = (value: unknown, name: string): number => {
  const parsed = parseNumber(value, name);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative millisecond timestamp`);
  }
  return parsed;
};

const parseEnvelope = (value: unknown): OkxEnvelope => {
  const object = asObject(value, 'response');
  const code = asString(object.code, 'response.code');
  const msg = asString(object.msg, 'response.msg');
  const data = asArray(object.data, 'response.data');
  if (code !== '0') {
    throw new Error(`OKX API error ${code}: ${msg}`);
  }
  return { code, msg, data };
};

const buildUrl = (
  baseUrl: string,
  path: string,
  parameters: Readonly<Record<string, string | number | null | undefined>>,
): string => {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

const parseDepthLevels = (
  value: unknown,
  name: string,
): readonly OrderBookDepthLevel[] =>
  asArray(value, name).map((rawLevel, index) => {
    const level = asArray(rawLevel, `${name}[${index}]`);
    return {
      price: parseNumber(level[0], `${name}[${index}].price`),
      contracts: parseNumber(level[1], `${name}[${index}].contracts`),
      orderCount:
        level[3] === undefined
          ? level[2] === undefined
            ? null
            : parseOptionalNumber(level[2], `${name}[${index}].orderCount`)
          : parseOptionalNumber(level[3], `${name}[${index}].orderCount`),
    };
  });

const firstAndLastCursor = (
  values: readonly { readonly observedAt: number }[],
): { readonly nextBefore: string | null; readonly nextAfter: string | null } => ({
  nextBefore:
    values.length === 0 ? null : String(values[0]?.observedAt ?? ''),
  nextAfter:
    values.length === 0
      ? null
      : String(values[values.length - 1]?.observedAt ?? ''),
});

export class OKXHistoricalDataClient {
  private readonly baseUrl: string;
  private readonly loader: HistoricalJsonLoader;
  private readonly now: () => number;

  public constructor(options: OkxHistoricalDataClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://www.okx.com';
    this.loader = options.loader ?? defaultLoader;
    this.now = options.now ?? Date.now;
  }

  public async fetchTradesPage(input: {
    readonly instrumentId: string;
    readonly after?: string;
    readonly before?: string;
    readonly limit?: number;
  }): Promise<HistoricalPage<HistoricalTradeRecord>> {
    const url = buildUrl(this.baseUrl, '/api/v5/market/history-trades', {
      instId: input.instrumentId,
      type: '2',
      after: input.after,
      before: input.before,
      limit: input.limit ?? 100,
    });
    const receivedAt = this.now();
    const envelope = parseEnvelope(await this.loader(url));
    const records = envelope.data.map((raw, index): HistoricalTradeRecord => {
      const object = asObject(raw, `data[${index}]`);
      return {
        kind: 'TRADE',
        instrumentId: asString(object.instId, `data[${index}].instId`),
        tradeId: asString(object.tradeId, `data[${index}].tradeId`),
        side:
          asString(object.side, `data[${index}].side`) === 'buy'
            ? 'BUY'
            : 'SELL',
        price: parseNumber(object.px, `data[${index}].px`),
        contracts: parseNumber(object.sz, `data[${index}].sz`),
        observedAt: parseTimestamp(object.ts, `data[${index}].ts`),
        receivedAt,
        source: 'OKX_REST',
      };
    });
    return { records, ...firstAndLastCursor(records) };
  }

  public async fetchCandlesPage(input: {
    readonly instrumentId: string;
    readonly interval: string;
    readonly intervalMs: number;
    readonly after?: string;
    readonly before?: string;
    readonly limit?: number;
  }): Promise<HistoricalPage<CandleRecord>> {
    const url = buildUrl(this.baseUrl, '/api/v5/market/history-candles', {
      instId: input.instrumentId,
      bar: input.interval,
      after: input.after,
      before: input.before,
      limit: input.limit ?? 100,
    });
    const receivedAt = this.now();
    const envelope = parseEnvelope(await this.loader(url));
    const records = envelope.data.map((raw, index): CandleRecord => {
      const row = asArray(raw, `data[${index}]`);
      return {
        kind: 'CANDLE',
        instrumentId: input.instrumentId,
        observedAt: parseTimestamp(row[0], `data[${index}][0]`),
        receivedAt,
        source: 'OKX_REST',
        intervalMs: input.intervalMs,
        open: parseNumber(row[1], `data[${index}][1]`),
        high: parseNumber(row[2], `data[${index}][2]`),
        low: parseNumber(row[3], `data[${index}][3]`),
        close: parseNumber(row[4], `data[${index}][4]`),
        contractVolume: parseNumber(row[5], `data[${index}][5]`),
        baseVolume: parseOptionalNumber(row[6], `data[${index}][6]`),
        quoteVolume: parseOptionalNumber(row[7], `data[${index}][7]`),
        confirmed: asString(row[8], `data[${index}][8]`) === '1',
      };
    });
    return { records, ...firstAndLastCursor(records) };
  }

  public async fetchFundingHistoryPage(input: {
    readonly instrumentId: string;
    readonly after?: string;
    readonly before?: string;
    readonly limit?: number;
  }): Promise<HistoricalPage<FundingRateRecord>> {
    const url = buildUrl(this.baseUrl, '/api/v5/public/funding-rate-history', {
      instId: input.instrumentId,
      after: input.after,
      before: input.before,
      limit: input.limit ?? 100,
    });
    const receivedAt = this.now();
    const envelope = parseEnvelope(await this.loader(url));
    const records = envelope.data.map((raw, index): FundingRateRecord => {
      const object = asObject(raw, `data[${index}]`);
      const fundingTime = parseTimestamp(
        object.fundingTime,
        `data[${index}].fundingTime`,
      );
      return {
        kind: 'FUNDING',
        instrumentId: asString(object.instId, `data[${index}].instId`),
        observedAt: fundingTime,
        receivedAt,
        source: 'OKX_REST',
        fundingTime,
        fundingRate: parseNumber(
          object.fundingRate,
          `data[${index}].fundingRate`,
        ),
        realizedRate: parseOptionalNumber(
          object.realizedRate,
          `data[${index}].realizedRate`,
        ),
      };
    });
    return { records, ...firstAndLastCursor(records) };
  }

  public async fetchOpenInterestSnapshot(input: {
    readonly instrumentType: DerivativeInstType;
    readonly instrumentId: string;
  }): Promise<readonly OpenInterestRecord[]> {
    const url = buildUrl(this.baseUrl, '/api/v5/public/open-interest', {
      instType: input.instrumentType,
      instId: input.instrumentId,
    });
    const receivedAt = this.now();
    const envelope = parseEnvelope(await this.loader(url));
    return envelope.data.map((raw, index): OpenInterestRecord => {
      const object = asObject(raw, `data[${index}]`);
      return {
        kind: 'OPEN_INTEREST',
        instrumentId: asString(object.instId, `data[${index}].instId`),
        observedAt: parseTimestamp(object.ts, `data[${index}].ts`),
        receivedAt,
        source: 'OKX_REST',
        contracts: parseNumber(object.oi, `data[${index}].oi`),
        baseCurrencyAmount: parseOptionalNumber(
          object.oiCcy,
          `data[${index}].oiCcy`,
        ),
        quoteCurrencyAmount: parseOptionalNumber(
          object.oiUsd,
          `data[${index}].oiUsd`,
        ),
      };
    });
  }

  public async fetchOrderBookSnapshot(input: {
    readonly instrumentId: string;
    readonly depth?: number;
  }): Promise<OrderBookSnapshotRecord> {
    const url = buildUrl(this.baseUrl, '/api/v5/market/books', {
      instId: input.instrumentId,
      sz: input.depth ?? 400,
    });
    const receivedAt = this.now();
    const envelope = parseEnvelope(await this.loader(url));
    const first = envelope.data[0];
    if (first === undefined) {
      throw new Error('OKX order book response contained no data');
    }
    const object = asObject(first, 'data[0]');
    return {
      kind: 'ORDER_BOOK',
      instrumentId: input.instrumentId,
      observedAt: parseTimestamp(object.ts, 'data[0].ts'),
      receivedAt,
      source: 'OKX_REST',
      sequenceId:
        object.seqId === undefined
          ? null
          : Number(asString(String(object.seqId), 'data[0].seqId')),
      bids: parseDepthLevels(object.bids, 'data[0].bids'),
      asks: parseDepthLevels(object.asks, 'data[0].asks'),
    };
  }

  public async fetchMarkPrices(input: {
    readonly instrumentType: DerivativeInstType;
    readonly instrumentId: string;
  }): Promise<readonly MarkIndexRecord[]> {
    const url = buildUrl(this.baseUrl, '/api/v5/public/mark-price', {
      instType: input.instrumentType,
      instId: input.instrumentId,
    });
    const receivedAt = this.now();
    const envelope = parseEnvelope(await this.loader(url));
    return envelope.data.map((raw, index): MarkIndexRecord => {
      const object = asObject(raw, `data[${index}]`);
      const markPrice = parseNumber(object.markPx, `data[${index}].markPx`);
      return {
        kind: 'MARK_INDEX',
        instrumentId: asString(object.instId, `data[${index}].instId`),
        observedAt: parseTimestamp(object.ts, `data[${index}].ts`),
        receivedAt,
        source: 'OKX_REST',
        markPrice,
        indexPrice: markPrice,
      };
    });
  }

  public async fetchContractMetadata(input: {
    readonly instrumentType: DerivativeInstType;
    readonly instrumentId?: string;
  }): Promise<readonly ContractMetadataRecord[]> {
    const url = buildUrl(this.baseUrl, '/api/v5/public/instruments', {
      instType: input.instrumentType,
      instId: input.instrumentId,
    });
    const receivedAt = this.now();
    const envelope = parseEnvelope(await this.loader(url));
    return envelope.data.map((raw, index): ContractMetadataRecord => {
      const object = asObject(raw, `data[${index}]`);
      const instrumentId = asString(object.instId, `data[${index}].instId`);
      const listingTime = parseOptionalNumber(
        object.listTime,
        `data[${index}].listTime`,
      );
      const expiryTime = parseOptionalNumber(
        object.expTime,
        `data[${index}].expTime`,
      );
      return {
        kind: 'CONTRACT_METADATA',
        instrumentId,
        observedAt: receivedAt,
        receivedAt,
        source: 'OKX_REST',
        instrumentType: input.instrumentType,
        baseCurrency: asString(object.ctValCcy, `data[${index}].ctValCcy`),
        quoteCurrency: asString(object.quoteCcy, `data[${index}].quoteCcy`),
        settlementCurrency: asString(
          object.settleCcy,
          `data[${index}].settleCcy`,
        ),
        contractValue: parseNumber(object.ctVal, `data[${index}].ctVal`),
        contractValueCurrency: asString(
          object.ctValCcy,
          `data[${index}].ctValCcy`,
        ),
        tickSize: parseNumber(object.tickSz, `data[${index}].tickSz`),
        lotSize: parseNumber(object.lotSz, `data[${index}].lotSz`),
        minimumContracts: parseNumber(
          object.minSz,
          `data[${index}].minSz`,
        ),
        maximumLeverage: parseOptionalNumber(
          object.lever,
          `data[${index}].lever`,
        ),
        listingTime,
        expiryTime,
      };
    });
  }
}
