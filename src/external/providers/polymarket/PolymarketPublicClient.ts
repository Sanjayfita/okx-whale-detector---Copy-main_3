export interface PolymarketMarket {
  id: string;
  conditionId: string;
  question: string;
  slug: string;
  liquidity: number;
  volume: number;
  tokenIds?: string[];
  outcomes?: string[];
  endDate?: string;
  category?: string;
}

export interface PolymarketTrade {
  proxyWallet: string;
  side: 'BUY' | 'SELL';
  asset: string;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  eventSlug: string;
  outcome: string;
  outcomeIndex: number;
  transactionHash: string;
}

export interface PolymarketPublicClientConfig {
  gammaBaseUrl: string;
  dataBaseUrl: string;
  requestTimeoutMs: number;
  tradeMarketBatchSize: number;
}

const DEFAULT_CONFIG: PolymarketPublicClientConfig = {
  gammaBaseUrl: 'https://gamma-api.polymarket.com',
  dataBaseUrl: 'https://data-api.polymarket.com',
  requestTimeoutMs: 15_000,
  tradeMarketBatchSize: 25,
};

const toFiniteNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

export class PolymarketPublicClient {
  private readonly config: PolymarketPublicClientConfig;

  public constructor(config: Partial<PolymarketPublicClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (
      !Number.isInteger(this.config.tradeMarketBatchSize) ||
      this.config.tradeMarketBatchSize <= 0
    ) {
      throw new Error('tradeMarketBatchSize must be a positive integer');
    }
  }

  public async getActiveMarkets(limit = 500): Promise<PolymarketMarket[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('Polymarket market limit must be a positive integer');
    }

    const markets: PolymarketMarket[] = [];
    const pageSize = 100;

    for (let offset = 0; markets.length < limit; offset += pageSize) {
      const requestedPageSize = Math.min(pageSize, limit - markets.length);
      const url = new URL('/markets', this.config.gammaBaseUrl);
      url.searchParams.set('active', 'true');
      url.searchParams.set('closed', 'false');
      url.searchParams.set('limit', String(requestedPageSize));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('order', 'liquidity');
      url.searchParams.set('ascending', 'false');

      const payload = await this.fetchJson<unknown[]>(url);
      markets.push(...this.parseMarkets(payload));

      if (payload.length < requestedPageSize) {
        break;
      }
    }

    return markets.slice(0, limit);
  }

  public async getRecentTrades(
    minimumCashAmount: number,
    limit = 1_000,
  ): Promise<PolymarketTrade[]> {
    return this.getTradesPage(minimumCashAmount, limit);
  }

  public async getRecentTradesForMarkets(
    minimumCashAmount: number,
    conditionIds: readonly string[],
    limit = 1_000,
  ): Promise<PolymarketTrade[]> {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 10_000) {
      throw new Error(
        'Polymarket trade limit must be an integer from 1 to 10000',
      );
    }

    const uniqueConditionIds = [...new Set(conditionIds.filter(Boolean))];
    if (uniqueConditionIds.length === 0) {
      return [];
    }

    const trades: PolymarketTrade[] = [];

    for (
      let index = 0;
      index < uniqueConditionIds.length;
      index += this.config.tradeMarketBatchSize
    ) {
      const batch = uniqueConditionIds.slice(
        index,
        index + this.config.tradeMarketBatchSize,
      );
      const batchTrades = await this.getTradesPage(
        minimumCashAmount,
        limit,
        batch,
      );
      trades.push(...batchTrades);
    }

    return trades
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);
  }

  private async getTradesPage(
    minimumCashAmount: number,
    limit: number,
    conditionIds: readonly string[] = [],
  ): Promise<PolymarketTrade[]> {
    const url = new URL('/trades', this.config.dataBaseUrl);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', '0');
    url.searchParams.set('takerOnly', 'true');
    url.searchParams.set('filterType', 'CASH');
    url.searchParams.set('filterAmount', String(minimumCashAmount));

    if (conditionIds.length > 0) {
      url.searchParams.set('market', conditionIds.join(','));
    }

    const payload = await this.fetchJson<unknown[]>(url);
    return this.parseTrades(payload);
  }

  private parseMarkets(payload: unknown[]): PolymarketMarket[] {
    return payload.flatMap((market) => {
      if (!market || typeof market !== 'object') {
        return [];
      }

      const value = market as Record<string, unknown>;
      const conditionId = String(value.conditionId ?? '');
      const question = String(value.question ?? '');

      if (!conditionId || !question) {
        return [];
      }

      return [
        {
          id: String(value.id ?? conditionId),
          conditionId,
          question,
          slug: String(value.slug ?? ''),
          liquidity: toFiniteNumber(value.liquidityNum ?? value.liquidity),
          volume: toFiniteNumber(value.volumeNum ?? value.volume),
          tokenIds: toStringArray(value.clobTokenIds),
          outcomes: toStringArray(value.outcomes),
          endDate:
            typeof value.endDate === 'string' ? value.endDate : undefined,
          category:
            typeof value.category === 'string' ? value.category : undefined,
        },
      ];
    });
  }

  private parseTrades(payload: unknown[]): PolymarketTrade[] {
    return payload.flatMap((trade) => {
      if (!trade || typeof trade !== 'object') {
        return [];
      }

      const value = trade as Record<string, unknown>;
      const conditionId = String(value.conditionId ?? '');
      const transactionHash = String(value.transactionHash ?? '');
      const side = value.side;

      if (
        !conditionId ||
        !transactionHash ||
        (side !== 'BUY' && side !== 'SELL')
      ) {
        return [];
      }

      return [
        {
          proxyWallet: String(value.proxyWallet ?? ''),
          side,
          asset: String(value.asset ?? ''),
          conditionId,
          size: toFiniteNumber(value.size),
          price: toFiniteNumber(value.price),
          timestamp: toFiniteNumber(value.timestamp),
          title: String(value.title ?? ''),
          slug: String(value.slug ?? ''),
          eventSlug: String(value.eventSlug ?? ''),
          outcome: String(value.outcome ?? ''),
          outcomeIndex: toFiniteNumber(value.outcomeIndex),
          transactionHash,
        },
      ];
    });
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs,
    );

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseBody = await response.text();
        const details = responseBody.trim()
          ? ` | ${responseBody.trim().slice(0, 500)}`
          : '';

        throw new Error(
          `Polymarket request failed: ${response.status} ${response.statusText} | ${url.toString()}${details}`,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
