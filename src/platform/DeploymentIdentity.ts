import { createHash } from 'node:crypto';
import type { TradingStrategyConfig } from '../config/tradingStrategyConfig';

export interface DeploymentIdentity {
  readonly gitCommit: string;
  readonly imageVersion: string;
  readonly configurationVersion: string;
}

const clean = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? fallback : normalized;
};

export const deploymentIdentityFromEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): DeploymentIdentity => ({
  gitCommit: clean(environment.APP_GIT_COMMIT, 'unknown'),
  imageVersion: clean(environment.APP_IMAGE_VERSION, 'local'),
  configurationVersion: clean(environment.APP_CONFIGURATION_VERSION, 'phase12-v1'),
});

const canonicalStrategyConfig = (config: TradingStrategyConfig): string =>
  JSON.stringify({
    fastEmaLength: config.fastEmaLength,
    slowEmaLength: config.slowEmaLength,
    rsiPeriod: config.rsiPeriod,
    atrPeriod: config.atrPeriod,
    atrMultiplier: config.atrMultiplier,
    minimumAtrPercent: config.minimumAtrPercent,
    maximumAtrPercent: config.maximumAtrPercent,
    stopLossPercent: config.stopLossPercent,
    takeProfitPercent: config.takeProfitPercent,
    riskPerTradePercent: config.riskPerTradePercent,
    trailingStopEnabled: config.trailingStopEnabled,
    trailingStopPercent: config.trailingStopPercent,
  });

export const strategyConfigurationFingerprint = (
  config: TradingStrategyConfig,
): string =>
  createHash('sha256').update(canonicalStrategyConfig(config)).digest('hex');
