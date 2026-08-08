import { createAppRuntime } from '../index';
import { TradingPlatformApplication } from '../platform/TradingPlatformApplication';
import type { PlatformMode } from '../platform/PlatformContracts';

const parseMode = (value: string | undefined): PlatformMode =>
  value?.trim().toUpperCase() === 'LIVE' ? 'LIVE' : 'PAPER';

const parsePositiveNumber = (
  value: string | undefined,
  fallback: number,
  name: string,
): number => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return parsed;
};

export const startTradingPlatform = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const platform = new TradingPlatformApplication({
    mode: parseMode(environment.TRADING_MODE),
    startingEquity: parsePositiveNumber(
      environment.PAPER_STARTING_EQUITY,
      10_000,
      'PAPER_STARTING_EQUITY',
    ),
    server: {
      host: environment.DASHBOARD_HOST?.trim() || '0.0.0.0',
      port: parsePositiveNumber(environment.DASHBOARD_PORT, 4173, 'DASHBOARD_PORT'),
      staticDirectory: environment.DASHBOARD_STATIC_DIR?.trim() || 'web',
    },
    environment,
  });

  // Starting the server first loads persisted settings, including the selected
  // timeframe. createAppRuntime then invokes prepareCandleRuntime before live
  // subscriptions begin, so the strategy is initialized from native OKX history.
  await platform.start();
  console.log(`Trading dashboard: ${platform.getUrl()}`);
  console.log(
    `Mode: ${platform.store.getSettings().mode}; ` +
      `timeframe: ${platform.store.getSettings().timeframe}; ` +
      'live order execution remains disabled.',
  );

  try {
    const runtime = await createAppRuntime({ tradingPlatformObserver: platform });
    void runtime.polymarketRuntime.start();
  } catch (error: unknown) {
    await platform.close();
    throw error;
  }
};

if (require.main === module) {
  void startTradingPlatform().catch((error: unknown) => {
    console.error('Failed to start trading platform:', error);
    process.exitCode = 1;
  });
}
