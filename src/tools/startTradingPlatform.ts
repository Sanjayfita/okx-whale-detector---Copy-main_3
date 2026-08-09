import { join } from 'node:path';
import { OKXCandleWebSocketClient } from '../clients/okx/OKXCandleWebSocketClient';
import { SYMBOL_PROFILES } from '../config/symbolProfiles';
import type { TradingTimeframe } from '../config/tradingTimeframes';
import { createAppRuntime } from '../index';
import { PaperStateRepository } from '../paper/PaperStateRepository';
import { TradingPlatformApplication } from '../platform/TradingPlatformApplication';
import type { PlatformMode } from '../platform/PlatformContracts';
import { TradeExecutionContextRepository } from '../platform/TradeExecutionContextRepository';
import type { CandleTimeframeController } from '../platform/TradingPlatformObserver';

const parseMode = (value: string | undefined): PlatformMode =>
  value?.trim().toUpperCase() === 'LIVE' ? 'LIVE' : 'PAPER';

const parseBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  throw new Error(`invalid boolean value ${value}`);
};

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
  const remotePaperOnly = parseBoolean(environment.REMOTE_PAPER_ONLY, false);
  const dataDirectory = environment.PLATFORM_DATA_DIR?.trim() || 'data';
  const paperStatePath =
    environment.PAPER_STATE_PATH?.trim() ||
    join(dataDirectory, 'platform', 'paper-state.json');
  const tradeContextPath =
    environment.TRADE_CONTEXT_PATH?.trim() ||
    join(dataDirectory, 'platform', 'trade-contexts.json');
  const paperStateRepository = new PaperStateRepository({
    filePath: paperStatePath,
  });

  const platform = new TradingPlatformApplication({
    mode: remotePaperOnly ? 'PAPER' : parseMode(environment.TRADING_MODE),
    startingEquity: parsePositiveNumber(
      environment.PAPER_STARTING_EQUITY,
      10_000,
      'PAPER_STARTING_EQUITY',
    ),
    paperStateRepository,
    tradeExecutionContextRepository: new TradeExecutionContextRepository(
      tradeContextPath,
    ),
    paperCheckpointIntervalMs: parsePositiveNumber(
      environment.PAPER_CHECKPOINT_INTERVAL_MS,
      5_000,
      'PAPER_CHECKPOINT_INTERVAL_MS',
    ),
    healthCheckIntervalMs: parsePositiveNumber(
      environment.PLATFORM_HEALTH_CHECK_INTERVAL_MS,
      30_000,
      'PLATFORM_HEALTH_CHECK_INTERVAL_MS',
    ),
    dataDirectory,
    remotePaperOnly,
    server: {
      host: environment.DASHBOARD_HOST?.trim() || '0.0.0.0',
      port: parsePositiveNumber(environment.DASHBOARD_PORT, 4173, 'DASHBOARD_PORT'),
      staticDirectory: environment.DASHBOARD_STATIC_DIR?.trim() || 'web',
    },
    environment,
  });

  await platform.start();

  const symbols = SYMBOL_PROFILES.map((profile) => profile.symbol);
  const candleClient = new OKXCandleWebSocketClient();
  let activeTimeframe: TradingTimeframe = platform.store.getSettings().timeframe;
  const controller: CandleTimeframeController = {
    setTimeframe: (timeframe) => {
      activeTimeframe = timeframe;
      for (const symbol of symbols) {
        candleClient.setCandleInterval(symbol, timeframe);
      }
    },
    getTimeframe: () => activeTimeframe,
    getConnectionStatus: () => candleClient.getConnectionStatus(),
    reconnect: () => candleClient.forceReconnect(),
  };
  candleClient.onCandle((candle) => platform.onCandle(candle));
  candleClient.onReconnect(() => platform.resetSymbols(symbols));

  try {
    await platform.prepareCandleRuntime({ symbols, controller });
    console.log(`Trading dashboard: ${platform.getUrl()}`);
    console.log(
      `Mode: ${platform.store.getSettings().mode}; ` +
        `timeframe: ${platform.store.getSettings().timeframe}; ` +
        'live order execution remains disabled.',
    );

    // The established research runtime keeps its own 1m candle feed. Platform
    // strategy candles come only from the dedicated configurable client above.
    const runtime = await createAppRuntime({
      tradingPlatformObserver: {
        onOrderBook: (instrumentId, state) => platform.onOrderBook(instrumentId, state),
        onCandle: () => undefined,
        close: async () => {
          candleClient.close();
          await platform.close();
        },
      },
    });
    void runtime.polymarketRuntime.start();
  } catch (error: unknown) {
    candleClient.close();
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
