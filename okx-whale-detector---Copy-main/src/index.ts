import { OKXInstrumentClient } from './clients/okx/OKXInstrumentClient';
import { OKXMarketDiscoveryClient } from './clients/okx/OKXMarketDiscoveryClient';
import { CorrelatedAlertEngine } from './alerts/CorrelatedAlertEngine';
import { appConfig } from './config/appConfig';
import { healthConfig, validateHealthConfig } from './config/healthConfig';
import {
  marketDiscoveryConfig,
  validateMarketDiscoveryConfig,
} from './config/marketDiscoveryConfig';
import {
  performanceConfig,
  validatePerformanceConfig,
} from './config/performanceConfig';
import {
  recordingConfig,
  validateRecordingConfig,
} from './config/recordingConfig';
import {
  subscriptionConfig,
  validateSubscriptionConfig,
} from './config/subscriptionConfig';
import {
  throughputConfig,
  validateThroughputConfig,
} from './config/throughputConfig';
import { resolveSymbolConfig, SYMBOL_PROFILES } from './config/symbolProfiles';
import { validateAppConfig } from './config/validateAppConfig';
import { CandleUpdateHandler } from './core/CandleUpdateHandler';
import { MarketHealthMonitor } from './core/MarketHealthMonitor';
import { MarketState } from './core/MarketState';
import { SubscriptionManager } from './core/SubscriptionManager';
import { SummaryThrottle } from './core/SummaryThrottle';
import { ThroughputMonitor } from './core/ThroughputMonitor';
import { PipelineProfiler } from './core/PipelineProfiler';
import { ProcessingMonitor } from './core/ProcessingMonitor';
import {
  MarketEngine,
  type AlphaMarketContextObserver,
} from './market/MarketEngine';
import { ExternalSignalCorrelationService } from './external/core/ExternalSignalCorrelationService';
import { PolymarketLiveSignalRuntime } from './external/providers/polymarket/PolymarketLiveSignalRuntime';
import { BoundedRecorderQueue } from './recording/BoundedRecorderQueue';
import { MarketDataRecorder } from './recording/MarketDataRecorder';
import { CorrelatedAlertRecorder } from './recording/CorrelatedAlertRecorder';
import { CorrelatedAlertReporter } from './reporting/CorrelatedAlertReporter';
import {
  AppShutdownCoordinator,
  type AppShutdownReason,
} from './runtime/AppShutdownCoordinator';
import { shouldAutoStartApp } from './runtime/appAutoStart';
import { createRuntimeSessionId } from './runtime/runtimeSession';
import type { MarketInstrumentConfig } from './types/instrument';

const ORDER_BOOK_CHANNEL = 'books';
const CANDLE_INTERVAL = '1m';
const MAXIMUM_RECORDER_QUEUE_SIZE = 10_000;

export type { AppShutdownReason } from './runtime/AppShutdownCoordinator';

export interface AppRuntimeDependencies {
  sourceSessionId?: string;
  runtimeSessionIdFactory?: () => string;
  externalSignalCorrelationService?: ExternalSignalCorrelationService;
  correlatedAlertEngine?: CorrelatedAlertEngine;
  correlatedAlertReporter?: CorrelatedAlertReporter;
  correlatedAlertRecorder?: CorrelatedAlertRecorder;
  alphaMarketContextObserver?: AlphaMarketContextObserver;
  polymarketRuntime?: PolymarketLiveSignalRuntime;
  marketDataRecorderFactory?: (
    directory: string,
    instruments: readonly MarketInstrumentConfig[],
    options: ConstructorParameters<typeof MarketDataRecorder>[2],
  ) => MarketDataRecorder;
}

export const createAppRuntime = async (
  dependencies: AppRuntimeDependencies = {},
): Promise<{
  externalSignalCorrelationService: ExternalSignalCorrelationService;
  correlatedAlertEngine: CorrelatedAlertEngine;
  correlatedAlertRecorder: CorrelatedAlertRecorder;
  sourceSessionId: string;
  marketDataRecorder?: MarketDataRecorder;
  marketEngine: MarketEngine;
  polymarketRuntime: PolymarketLiveSignalRuntime;
  shutdown: (signal: AppShutdownReason) => Promise<void>;
}> => {
  const runtimeStartedAt = Date.now();
  let sourceSessionId: string;

  if (dependencies.sourceSessionId !== undefined) {
    const providedSourceSessionId = dependencies.sourceSessionId;
    sourceSessionId = createRuntimeSessionId(() => providedSourceSessionId);
  } else if (dependencies.runtimeSessionIdFactory !== undefined) {
    sourceSessionId = createRuntimeSessionId(
      dependencies.runtimeSessionIdFactory,
    );
  } else if (dependencies.correlatedAlertEngine !== undefined) {
    const providedAlertEngine = dependencies.correlatedAlertEngine;
    sourceSessionId = createRuntimeSessionId(
      () => providedAlertEngine.sourceSessionId,
    );
  } else {
    sourceSessionId = createRuntimeSessionId();
  }

  if (
    dependencies.correlatedAlertEngine !== undefined &&
    dependencies.correlatedAlertEngine.sourceSessionId !== sourceSessionId
  ) {
    throw new Error(
      'Injected correlated alert engine sourceSessionId does not match the application runtime',
    );
  }

  validateAppConfig(appConfig);
  validateHealthConfig(healthConfig);
  validateMarketDiscoveryConfig(marketDiscoveryConfig);
  validatePerformanceConfig(performanceConfig);
  validateRecordingConfig(recordingConfig);
  validateSubscriptionConfig(subscriptionConfig);
  validateThroughputConfig(throughputConfig);

  console.log('OKX Whale Detector starting...');
  console.log('Discovering eligible OKX markets...');

  const discoveryClient = new OKXMarketDiscoveryClient();
  const activeProfiles = await discoveryClient.discoverProfiles(
    SYMBOL_PROFILES,
    marketDiscoveryConfig,
  );

  console.log(
    `Selected ${activeProfiles.length} markets ` +
      `(${SYMBOL_PROFILES.length} required, ` +
      `${activeProfiles.length - SYMBOL_PROFILES.length} discovered).`,
  );
  console.log('Loading OKX instrument metadata...');

  const instrumentClient = new OKXInstrumentClient();
  const instruments =
    await instrumentClient.loadMarketInstruments(activeProfiles);

  console.log(`Loaded metadata for ${instruments.size} instruments.`);

  const marketStates = new Map<string, MarketState>();
  const pipelineProfiler = new PipelineProfiler({
    enabled: performanceConfig.attributionEnabled,
    maximumSamplesPerStage: performanceConfig.maximumSamplesPerStage,
    maximumStages: performanceConfig.maximumProfiledStages,
  });
  const processingMonitor = new ProcessingMonitor(performanceConfig);
  const summaryThrottle = new SummaryThrottle(
    appConfig.reporting.summaryIntervalMs,
  );

  const requireInstrument = (symbol: string) => {
    const instrument = instruments.get(symbol);

    if (!instrument) {
      throw new Error(`Missing resolved instrument metadata for ${symbol}`);
    }

    return instrument;
  };

  const createMarketState = (symbol: string): MarketState =>
    new MarketState(resolveSymbolConfig(symbol), requireInstrument(symbol));

  for (const profile of activeProfiles) {
    marketStates.set(profile.symbol, createMarketState(profile.symbol));
  }

  const activeInstruments = activeProfiles.map((profile) =>
    requireInstrument(profile.symbol),
  );
  const marketDataRecorderOptions: ConstructorParameters<
    typeof MarketDataRecorder
  >[2] = {
    sourceSessionId,
    startedAt: runtimeStartedAt,
    orderBookChannel: ORDER_BOOK_CHANNEL,
    orderBookDepth: appConfig.history.orderBookLevelLimit,
    candleIntervals: [CANDLE_INTERVAL],
  };
  const recorder = recordingConfig.enabled
    ? (dependencies.marketDataRecorderFactory?.(
        recordingConfig.directory,
        activeInstruments,
        marketDataRecorderOptions,
      ) ??
      new MarketDataRecorder(
        recordingConfig.directory,
        activeInstruments,
        marketDataRecorderOptions,
      ))
    : undefined;
  const recorderQueue = recorder
    ? new BoundedRecorderQueue({
        maximumQueueSize: MAXIMUM_RECORDER_QUEUE_SIZE,
        onFailure: (error) => {
          console.error(
            'Market-data recording task failed; detection continues:',
            error,
          );
        },
        onDrop: (queueDepth) => {
          console.error(
            `Market-data recording queue is full at ${queueDepth} tasks. ` +
              'A raw record was dropped and the session must not be treated as complete research evidence.',
          );
        },
      })
    : undefined;
  const externalSignalCorrelationService =
    dependencies.externalSignalCorrelationService ??
    new ExternalSignalCorrelationService({
      correlation: appConfig.correlation,
    });
  const correlatedAlertEngine =
    dependencies.correlatedAlertEngine ??
    new CorrelatedAlertEngine({
      enabled: appConfig.correlatedAlerts.enabled,
      minimumAgreementAlertImportance:
        appConfig.correlatedAlerts.minimumAgreementAlertImportance,
      minimumContradictionAlertImportance:
        appConfig.correlatedAlerts.minimumContradictionAlertImportance,
      externalOnlyAlertsEnabled:
        appConfig.correlatedAlerts.externalOnlyAlertsEnabled,
      minimumExternalOnlyAlertImportance:
        appConfig.correlatedAlerts.minimumExternalOnlyAlertImportance,
      severityThresholds: appConfig.correlatedAlerts.severityThresholds,
      cooldownMs: appConfig.correlatedAlerts.cooldownSeconds * 1_000,
      confidenceChangeThreshold:
        appConfig.correlatedAlerts.confidenceChangeThreshold,
      sourceSessionId,
    });

  const correlatedAlertRecorder =
    dependencies.correlatedAlertRecorder ??
    new CorrelatedAlertRecorder({
      enabled: appConfig.correlatedAlertRecording.enabled,
      outputPath: appConfig.correlatedAlertRecording.outputPath,
      flushAfterEachAlert:
        appConfig.correlatedAlertRecording.flushAfterEachAlert,
    });
  const orderBookResyncRequester: {
    request?: (symbol: string) => boolean;
  } = {};
  const marketEngine = new MarketEngine(
    marketStates,
    summaryThrottle,
    undefined,
    processingMonitor,
    pipelineProfiler,
    externalSignalCorrelationService,
    correlatedAlertEngine,
    dependencies.correlatedAlertReporter,
    correlatedAlertRecorder,
    Date.now,
    'LIVE',
    (symbol) => {
      const accepted = orderBookResyncRequester.request?.(symbol) ?? false;
      if (!accepted) {
        console.error(
          `Unable to schedule automatic order-book resync for ${symbol}.`,
        );
      }
    },
    {
      maximumOrderBookAgeMs: healthConfig.orderBookStaleAfterMs,
      maximumFutureSkewMs: 5_000,
    },
    dependencies.alphaMarketContextObserver,
  );
  const polymarketRuntime =
    dependencies.polymarketRuntime ??
    new PolymarketLiveSignalRuntime(
      {
        enabled: appConfig.polymarket.enabled,
        minimumSignalUsd: appConfig.polymarket.minimumSignalUsd,
        minimumLiquidityUsd: appConfig.polymarket.minimumLiquidityUsd,
        marketLimit: appConfig.polymarket.marketLimit,
        watchMarkets: appConfig.polymarket.watchMarkets,
        windowSeconds: appConfig.polymarket.windowSeconds,
        minimumDominance: appConfig.polymarket.minimumDominance,
        signalCooldownSeconds: appConfig.polymarket.signalCooldownSeconds,
        statusSeconds: appConfig.polymarket.statusSeconds,
        showExecutions: appConfig.polymarket.showExecutions,
      },
      {
        correlationService: externalSignalCorrelationService,
        profiler: pipelineProfiler,
      },
    );
  const candleUpdateHandler = new CandleUpdateHandler(
    marketStates,
    undefined,
    pipelineProfiler,
  );
  const activeSymbols = activeProfiles.map((profile) => profile.symbol);
  const healthMonitor = new MarketHealthMonitor(activeSymbols, healthConfig);
  const throughputMonitor = new ThroughputMonitor(
    throughputConfig,
    undefined,
    undefined,
    Date.now(),
    pipelineProfiler,
  );
  let isShuttingDown = false;

  const subscriptionManager = new SubscriptionManager({
    maximumSymbolsPerConnection: subscriptionConfig.maximumSymbolsPerConnection,
    profiler: pipelineProfiler,
    onOrderBook: (update, messagePerformance) => {
      if (isShuttingDown) {
        return;
      }

      if (recorder && recorderQueue) {
        const accepted = recorderQueue.enqueue(() => {
          const startedAt = performance.now();
          recorder.recordOrderBook(update);
          pipelineProfiler.record(
            'recording.raw.orderBook',
            performance.now() - startedAt,
          );
        });

        if (!accepted) {
          pipelineProfiler.record('recording.raw.orderBook.dropped', 1);
        }
      }
      healthMonitor.recordOrderBook(update.instId);
      throughputMonitor.record(update.instId, 'orderBook');
      marketEngine.processOrderBookUpdate(update, messagePerformance);
    },
    onTrade: (trade) => {
      if (isShuttingDown) {
        return;
      }

      const state = marketStates.get(trade.instId);
      if (!state) {
        return;
      }

      const startedAt = performance.now();
      state.tradeFlowTracker.record(trade);
      pipelineProfiler.record(
        'tradeFlow.record',
        performance.now() - startedAt,
      );
    },
    onCandle: (candle) => {
      if (isShuttingDown) {
        return;
      }

      if (recorder && recorderQueue) {
        const accepted = recorderQueue.enqueue(() => {
          const startedAt = performance.now();
          recorder.recordCandle(candle, CANDLE_INTERVAL);
          pipelineProfiler.record(
            'recording.raw.candle',
            performance.now() - startedAt,
          );
        });

        if (!accepted) {
          pipelineProfiler.record('recording.raw.candle.dropped', 1);
        }
      }
      healthMonitor.recordCandle(candle.instId);
      throughputMonitor.record(candle.instId, 'candle');
      const startedAt = performance.now();
      candleUpdateHandler.handle(candle);
      pipelineProfiler.record(
        'candle.handler.total',
        performance.now() - startedAt,
      );
    },
    onShardReconnect: (symbols) => {
      console.warn(
        `🔄 OKX order-book shard reconnected for ${symbols.length} markets. ` +
          'Resetting only its local market state...',
      );

      for (const symbol of symbols) {
        marketStates.set(symbol, createMarketState(symbol));
      }

      candleUpdateHandler.resetSymbols(symbols);
      marketEngine.resetSymbols(symbols);
      healthMonitor.resetSymbols(symbols);
      throughputMonitor.resetSymbols(symbols);

      console.log(
        `✅ Reset ${symbols.length} markets. Waiting for fresh snapshots...`,
      );
    },
    orderBookResync: {
      maximumAttempts: 4,
      baseBackoffMs: 250,
      snapshotTimeoutMs: 5_000,
      onAttempt: (symbol, attempt) => {
        console.warn(
          `🔄 Resynchronizing ${symbol} order book (attempt ${attempt}/4)...`,
        );
      },
      onRecovered: (symbol, attempts) => {
        console.log(
          `✅ ${symbol} order-book resync completed after ${attempts} attempt${
            attempts === 1 ? '' : 's'
          }.`,
        );
      },
      onFailed: (symbol, attempts, error) => {
        console.error(
          `❌ ${symbol} order-book resync failed after ${attempts} attempts. ` +
            'Detector output for this symbol remains paused.',
          error,
        );
      },
    },
  });
  orderBookResyncRequester.request = (symbol) =>
    subscriptionManager.requestOrderBookResync(symbol);

  subscriptionManager.start(activeInstruments);
  healthMonitor.start();
  throughputMonitor.start();

  const shards = subscriptionManager.getShards();

  console.log(
    `Started ${shards.length} subscription shard${shards.length === 1 ? '' : 's'} ` +
      `with up to ${subscriptionConfig.maximumSymbolsPerConnection} markets each.`,
  );
  console.log(
    `Started market health monitoring for ${activeProfiles.length} markets.`,
  );
  console.log('Started throughput and event-loop monitoring.');
  console.log('Started public trade-flow confirmation for active markets.');

  if (recorder) {
    console.log(`Recording order-book and candle data to ${recorder.filePath}`);
  }

  const shutdownCoordinator = new AppShutdownCoordinator({
    beforeClose: (signal) => {
      isShuttingDown = true;
      console.log(`Received ${signal}; closing OKX connections.`);
    },
    stopPolymarket: () => polymarketRuntime.stop(),
    stopHealthMonitor: () => healthMonitor.stop(),
    stopThroughputMonitor: () => throughputMonitor.stop(),
    closeSubscriptions: () => subscriptionManager.close(),
    closeAlertRecorder: () => correlatedAlertRecorder.close(),
    closeMarketRecorder:
      recorder === undefined
        ? undefined
        : async (signal) => {
            await recorderQueue?.closeAndDrain();
            await recorder.close(signal);
          },
  });

  const shutdown = (signal: AppShutdownReason): Promise<void> =>
    shutdownCoordinator.shutdown(signal);

  const handleSignal = (signal: NodeJS.Signals): void => {
    void shutdown(signal).catch((error: unknown) => {
      console.error('Graceful shutdown failed:', error);
      process.exitCode = 1;
    });
  };

  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));

  return {
    externalSignalCorrelationService,
    correlatedAlertEngine,
    correlatedAlertRecorder,
    sourceSessionId,
    marketDataRecorder: recorder,
    marketEngine,
    polymarketRuntime,
    shutdown,
  };
};

export const start = async (
  dependencies: AppRuntimeDependencies = {},
): Promise<void> => {
  const appRuntime = await createAppRuntime(dependencies);
  void appRuntime.polymarketRuntime.start();
};

if (require.main === module && shouldAutoStartApp()) {
  void start().catch((error: unknown) => {
    console.error('Failed to start OKX Whale Detector:', error);
    process.exitCode = 1;
  });
}
