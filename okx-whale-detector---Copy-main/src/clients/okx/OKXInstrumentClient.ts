import type { SymbolProfile } from '../../config/symbolProfiles';
import type {
  MarketInstrumentConfig,
  OKXPublicInstrument,
  SupportedInstType,
} from '../../types/instrument';

export type JsonLoader = (url: string) => Promise<unknown>;

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
    throw new Error(
      `OKX instrument request failed with HTTP ${response.status}`,
    );
  }

  return response.json();
};

const parseInstrumentId = (
  instId: string,
  instType: SupportedInstType,
): { baseCurrency: string; quoteCurrency: string } => {
  const parts = instId.split('-');

  if (instType === 'SPOT' && parts.length === 2) {
    return {
      baseCurrency: parts[0] ?? '',
      quoteCurrency: parts[1] ?? '',
    };
  }

  if (instType === 'SWAP' && parts.length >= 3) {
    return {
      baseCurrency: parts[0] ?? '',
      quoteCurrency: parts[parts.length - 2] ?? '',
    };
  }

  throw new Error(`Unsupported OKX instrument ID format: ${instId}`);
};

const parsePublicInstrument = (value: unknown): OKXPublicInstrument => {
  if (!isRecord(value)) {
    throw new Error('OKX returned a malformed instrument record');
  }

  const instType = readString(value, 'instType');

  if (instType !== 'SPOT' && instType !== 'SWAP') {
    throw new Error(
      `Unsupported OKX instrument type: ${instType || 'missing'}`,
    );
  }

  return {
    instId: readString(value, 'instId'),
    instType,
    state: readString(value, 'state'),
    baseCcy: readString(value, 'baseCcy'),
    quoteCcy: readString(value, 'quoteCcy'),
    settleCcy: readString(value, 'settleCcy'),
    ctType: readString(value, 'ctType'),
    ctVal: readString(value, 'ctVal'),
    ctValCcy: readString(value, 'ctValCcy'),
    ctMult: readString(value, 'ctMult'),
  };
};

const parseResponse = (value: unknown): OKXPublicInstrument[] => {
  if (!isRecord(value)) {
    throw new Error('OKX returned a malformed instrument response');
  }

  const code = readString(value, 'code');
  const message = readString(value, 'msg');

  if (code !== '0') {
    throw new Error(
      `OKX instrument request failed: ${message || `code ${code || 'missing'}`}`,
    );
  }

  if (!Array.isArray(value.data)) {
    throw new Error('OKX instrument response is missing its data array');
  }

  return value.data.map(parsePublicInstrument);
};

const resolveBaseUnitsPerSize = (
  instrument: OKXPublicInstrument,
  baseCurrency: string,
): number => {
  if (instrument.instType === 'SPOT') {
    return 1;
  }

  if (instrument.ctType !== 'linear') {
    throw new Error(
      `Unsupported contract type for ${instrument.instId}: ` +
        `${instrument.ctType || 'missing'}; expected linear`,
    );
  }

  if (instrument.ctValCcy !== baseCurrency) {
    throw new Error(
      `Unsupported contract value currency for ${instrument.instId}: ` +
        `${instrument.ctValCcy || 'missing'}; expected ${baseCurrency}`,
    );
  }

  const contractValue = Number(instrument.ctVal);
  const contractMultiplier = Number(instrument.ctMult);

  if (
    !Number.isFinite(contractValue) ||
    contractValue <= 0 ||
    !Number.isFinite(contractMultiplier) ||
    contractMultiplier <= 0
  ) {
    throw new Error(`Invalid contract value metadata for ${instrument.instId}`);
  }

  const baseUnitsPerSize = contractValue * contractMultiplier;

  if (!Number.isFinite(baseUnitsPerSize) || baseUnitsPerSize <= 0) {
    throw new Error(`Invalid contract value metadata for ${instrument.instId}`);
  }

  return baseUnitsPerSize;
};

const toMarketInstrument = (
  instrument: OKXPublicInstrument,
): MarketInstrumentConfig => {
  if (!instrument.instId) {
    throw new Error('OKX returned an instrument without an instId');
  }

  if (instrument.state !== 'live') {
    throw new Error(
      `Instrument ${instrument.instId} is not live (state: ${instrument.state || 'missing'})`,
    );
  }

  const parsedId = parseInstrumentId(instrument.instId, instrument.instType);
  const baseCurrency = instrument.baseCcy || parsedId.baseCurrency;
  const quoteCurrency = instrument.quoteCcy || parsedId.quoteCurrency;

  if (quoteCurrency !== 'USDT') {
    throw new Error(
      `Unsupported quote currency for ${instrument.instId}: ${quoteCurrency}`,
    );
  }

  if (
    instrument.instType === 'SWAP' &&
    instrument.settleCcy &&
    instrument.settleCcy !== 'USDT'
  ) {
    throw new Error(
      `Unsupported settlement currency for ${instrument.instId}: ${instrument.settleCcy}`,
    );
  }

  return {
    instId: instrument.instId,
    instType: instrument.instType,
    quoteCurrency: 'USDT',
    baseUnitsPerSize: resolveBaseUnitsPerSize(instrument, baseCurrency),
  };
};

export class OKXInstrumentClient {
  public constructor(
    private readonly loadJson: JsonLoader = defaultJsonLoader,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  private async fetchByType(
    instType: SupportedInstType,
  ): Promise<OKXPublicInstrument[]> {
    const url = new URL('/api/v5/public/instruments', this.baseUrl);

    url.searchParams.set('instType', instType);

    return parseResponse(await this.loadJson(url.toString()));
  }

  public async loadMarketInstruments(
    profiles: readonly SymbolProfile[],
  ): Promise<Map<string, MarketInstrumentConfig>> {
    const profileSymbols = new Set<string>();

    for (const profile of profiles) {
      if (profileSymbols.has(profile.symbol)) {
        throw new Error(`Duplicate symbol profile: ${profile.symbol}`);
      }

      profileSymbols.add(profile.symbol);
    }

    const requestedTypes = [
      ...new Set(profiles.map((profile) => profile.instrumentType)),
    ];
    const responses = await Promise.all(
      requestedTypes.map((instType) => this.fetchByType(instType)),
    );
    const instrumentsById = new Map<string, OKXPublicInstrument>();

    for (const instruments of responses) {
      for (const instrument of instruments) {
        instrumentsById.set(instrument.instId, instrument);
      }
    }

    const resolved = new Map<string, MarketInstrumentConfig>();

    for (const profile of profiles) {
      const instrument = instrumentsById.get(profile.symbol);

      if (!instrument) {
        throw new Error(
          `OKX did not return configured instrument ${profile.symbol}`,
        );
      }

      if (instrument.instType !== profile.instrumentType) {
        throw new Error(
          `Instrument type mismatch for ${profile.symbol}: ` +
            `configured ${profile.instrumentType}, OKX returned ${instrument.instType}`,
        );
      }

      resolved.set(profile.symbol, toMarketInstrument(instrument));
    }

    return resolved;
  }
}
