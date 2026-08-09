import { join } from 'node:path';
import { OKXCandleWebSocketClient } from '../clients/okx/OKXCandleWebSocketClient';
import { SYMBOL_PROFILES } from '../config/symbolProfiles';
import type { TradingTimeframe } from '../config/tradingTimeframes';
import { createAppRuntime } from '../index';
import { startProcessMemoryReporter } from '../observability/processMemoryReporter';
import { PaperStateRepository } from '../paper/PaperStateRepository';
import {
  startLeanPaperExecutionMarketData,
  type LeanPaperExecutionMarketDataRuntime,
} from '../platform/LeanPaperExecutionMarketData';
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

export interface TradingPlatformStartupSafety {
  readonly mode: PlatformMode;
  readonly remotePaperOnly: boolean;
}

/**
 * Production paper trading must remain safe even when the image is invoked
 * without the repository's Compose file. Development keeps the existing
 * monitoring-only LIVE selector, which still has no order execution adapter.
 */
export const resolveTradingPlatformStartupSafety = (
  environment: NodeJS.ProcessEnv,
): TradingPlatformStartupSafety => {
  const remotePaperOnly = parseBoolean(environment.REMOTE_PAPER_ONLY, false);
  const production = environment.NODE_ENV?.trim().toLowerCase() === 'production';
  const requestedMode = parseMode(environment.TRADING_MODE);

  if (production && !remotePaperOnly) {
    throw new Error(
      'Production startup requires REMOTE_PAPER_ONLY=true; refusing to start',
    );
  }
  if (remotePaperOnly && requestedMode !== 'PAPER') {
    throw new Error(
      'REMOTE_PAPER_ONLY=true is incompatible with TRADING_MODE=LIVE',
    );
  }

  return {
    mode: remotePaperOnly ? 'PAPER' : requestedMode,
    remotePaperOnly,
  };
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
  const safety = resolveTradingPlatformStartupSafety(environment);
  const withResearch = parseBoolean(environment.WITH_RESEARCH_RUNTIME, false);
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

  console.log('Trading platform starting');
  console.log(
    `Mode: ${withResearch ? 'PAPER TRADING + RESEARCH' : 'LEAN PAPER TRADING'}`,
  );
  console.log(`Research runtime: ${withResearch ? 'enabled' : 'disabled'}`);

  const platform = new TradingPlatformApplication({
    mode: safety.mode,
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
    remotePaperOnly: safety.remotePaperOnly,
    server: {
      host: environment.DASHBOARD_HOST?.trim() || '0.0.0.0',
      port: parsePositiveNumber(environment.DASHBOARD_PORT, 4173, 'DASHBOARD_PORT'),
      staticDirectory: environment.DASHBOARD_STATIC_DIR?.trim() || 'web',
    },
    environment,
  });

  const memoryReporter = startProcessMemoryReporter({
    intervalMs: parsePositiveNumber(
      environment.PROCESS_MEMORY_REPORT_INTERVAL_MS,
      60_000,
      'PROCESS_MEMORY_REPORT_INTERVAL_MS',
    ),
    additionalMetrics: () => platform.engine.getExecutionBookMetrics(),
  });

  await platform.start();

  const symbols = SYMBOL_PROFILES.map((profile) => profile.symbol);
  const candleClient = new OKXCandleWebSocketClient();
  let leanExecutionRuntime: LeanPaperExecutionMarketDataRuntime | null = null;
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

  const closeLeanServices = async (): Promise<void> => {
    memoryReporter.stop();
    leanExecutionRuntime?.close();
    candleClient.close();
    await platform.close();
  };

  try {
    await platform.prepareCandleRuntime({ symbols, controller });
    console.log(`Trading dashboard: ${platform.getUrl()}`);
    console.log(
      `Trading mode: ${platform.store.getSettings().mode}; ` +
        `timeframe: ${platform.store.getSettings().timeframe}; ` +
        'live order execution remains disabled.',
    );

    if (withResearch) {
      console.log(
        'Services: dashboard, EMA candles, paper ledger, research/whale runtime, order books, recorders/monitoring as configured, Polymarket as configured.',
      );
      // The established research runtime keeps its own 1m candle feed. Platform
      // strategy candles come only from the dedicated configurable client above.
      const runtime = await createAppRuntime({
        tradingPlatformObserver: {
          onOrderBook: (instrumentId, state) =>
            platform.onOrderBook(instrumentId, state),
          onCandle: () => undefined,
          close: async () => {
            memoryReporter.stop();
            candleClient.close();
            await platform.close();
          },
        },
      });
      void runtime.polymarketRuntime.start();
      return;
    }

    leanExecutionRuntime = await startLeanPaperExecutionMarketData({
      onOrderBook: (instrumentId, state) =>
        platform.engine.onOrderBook(instrumentId, state),
    });
    console.log(
      `Services: dashboard, EMA candle feed, paper ledger/state, ` +
        `lean execution order books (${leanExecutionRuntime.instruments} instruments).`,
    );
    console.log(
      'Research-only services are disabled: createAppRuntime, market discovery, whale engines, recorders, large recording queues and Polymarket.',
    );

    let closing = false;
    const handleSignal = (signal: NodeJS.Signals): void => {
      if (closing) return;
      closing = true;
      console.log(`Received ${signal}; closing lean paper-trading services.`);
      void closeLeanServices().catch((error: unknown) => {
        console.error('Lean paper-trading shutdown failed:', error);
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', () => handleSignal('SIGINT'));
    process.once('SIGTERM', () => handleSignal('SIGTERM'));
  } catch (error: unknown) {
    await closeLeanServices();
    throw error;
  }
};

if (require.main === module) {
  void startTradingPlatform().catch((error: unknown) => {
    console.error('Failed to start trading platform:', error);
    process.exitCode = 1;
  });
}
