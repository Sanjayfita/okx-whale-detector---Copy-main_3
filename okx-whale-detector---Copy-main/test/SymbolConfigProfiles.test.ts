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

  it('declares spot and swap instrument types without contract values', () => {
    expect(
      SYMBOL_PROFILES.find((profile) => profile.symbol === 'BTC-USDT')
        ?.instrumentType,
    ).toBe('SPOT');
    expect(
      SYMBOL_PROFILES.find((profile) => profile.symbol === 'XAU-USDT-SWAP')
        ?.instrumentType,
    ).toBe('SWAP');
  });

  it('uses global defaults when a symbol has no override', () => {
    const resolved = resolveSymbolConfig('BTC-USDT');

    expect(resolved).toEqual(appConfig);
    expect(resolved).not.toBe(appConfig);
    expect(resolved.tracker).not.toBe(appConfig.tracker);
  });

  it('applies a partial override without duplicating the full config', () => {
    const profiles: readonly SymbolProfile[] = [
      {
        symbol: 'SOL-USDT',
        instrumentType: 'SPOT',
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

    const resolved = resolveSymbolConfig('SOL-USDT', profiles);

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
        symbol: 'DOGE-USDT',
        instrumentType: 'SPOT',
        config: {
          tracker: {
            minimumNotionalQuote: 100_000,
          },
        },
      },
    ];

    const dogeConfig = resolveSymbolConfig('DOGE-USDT', profiles);
    const xrpConfig = resolveSymbolConfig('XRP-USDT', profiles);

    expect(dogeConfig.tracker.minimumNotionalQuote).toBe(100_000);
    expect(xrpConfig.tracker.minimumNotionalQuote).toBe(
      appConfig.tracker.minimumNotionalQuote,
    );
  });

  it('lets an unknown future symbol inherit the global defaults', () => {
    const resolved = resolveSymbolConfig('NEW-TOKEN-USDT');

    expect(resolved).toEqual(appConfig);
  });

  it('rejects an invalid symbol override after merging', () => {
    const profiles: readonly SymbolProfile[] = [
      {
        symbol: 'ETH-USDT',
        instrumentType: 'SPOT',
        config: {
          tracker: {
            minimumMovementSizeRatio: 2,
            maximumMovementSizeRatio: 1,
          },
        },
      },
    ];

    expect(() => resolveSymbolConfig('ETH-USDT', profiles)).toThrow(
      'tracker.minimumMovementSizeRatio',
    );
  });
});
