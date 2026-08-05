import { appConfig, type AppConfig } from './appConfig';
import { validateAppConfig } from './validateAppConfig';
import type { DerivativeInstType } from '../types/instrument';

type SymbolConfigSection = Exclude<
  keyof AppConfig,
  'reporting' | 'correlation' | 'correlatedAlerts' | 'correlatedAlertRecording'
>;

export type AppConfigOverride = {
  [Section in SymbolConfigSection]?: Partial<AppConfig[Section]>;
};

export interface SymbolProfile {
  symbol: string;
  instrumentType: DerivativeInstType;
  config?: AppConfigOverride;
}

/*
 * Required markets are perpetual futures so their identifiers do not expire.
 * Expiry futures are added through market discovery and still pass through the
 * same derivatives-only metadata validation.
 */
export const SYMBOL_PROFILES: readonly SymbolProfile[] = [
  { symbol: 'BTC-USDT-SWAP', instrumentType: 'SWAP' },
  { symbol: 'ETH-USDT-SWAP', instrumentType: 'SWAP' },
  { symbol: 'SOL-USDT-SWAP', instrumentType: 'SWAP' },
  { symbol: 'XRP-USDT-SWAP', instrumentType: 'SWAP' },
  { symbol: 'DOGE-USDT-SWAP', instrumentType: 'SWAP' },
  { symbol: 'XAU-USDT-SWAP', instrumentType: 'SWAP' },
  { symbol: 'XAG-USDT-SWAP', instrumentType: 'SWAP' },
];

const mergeConfig = (
  baseConfig: AppConfig,
  override: AppConfigOverride = {},
): AppConfig => ({
  whale: { ...baseConfig.whale, ...override.whale },
  tracker: { ...baseConfig.tracker, ...override.tracker },
  events: { ...baseConfig.events, ...override.events },
  behavior: { ...baseConfig.behavior, ...override.behavior },
  refill: { ...baseConfig.refill, ...override.refill },
  scoring: { ...baseConfig.scoring, ...override.scoring },
  market: { ...baseConfig.market, ...override.market },
  reporting: { ...baseConfig.reporting },
  correlation: { ...baseConfig.correlation },
  correlatedAlerts: {
    ...baseConfig.correlatedAlerts,
    severityThresholds: {
      ...baseConfig.correlatedAlerts.severityThresholds,
    },
  },
  correlatedAlertRecording: { ...baseConfig.correlatedAlertRecording },
  polymarket: { ...baseConfig.polymarket, ...override.polymarket },
  history: { ...baseConfig.history, ...override.history },
});

export const resolveSymbolConfig = (
  symbol: string,
  profiles: readonly SymbolProfile[] = SYMBOL_PROFILES,
  baseConfig: AppConfig = appConfig,
): AppConfig => {
  const profile = profiles.find((candidate) => candidate.symbol === symbol);
  const resolvedConfig = mergeConfig(baseConfig, profile?.config);

  validateAppConfig(resolvedConfig);

  return resolvedConfig;
};
