import { SYMBOL_PROFILES } from '../config/symbolProfiles';
import { createAppRuntime } from '../index';
import { OkxCandleHistoryBridge } from '../platform/OkxCandleHistoryBridge';
import { TradingPlatformApplication } from '../platform/TradingPlatformApplication';
import type { PlatformMode } from '../platform/PlatformContracts';
import type { TradingPlatformObserver } from '../platform/TradingPlatformObserver';

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

const requiredStrategyHistory = (platform: TradingPlatformApplication): number => {
  const config = platform.store.getStrategyConfig();
  return Math.max(
    config.slowEmaLength + 2,
    config.rsiPeriod + 2,
    config.atrPeriod + 2,
  );
};

const syncOkxHistoryMonitoringOnly = async (
  platform: TradingPlatformApplication,
  bridge: OkxCandleHistoryBridge,
  instrumentIds: readonly string[],
  reason: 'STARTUP' | 'RECONNECT',
): Promise<void> => {
  const originalMode = platform.store.getSettings().mode;
  const requiredHistory = requiredStrategyHistory(platform);
  const requestedHistory = Math.min(100, Math.max(requiredHistory, 100));

  // Historical candles rebuild point-in-time indicators only. Temporarily forcing
  // monitoring mode prevents an offline crossover from becoming a retroactive
  // paper trade when the process starts or reconnects.
  if (originalMode !== 'LIVE') {
    platform.store.updateSettings({ mode: 'LIVE' });
  }

  try {
    for (const instrumentId of [...new Set(instrumentIds)]) {
      try {
        const result = await bridge.syncInstrument(
          instrumentId,
          platform,
          requestedHistory,
        );
        platform.store.log('INFO', 'OKX candle history reconciled', {
          instrumentId,
          reason,
          confirmedCandles: result.confirmedCandles,
          requiredCandles: requiredHistory,
          firstTimestamp: result.firstTimestamp,
          lastTimestamp: result.lastTimestamp,
        });
        console.log(
          `${reason === 'STARTUP' ? 'History' : 'Gap-fill'} ${instrumentId}: ` +
            `${result.confirmedCandles} confirmed OKX candles`,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        platform.store.log('WARNING', 'OKX candle history reconciliation failed', {
          instrumentId,
          reason,
          error: message,
        });
        console.warn(`History sync failed for ${instrumentId}: ${message}`);
      }
    }
  } finally {
    if (platform.store.getSettings().mode !== originalMode) {
      platform.store.updateSettings({ mode: originalMode });
    }
  }
};

export const startTradingPlatform = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const requestedMode = parseMode(environment.TRADING_MODE);
  const platform = new TradingPlatformApplication({
    // Startup history must never create retroactive trades. PAPER mode is restored
    // only after the OKX historical series has been attached to the strategy.
    mode: 'LIVE',
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
  const historyBridge = new OkxCandleHistoryBridge({ maximumCandles: 100 });
  let historySyncQueue: Promise<void> = Promise.resolve();

  const enqueueHistorySync = (
    instrumentIds: readonly string[],
    reason: 'STARTUP' | 'RECONNECT',
  ): Promise<void> => {
    historySyncQueue = historySyncQueue.then(() =>
      syncOkxHistoryMonitoringOnly(platform, historyBridge, instrumentIds, reason),
    );
    return historySyncQueue;
  };

  await enqueueHistorySync(
    SYMBOL_PROFILES.map((profile) => profile.symbol),
    'STARTUP',
  );
  if (requestedMode !== 'LIVE') {
    platform.store.updateSettings({ mode: requestedMode });
  }

  await platform.start();
  console.log(`Trading dashboard: ${platform.getUrl()}`);
  console.log(
    `Mode: ${platform.store.getSettings().mode}; live order execution remains disabled.`,
  );

  const platformObserver: TradingPlatformObserver = {
    onOrderBook: (instrumentId, state) => platform.onOrderBook(instrumentId, state),
    onCandle: (candle) => platform.onCandle(candle),
    resetSymbols: (symbols) => {
      platform.resetSymbols(symbols);
      void enqueueHistorySync(symbols, 'RECONNECT');
    },
    close: async () => {
      await historySyncQueue;
      await platform.close();
    },
  };

  try {
    const runtime = await createAppRuntime({
      tradingPlatformObserver: platformObserver,
    });
    void runtime.polymarketRuntime.start();
  } catch (error: unknown) {
    await platformObserver.close?.();
    throw error;
  }
};

if (require.main === module) {
  void startTradingPlatform().catch((error: unknown) => {
    console.error('Failed to start trading platform:', error);
    process.exitCode = 1;
  });
}
