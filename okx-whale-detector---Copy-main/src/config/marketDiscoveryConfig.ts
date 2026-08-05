import type { DerivativeInstType } from '../types/instrument';

export interface MarketDiscoveryConfig {
  enabled: boolean;
  instrumentTypes: readonly DerivativeInstType[];
  minimum24hQuoteVolume: number;
  maximumSymbols: number;
  excludedSymbols: readonly string[];
}

export const marketDiscoveryConfig: MarketDiscoveryConfig = {
  enabled: true,
  instrumentTypes: ['SWAP', 'FUTURES'],
  minimum24hQuoteVolume: 100_000_000,
  maximumSymbols: 12,
  excludedSymbols: [],
};

export const validateMarketDiscoveryConfig = (
  config: MarketDiscoveryConfig,
): void => {
  const errors: string[] = [];

  if (config.instrumentTypes.length === 0) {
    errors.push('instrumentTypes must contain at least one instrument type');
  }

  if (new Set(config.instrumentTypes).size !== config.instrumentTypes.length) {
    errors.push('instrumentTypes must not contain duplicates');
  }

  if (
    config.instrumentTypes.some(
      (instrumentType) =>
        instrumentType !== 'SWAP' && instrumentType !== 'FUTURES',
    )
  ) {
    errors.push('instrumentTypes may contain only SWAP and FUTURES');
  }

  if (
    !Number.isFinite(config.minimum24hQuoteVolume) ||
    config.minimum24hQuoteVolume < 0
  ) {
    errors.push('minimum24hQuoteVolume must be a finite number at least 0');
  }

  if (
    !Number.isSafeInteger(config.maximumSymbols) ||
    config.maximumSymbols <= 0
  ) {
    errors.push('maximumSymbols must be a positive safe integer');
  }

  if (new Set(config.excludedSymbols).size !== config.excludedSymbols.length) {
    errors.push('excludedSymbols must not contain duplicates');
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid market discovery configuration:\n- ${errors.join('\n- ')}`,
    );
  }
};
