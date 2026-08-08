import { OKXHistoricalDataClient } from '../clients/okx/OKXHistoricalDataClient';
import { SYMBOL_PROFILES } from '../config/symbolProfiles';
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

const warmPlatformCandleHistory = async (
  platform: TradingPlatformApplication,
): Promise<void> => {
  const historical = new OKXHistoricalDataClient();
  const config = platform.store.getStrategyConfig();
  const requiredHistory = Math.max(
    config.slowEmaLength + 2,
    config.rsiPeriod + 2,
    config.atrPeriod + 2,
  );
  const requestedHistory = Math.min(100, Math.max(requiredHistory, 75));

  console.log(
    `Warming strategy with up to ${requestedHistory} confirmed 1m candles per market...`,
  );

  for (const profile of SYMBOL_PROFILES) {
    try {
      const page = await historical.fetchCandlesPage({
        instrumentId: profile.symbol,
        interval: '1m',
        intervalMs: 60_000,
        limit: requestedHistory,
      });
      const records = page.records
        .filter((record) => record.confirmed)
        .slice()
        .sort((left, right) => left.observedAt - right.observedAt);

      for (const record of records) {
        platform.onCandle({
          instId: record.instrumentId,
          timestamp: record.observedAt,
          open: record.open,
          high: record.high,
          low: record.low,
          close: record.close,
          volume: record.contractVolume,
          volumeCurrency: record.baseVolume ?? 0,
          volumeCurrencyQuote: record.quoteVolume ?? 0,
          confirm: true,
        });
      }

      platform.store.log('INFO', 'Strategy candle history warmed', {
        instrumentId: profile.symbol,
        confirmedCandles: records.length,
        requiredCandles: requiredHistory,
      });
      console.log(
        `Warm-up ${profile.symbol}: ${records.length} confirmed candles`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      platform.store.log('WARNING', 'Strategy candle warm-up failed', {
        instrumentId: profile.symbol,
        error: message,
      });
      console.warn(`Warm-up failed for ${profile.symbol}: ${message}`);
    }
  }
};

export const startTradingPlatform = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const requestedMode = parseMode(environment.TRADING_MODE);
  // Warm historical candles in monitoring-only mode. This lets EMA/RSI/ATR become
  // immediately ready without ever opening a retroactive paper position.
  const platform = new TradingPlatformApplication({
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

  await warmPlatformCandleHistory(platform);
  if (requestedMode !== 'LIVE') {
    platform.store.updateSettings({ mode: requestedMode });
  }

  await platform.start();
  console.log(`Trading dashboard: ${platform.getUrl()}`);
  console.log(
    `Mode: ${platform.store.getSettings().mode}; live order execution remains disabled.`,
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
