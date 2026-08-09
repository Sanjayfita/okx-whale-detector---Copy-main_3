import { describe, expect, it, vi } from 'vitest';

import { OKXMarketDiscoveryClient } from '../src/clients/okx/OKXMarketDiscoveryClient';
import type { JsonLoader } from '../src/clients/okx/OKXInstrumentClient';
import type { MarketDiscoveryConfig } from '../src/config/marketDiscoveryConfig';
import type { SymbolProfile } from '../src/config/symbolProfiles';

const requiredProfiles: readonly SymbolProfile[] = [
  { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
  { symbol: 'XAU-USDT-SWAP', instrumentType: 'SWAP' },
];

const baseConfig: MarketDiscoveryConfig = {
  enabled: true,
  instrumentTypes: ['SWAP', 'FUTURES'],
  minimum24hQuoteVolume: 100_000_000,
  maximumSymbols: 4,
  excludedSymbols: [],
};

const ticker = (
  instId: string,
  instType: 'SWAP' | 'FUTURES',
  last: string,
  volCcy24h: string,
) => ({
  instId,
  instType,
  last,
  volCcy24h,
});

const response = (data: unknown[]) => ({
  code: '0',
  msg: '',
  data,
});

const createLoader = (): JsonLoader =>
  vi.fn(async (url: string) => {
    const instType = new URL(url).searchParams.get('instType');

    return response(
      instType === 'SWAP'
        ? [
            ticker('BTC-USDT-SWAP', 'SWAP', '65000', '10000'),
            ticker('XAU-USDT-SWAP', 'SWAP', '4000', '250000'),
            ticker('DOGE-USDT-SWAP', 'SWAP', '0.1', '3000000000'),
            ticker('SOL-USDT-SWAP', 'SWAP', '75', '2000000'),
            ticker('LOW-USDT-SWAP', 'SWAP', '1', '1000'),
            ticker('BTC-USDC-SWAP', 'SWAP', '65000', '900000000'),
          ]
        : [
            ticker('ETH-USDT-260925', 'FUTURES', '2000', '400000'),
            ticker('XRP-USDT-260925', 'FUTURES', '1', '120000000'),
            ticker('ETH-USDC-260925', 'FUTURES', '2000', '900000000'),
          ],
    );
  });

describe('OKXMarketDiscoveryClient', () => {
  it('keeps required markets and adds the highest-volume eligible derivatives', async () => {
    const client = new OKXMarketDiscoveryClient(createLoader());
    const profiles = await client.discoverProfiles(
      requiredProfiles,
      baseConfig,
    );

    expect(profiles.map((profile) => profile.symbol)).toEqual([
      'BTC-USDT-SWAP',
      'XAU-USDT-SWAP',
      'ETH-USDT-260925',
      'DOGE-USDT-SWAP',
    ]);
  });

  it('converts contract-market base-currency volume into estimated quote volume', async () => {
    const client = new OKXMarketDiscoveryClient(createLoader());
    const profiles = await client.discoverProfiles(requiredProfiles, {
      ...baseConfig,
      maximumSymbols: 3,
    });

    expect(profiles[2]).toEqual({
      symbol: 'ETH-USDT-260925',
      instrumentType: 'FUTURES',
    });
  });

  it('filters non-USDT and low-volume derivative markets', async () => {
    const client = new OKXMarketDiscoveryClient(createLoader());
    const profiles = await client.discoverProfiles(requiredProfiles, {
      ...baseConfig,
      maximumSymbols: 10,
    });
    const symbols = profiles.map((profile) => profile.symbol);

    expect(symbols).not.toContain('BTC-USDC-SWAP');
    expect(symbols).not.toContain('ETH-USDC-260925');
    expect(symbols).not.toContain('LOW-USDT-SWAP');
  });

  it('honors excluded symbols', async () => {
    const client = new OKXMarketDiscoveryClient(createLoader());
    const profiles = await client.discoverProfiles(requiredProfiles, {
      ...baseConfig,
      excludedSymbols: ['ETH-USDT-260925'],
    });

    expect(profiles.map((profile) => profile.symbol)).not.toContain(
      'ETH-USDT-260925',
    );
  });

  it('returns only required profiles when discovery is disabled', async () => {
    const loader = createLoader();
    const client = new OKXMarketDiscoveryClient(loader);
    const profiles = await client.discoverProfiles(requiredProfiles, {
      ...baseConfig,
      enabled: false,
    });

    expect(profiles).toEqual(requiredProfiles);
    expect(loader).not.toHaveBeenCalled();
  });

  it('rejects a maximum lower than the required profile count', async () => {
    const client = new OKXMarketDiscoveryClient(createLoader());

    await expect(
      client.discoverProfiles(requiredProfiles, {
        ...baseConfig,
        maximumSymbols: 1,
      }),
    ).rejects.toThrow('Required symbol count 2 exceeds discovery maximum 1');
  });

  it('skips derivative tickers with empty prices or invalid volume', async () => {
    const client = new OKXMarketDiscoveryClient(async () =>
      response([
        ticker('EMPTY-USDT-SWAP', 'SWAP', '', '100000000'),
        ticker('BAD-USDT-SWAP', 'SWAP', '1', 'not-a-number'),
      ]),
    );

    const profiles = await client.discoverProfiles([], {
      ...baseConfig,
      instrumentTypes: ['SWAP'],
    });

    expect(profiles).toEqual([]);
  });

  it('surfaces OKX ticker API errors', async () => {
    const client = new OKXMarketDiscoveryClient(async () => ({
      code: '50011',
      msg: 'Rate limit reached',
      data: [],
    }));

    await expect(
      client.discoverProfiles([], {
        ...baseConfig,
        instrumentTypes: ['FUTURES'],
      }),
    ).rejects.toThrow('Rate limit reached');
  });
});
