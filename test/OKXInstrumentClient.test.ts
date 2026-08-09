import { describe, expect, it, vi } from 'vitest';

import {
  OKXInstrumentClient,
  type JsonLoader,
} from '../src/clients/okx/OKXInstrumentClient';
import type { SymbolProfile } from '../src/config/symbolProfiles';

const swapInstrument = {
  instId: 'BTC-USDT-SWAP',
  instType: 'SWAP',
  state: 'live',
  baseCcy: 'BTC',
  quoteCcy: 'USDT',
  settleCcy: 'USDT',
  ctType: 'linear',
  ctVal: '0.01',
  ctValCcy: 'BTC',
  ctMult: '1',
};

const futuresInstrument = {
  instId: 'ETH-USDT-260925',
  instType: 'FUTURES',
  state: 'live',
  baseCcy: 'ETH',
  quoteCcy: 'USDT',
  settleCcy: 'USDT',
  ctType: 'linear',
  ctVal: '0.1',
  ctValCcy: 'ETH',
  ctMult: '1',
};

const response = (data: unknown[]) => ({
  code: '0',
  msg: '',
  data,
});

const profiles: readonly SymbolProfile[] = [
  { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
  { symbol: 'ETH-USDT-260925', instrumentType: 'FUTURES' },
];

const createLoader = (): JsonLoader =>
  vi.fn(async (url: string) => {
    const instType = new URL(url).searchParams.get('instType');

    return response(
      instType === 'SWAP' ? [swapInstrument] : [futuresInstrument],
    );
  });

describe('OKXInstrumentClient', () => {
  it('fetches once per configured derivative instrument type', async () => {
    const loader = createLoader();
    const client = new OKXInstrumentClient(loader);

    await client.loadMarketInstruments(profiles);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenCalledWith(
      expect.stringContaining('instType=SWAP'),
    );
    expect(loader).toHaveBeenCalledWith(
      expect.stringContaining('instType=FUTURES'),
    );
  });

  it('derives linear perpetual base units from ctVal and ctMult', async () => {
    const client = new OKXInstrumentClient(createLoader());
    const instruments = await client.loadMarketInstruments(profiles);

    expect(instruments.get('BTC-USDT-SWAP')).toEqual({
      instId: 'BTC-USDT-SWAP',
      instType: 'SWAP',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 0.01,
    });
  });

  it('derives linear expiry-futures base units from ctVal and ctMult', async () => {
    const loader: JsonLoader = async (url) => {
      const instType = new URL(url).searchParams.get('instType');

      return response(
        instType === 'SWAP'
          ? [swapInstrument]
          : [{ ...futuresInstrument, ctVal: '0.1', ctMult: '10' }],
      );
    };
    const client = new OKXInstrumentClient(loader);
    const instruments = await client.loadMarketInstruments(profiles);

    expect(instruments.get('ETH-USDT-260925')).toEqual({
      instId: 'ETH-USDT-260925',
      instType: 'FUTURES',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 1,
    });
  });

  it.each(['', '0', '-1', 'not-a-number'])(
    'rejects an invalid contract multiplier %j',
    async (ctMult) => {
      const client = new OKXInstrumentClient(async () =>
        response([{ ...swapInstrument, ctMult }]),
      );

      await expect(
        client.loadMarketInstruments([
          { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
        ]),
      ).rejects.toThrow('Invalid contract value metadata');
    },
  );

  it('rejects duplicate configured symbols before requesting metadata', async () => {
    const loader = createLoader();
    const client = new OKXInstrumentClient(loader);
    const duplicates: readonly SymbolProfile[] = [
      { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
      { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
    ];

    await expect(client.loadMarketInstruments(duplicates)).rejects.toThrow(
      'Duplicate symbol profile: BTC-USDT-SWAP',
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it('rejects a configured symbol missing from OKX metadata', async () => {
    const client = new OKXInstrumentClient(async () => response([]));

    await expect(
      client.loadMarketInstruments([
        { symbol: 'MISSING-USDT-SWAP', instrumentType: 'SWAP' },
      ]),
    ).rejects.toThrow(
      'OKX did not return configured instrument MISSING-USDT-SWAP',
    );
  });

  it('rejects an instrument that is not live', async () => {
    const client = new OKXInstrumentClient(async () =>
      response([{ ...swapInstrument, state: 'suspend' }]),
    );

    await expect(
      client.loadMarketInstruments([
        { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
      ]),
    ).rejects.toThrow('BTC-USDT-SWAP is not live');
  });

  it('rejects a profile and exchange instrument type mismatch', async () => {
    const client = new OKXInstrumentClient(async () =>
      response([{ ...futuresInstrument, instType: 'SWAP' }]),
    );

    await expect(
      client.loadMarketInstruments([
        { symbol: 'ETH-USDT-260925', instrumentType: 'FUTURES' },
      ]),
    ).rejects.toThrow('Instrument type mismatch for ETH-USDT-260925');
  });

  it('rejects inverse contracts because their notional formula differs', async () => {
    const client = new OKXInstrumentClient(async () =>
      response([{ ...swapInstrument, ctType: 'inverse' }]),
    );

    await expect(
      client.loadMarketInstruments([
        { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
      ]),
    ).rejects.toThrow('Unsupported contract type');
  });

  it('rejects contract values denominated outside the base asset', async () => {
    const client = new OKXInstrumentClient(async () =>
      response([{ ...swapInstrument, ctValCcy: 'USDT' }]),
    );

    await expect(
      client.loadMarketInstruments([
        { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
      ]),
    ).rejects.toThrow('Unsupported contract value currency');
  });

  it('surfaces an OKX API error response', async () => {
    const client = new OKXInstrumentClient(async () => ({
      code: '50011',
      msg: 'Rate limit reached',
      data: [],
    }));

    await expect(
      client.loadMarketInstruments([
        { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
      ]),
    ).rejects.toThrow('Rate limit reached');
  });
});
