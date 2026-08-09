import { describe, expect, it } from 'vitest';

import {
  marketDiscoveryConfig,
  validateMarketDiscoveryConfig,
} from '../src/config/marketDiscoveryConfig';

describe('market discovery configuration', () => {
  it('accepts the default discovery configuration', () => {
    expect(() =>
      validateMarketDiscoveryConfig(marketDiscoveryConfig),
    ).not.toThrow();
  });

  it('rejects an empty instrument type list', () => {
    expect(() =>
      validateMarketDiscoveryConfig({
        ...marketDiscoveryConfig,
        instrumentTypes: [],
      }),
    ).toThrow('instrumentTypes must contain at least one instrument type');
  });

  it('rejects a negative volume threshold', () => {
    expect(() =>
      validateMarketDiscoveryConfig({
        ...marketDiscoveryConfig,
        minimum24hQuoteVolume: -1,
      }),
    ).toThrow('minimum24hQuoteVolume');
  });

  it('rejects duplicate exclusions and an invalid maximum together', () => {
    expect(() =>
      validateMarketDiscoveryConfig({
        ...marketDiscoveryConfig,
        maximumSymbols: 0,
        excludedSymbols: ['BAD-USDT', 'BAD-USDT'],
      }),
    ).toThrow(/maximumSymbols[\s\S]*excludedSymbols/);
  });
});
