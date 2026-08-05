import { describe, expect, it } from 'vitest';

import { OKXInstrumentClient } from '../src/clients/okx/OKXInstrumentClient';
import { OKXMarketDiscoveryClient } from '../src/clients/okx/OKXMarketDiscoveryClient';
import { marketDiscoveryConfig } from '../src/config/marketDiscoveryConfig';
import {
  SYMBOL_PROFILES,
  type SymbolProfile,
} from '../src/config/symbolProfiles';

const derivativeInstrument = (input: {
  instId: string;
  instType: 'SWAP' | 'FUTURES';
  baseCcy: string;
}) => ({
  instId: input.instId,
  instType: input.instType,
  state: 'live',
  baseCcy: input.baseCcy,
  quoteCcy: 'USDT',
  settleCcy: 'USDT',
  ctType: 'linear',
  ctVal: '0.01',
  ctValCcy: input.baseCcy,
  ctMult: '1',
});

describe('derivatives-only market scope', () => {
  it('contains no spot profiles or discovery types', () => {
    expect(
      SYMBOL_PROFILES.every(
        (profile) =>
          profile.instrumentType === 'SWAP' ||
          profile.instrumentType === 'FUTURES',
      ),
    ).toBe(true);
    expect(marketDiscoveryConfig.instrumentTypes).toEqual([
      'SWAP',
      'FUTURES',
    ]);
    expect(
      SYMBOL_PROFILES.every((profile) =>
        profile.instrumentType === 'SWAP'
          ? profile.symbol.endsWith('-SWAP')
          : !profile.symbol.endsWith('-SWAP'),
      ),
    ).toBe(true);
  });

  it('resolves linear USDT perpetual and expiry futures metadata', async () => {
    const profiles: readonly SymbolProfile[] = [
      { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
      { symbol: 'ETH-USDT-260925', instrumentType: 'FUTURES' },
    ];
    const client = new OKXInstrumentClient(async (url) => {
      const instType = new URL(url).searchParams.get('instType');
      const data =
        instType === 'SWAP'
          ? [
              derivativeInstrument({
                instId: 'BTC-USDT-SWAP',
                instType: 'SWAP',
                baseCcy: 'BTC',
              }),
            ]
          : [
              derivativeInstrument({
                instId: 'ETH-USDT-260925',
                instType: 'FUTURES',
                baseCcy: 'ETH',
              }),
            ];

      return { code: '0', msg: '', data };
    });

    const instruments = await client.loadMarketInstruments(profiles);

    expect(instruments.get('BTC-USDT-SWAP')).toMatchObject({
      instType: 'SWAP',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 0.01,
    });
    expect(instruments.get('ETH-USDT-260925')).toMatchObject({
      instType: 'FUTURES',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 0.01,
    });
  });

  it('queries only futures and swap ticker endpoints', async () => {
    const requestedTypes: string[] = [];
    const client = new OKXMarketDiscoveryClient(async (url) => {
      requestedTypes.push(new URL(url).searchParams.get('instType') ?? '');
      return { code: '0', msg: '', data: [] };
    });

    await client.discoverProfiles([], marketDiscoveryConfig);

    expect(requestedTypes).toEqual(['SWAP', 'FUTURES']);
  });
});
