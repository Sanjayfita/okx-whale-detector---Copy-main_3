import { describe, expect, it } from 'vitest';

import { appConfig } from '../src/config/appConfig';
import {
  resolveSymbolConfig,
  SYMBOL_PROFILES,
  type SymbolProfile,
} from '../src/config/symbolProfiles';
import { WATCHLIST } from '../src/config/symbols';

describe('symbol configuration profiles', () => {
  it('derives the watchlist from the configured profiles', () => {
    expect(WATCHLIST).toEqual(SYMBOL_PROFILES.map((profile) => profile.symbol));
  });

  it('declares only perpetual or expiry futures without hard-coded contract values', () => {
    expect(
      SYMBOL_PROFILES.every(
        (profile) =>
          profile.instrumentType === 'SWAP' ||
          profile.instrumentType === 'FUTURES',
      ),
    ).toBe(true);
    expect(
      SYMBOL_PROFILES.find((profile) => profile.symbol === 'BTC-USDT-SWAP')
        ?.instrumentType,
    ).toBe('SWAP');
    expect(
      SYMBOL_PROFILES.find((profile) => profile.symbol === 'XAU-USDT-SWAP')
        ?.instrumentType,
    ).toBe('SWAP');
    expect(
      SYMBOL_PROFILES.every(
        (profile) => !('baseUnitsPerSize' in profile),
      ),
    ).toBe(true);
  });

  it('uses global defaults when a symbol has no override', () => {
    const resolved = resolveSymbolConfig('BTC-USDT-SWAP');

    expect(resolved).toEqual(appConfig);
    expect(resolved).not.toBe(appConfig);
    expect(resolved.tracker).not.toBe(appConfig.tracker);
  });

  it('applies a partial override without duplicating the full config', () => {
    const profiles: readonly SymbolProfile[] = [
      {
        symbol: 'SOL-USDT-SWAP',
        instrumentType: 'SWAP',
        config: {
          tracker: {
            minimumNotionalQuote: 250_000,
          },
          market: {
            neutralBandPercent: 15,
          },
        },
      },
    ];

    const resolved = resolveSymbolConfig('SOL-USDT-SWAP', profiles);

    expect(resolved.tracker.minimumNotionalQuote).toBe(250_000);
    expect(resolved.market.neutralBandPercent).toBe(15);
    expect(resolved.tracker.strongAfterSeconds).toBe(
      appConfig.tracker.strongAfterSeconds,
    );
    expect(resolved.scoring).toEqual(appConfig.scoring);
  });

  it('does not leak one symbol override into another symbol', () => {
    const profiles: readonly SymbolProfile[] = [
      {
        symbol: 'DOGE-USDT-SWAP',
        instrumentType: 'SWAP',
        config: {
          tracker: {
            minimumNotionalQuote: 100_000,
          },
        },
      },
    ];

    const dogeConfig = resolveSymbolConfig('DOGE-USDT-SWAP', profiles);
    const xrpConfig = resolveSymbolConfig('XRP-USDT-SWAP', profiles);

    expect(dogeConfig.tracker.minimumNotionalQuote).toBe(100_000);
    expect(xrpConfig.tracker.minimumNotionalQuote).toBe(
      appConfig.tracker.minimumNotionalQuote,
    );
  });

  it('lets an unknown derivative symbol inherit the global defaults', () => {
    const resolved = resolveSymbolConfig('NEW-TOKEN-USDT-SWAP');

    expect(resolved).toEqual(appConfig);
  });

  it('rejects an invalid symbol override after merging', () => {
    const profiles: readonly SymbolProfile[] = [
      {
        symbol: 'ETH-USDT-SWAP',
        instrumentType: 'SWAP',
        config: {
          tracker: {
            minimumMovementSizeRatio: 2,
            maximumMovementSizeRatio: 1,
          },
        },
      },
    ];

    expect(() => resolveSymbolConfig('ETH-USDT-SWAP', profiles)).toThrow(
      'tracker.minimumMovementSizeRatio',
    );
  });
});
