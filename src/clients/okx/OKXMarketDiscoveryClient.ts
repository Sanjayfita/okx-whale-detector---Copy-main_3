import type { MarketDiscoveryConfig } from '../../config/marketDiscoveryConfig';
import type { SymbolProfile } from '../../config/symbolProfiles';
import type { DerivativeInstType } from '../../types/instrument';
import type { JsonLoader } from './OKXInstrumentClient';

interface OKXTicker {
  instId: string;
  instType: DerivativeInstType;
  last: number;
  volumeQuote24h: number;
}

const DEFAULT_BASE_URL = 'https://www.okx.com';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];

  return typeof value === 'string' ? value : '';
};

const defaultJsonLoader: JsonLoader = async (url) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OKX ticker request failed with HTTP ${response.status}`);
  }

  return response.json();
};

const parseTicker = (value: unknown): OKXTicker | null => {
  if (!isRecord(value)) {
    throw new Error('OKX returned a malformed ticker record');
  }

  const instType = readString(value, 'instType');

  if (instType !== 'SWAP' && instType !== 'FUTURES') {
    throw new Error(
      `Unsupported OKX ticker instrument type: ${instType || 'missing'}`,
    );
  }

  const instId = readString(value, 'instId');
  const last = Number(readString(value, 'last'));
  const volumeBase24h = Number(readString(value, 'volCcy24h'));

  if (
    !instId ||
    !Number.isFinite(last) ||
    last <= 0 ||
    !Number.isFinite(volumeBase24h) ||
    volumeBase24h < 0
  ) {
    return null;
  }

  return {
    instId,
    instType,
    last,
    volumeQuote24h: volumeBase24h * last,
  };
};

const parseResponse = (value: unknown): OKXTicker[] => {
  if (!isRecord(value)) {
    throw new Error('OKX returned a malformed ticker response');
  }

  const code = readString(value, 'code');
  const message = readString(value, 'msg');

  if (code !== '0') {
    throw new Error(
      `OKX ticker request failed: ${message || `code ${code || 'missing'}`}`,
    );
  }

  if (!Array.isArray(value.data)) {
    throw new Error('OKX ticker response is missing its data array');
  }

  return value.data
    .map(parseTicker)
    .filter((ticker): ticker is OKXTicker => ticker !== null);
};

const isUsdtMarket = (ticker: OKXTicker): boolean => {
  if (ticker.instType === 'SWAP') {
    return ticker.instId.endsWith('-USDT-SWAP');
  }

  const parts = ticker.instId.split('-');
  return (
    parts.length >= 3 &&
    parts[0] !== '' &&
    parts[1] === 'USDT' &&
    parts[parts.length - 1] !== 'SWAP'
  );
};

export class OKXMarketDiscoveryClient {
  public constructor(
    private readonly loadJson: JsonLoader = defaultJsonLoader,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  private async fetchTickers(
    instType: DerivativeInstType,
  ): Promise<OKXTicker[]> {
    const url = new URL('/api/v5/market/tickers', this.baseUrl);

    url.searchParams.set('instType', instType);

    return parseResponse(await this.loadJson(url.toString()));
  }

  public async discoverProfiles(
    requiredProfiles: readonly SymbolProfile[],
    config: MarketDiscoveryConfig,
  ): Promise<readonly SymbolProfile[]> {
    const requiredBySymbol = new Map(
      requiredProfiles.map((profile) => [profile.symbol, profile]),
    );

    if (!config.enabled) {
      return [...requiredBySymbol.values()];
    }

    if (requiredBySymbol.size > config.maximumSymbols) {
      throw new Error(
        `Required symbol count ${requiredBySymbol.size} exceeds discovery maximum ${config.maximumSymbols}`,
      );
    }

    const excluded = new Set(config.excludedSymbols);
    const tickerGroups = await Promise.all(
      config.instrumentTypes.map((instType) => this.fetchTickers(instType)),
    );

    const candidates = tickerGroups
      .flat()
      .filter(isUsdtMarket)
      .filter((ticker) => !requiredBySymbol.has(ticker.instId))
      .filter((ticker) => !excluded.has(ticker.instId))
      .filter((ticker) => ticker.volumeQuote24h >= config.minimum24hQuoteVolume)
      .sort((left, right) => right.volumeQuote24h - left.volumeQuote24h);

    const remainingSlots = config.maximumSymbols - requiredBySymbol.size;

    for (const ticker of candidates.slice(0, remainingSlots)) {
      requiredBySymbol.set(ticker.instId, {
        symbol: ticker.instId,
        instrumentType: ticker.instType,
      });
    }

    return [...requiredBySymbol.values()];
  }
}
