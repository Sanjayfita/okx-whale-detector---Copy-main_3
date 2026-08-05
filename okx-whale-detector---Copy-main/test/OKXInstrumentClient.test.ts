import { describe, expect, it, vi } from 'vitest';

import {
  OKXInstrumentClient,
  type JsonLoader,
} from '../src/clients/okx/OKXInstrumentClient';
import type { SymbolProfile } from '../src/config/symbolProfiles';

const spotInstrument = {
  instId: 'BTC-USDT',
  instType: 'SPOT',
  state: 'live',
  baseCcy: 'BTC',
  quoteCcy: 'USDT',
  settleCcy: '',
  ctType: '',
  ctVal: '',
  ctValCcy: '',
  ctMult: '',
};

const swapInstrument = {
  instId: 'XAU-USDT-SWAP',
  instType: 'SWAP',
  state: 'live',
  baseCcy: '',
  quoteCcy: '',
  settleCcy: 'USDT',
  ctType: 'linear',
  ctVal: '0.001',
  ctValCcy: 'XAU',
  ctMult: '1',
};

const response = (data: unknown[]) => ({
  code: '0',
  msg: '',
  data,
});

const profiles: readonly SymbolProfile[] = [
  { symbol: 'BTC-USDT', instrumentType: 'SPOT' },
  { symbol: 'XAU-USDT-SWAP', instrumentType: 'SWAP' },
];

const createLoader = (): JsonLoader =>
  vi.fn(async (url: string) => {
    const instType = new URL(url).searchParams.get('instType');

    return response(instType === 'SPOT' ? [spotInstrument] : [swapInstrument]);
  });

describe('OKXInstrumentClient', () => {
  it('fetches once per configured instrument type', async () => {
    const loader = createLoader();
    const client = new OKXInstrumentClient(loader);

    await client.loadMarketInstruments(profiles);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenCalledWith(
      expect.stringContaining('instType=SPOT'),
    );
    expect(loader).toHaveBeenCalledWith(
      expect.stringContaining('instType=SWAP'),
    );
  });

  it('resolves spot order-book size as base-asset units', async () => {
    const client = new OKXInstrumentClient(createLoader());
    const instruments = await client.loadMarketInstruments(profiles);

    expect(instruments.get('BTC-USDT')).toEqual({
      instId: 'BTC-USDT',
      instType: 'SPOT',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 1,
    });
  });

  it('derives linear swap base units from ctVal and ctMult', async () => {
    const loader: JsonLoader = async (url) => {
      const instType = new URL(url).searchParams.get('instType');

      return response(
        instType === 'SPOT'
          ? [spotInstrument]
          : [{ ...swapInstrument, ctVal: '0.001', ctMult: '10' }],
      );
    };
    const client = new OKXInstrumentClient(loader);
    const instruments = await client.loadMarketInstruments(profiles);

    expect(instruments.get('XAU-USDT-SWAP')).toEqual({
      instId: 'XAU-USDT-SWAP',
      instType: 'SWAP',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 0.01,
    });
  });

  it.each(['', '0', '-1', 'not-a-number'])(
    'rejects an invalid swap contract multiplier %j',
    async (ctMult) => {
      const client = new OKXInstrumentClient(async () =>
        response([{ ...swapInstrument, ctMult }]),
      );

      await expect(
        client.loadMarketInstruments([
          { symbol: 'XAU-USDT-SWAP', instrumentType: 'SWAP' },
        ]),
      ).rejects.toThrow('Invalid contract value metadata');
    },
  );

  it('rejects duplicate configured symbols before requesting metadata', async () => {
    const loader = createLoader();
    const client = new OKXInstrumentClient(loader);
    const duplicates: readonly SymbolProfile[] = [
      { symbol: 'BTC-USDT', instrumentType: 'SPOT' },
      { symbol: 'BTC-USDT', instrumentType: 'SPOT' },
    ];

    await expect(client.loadMarketInstruments(duplicates)).rejects.toThrow(
      'Duplicate symbol profile: BTC-USDT',
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it('rejects a configured symbol missing from OKX metadata', async () => {
    const client = new OKXInstrumentClient(async () => response([]));

    await expect(
      client.loadMarketInstruments([
        { symbol: 'MISSING-USDT', instrumentType: 'SPOT' },
      ]),
    ).rejects.toThrow('OKX did not return configured instrument MISSING-USDT');
  });

  it('rejects an instrument that is not live', async () => {
    const client = new OKXInstrumentClient(async () =>
      response([{ ...spotInstrument, state: 'suspend' }]),
    );

    await expect(
      client.loadMarketInstruments([
        { symbol: 'BTC-USDT', instrumentType: 'SPOT' },
      ]),
    ).rejects.toThrow('BTC-USDT is not live');
  });

  it('rejects a profile and exchange instrument type mismatch', async () => {
    const client = new OKXInstrumentClient(async () =>
      response([{ ...spotInstrument, instType: 'SWAP' }]),
    );

    await expect(
      client.loadMarketInstruments([
        { symbol: 'BTC-USDT', instrumentType: 'SPOT' },
      ]),
    ).rejects.toThrow('Instrument type mismatch for BTC-USDT');
  });

  it('rejects inverse swaps because their notional formula differs', async () => {
    const client = new OKXInstrumentClient(async () =>
      response([{ ...swapInstrument, ctType: 'inverse' }]),
    );

    await expect(
      client.loadMarketInstruments([
        { symbol: 'XAU-USDT-SWAP', instrumentType: 'SWAP' },
      ]),
    ).rejects.toThrow('Unsupported contract type');
  });

  it('rejects swap contract values denominated outside the base asset', async () => {
    const client = new OKXInstrumentClient(async () =>
      response([{ ...swapInstrument, ctValCcy: 'USDT' }]),
    );

    await expect(
      client.loadMarketInstruments([
        { symbol: 'XAU-USDT-SWAP', instrumentType: 'SWAP' },
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
        { symbol: 'BTC-USDT', instrumentType: 'SPOT' },
      ]),
    ).rejects.toThrow('Rate limit reached');
  });
});
