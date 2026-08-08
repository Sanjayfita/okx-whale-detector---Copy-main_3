import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import {
  tradingTimeframeSpec,
  type TradingTimeframe,
} from '../config/tradingTimeframes';
import type { MarketState } from '../core/MarketState';
import { createNotificationServiceFromEnvironment } from '../notifications/createNotificationService';
import type { NotificationService } from '../notifications/NotificationService';
import type { PaperStateRepository } from '../paper/PaperStateRepository';
import type { DashboardSettings, PlatformMode } from './PlatformContracts';
import {
  deploymentIdentityFromEnvironment,
  strategyConfigurationFingerprint,
  type DeploymentIdentity,
} from './DeploymentIdentity';
import { OkxCandleHistoryBridge } from './OkxCandleHistoryBridge';
import {
  buildPlatformHealthSnapshot,
  type PlatformHealthSnapshot,
} from './PlatformHealth';
import { PlatformStateStore } from './PlatformStateStore';
import { TradeExecutionContextRepository } from './TradeExecutionContextRepository';
import { TradingPlatformEngine } from './TradingPlatformEngine';
import type {
  CandleTimeframeController,
  TradingPlatformObserver,
} from './TradingPlatformObserver';
import {
  TradingPlatformServer,
  type TradingPlatformServerOptions,
} from './TradingPlatformServer';

export type OkxRestHealthProbe = () => Promise<void>;

export interface TradingPlatformApplicationOptions {
  readonly mode?: PlatformMode;
  readonly startingEquity?: number;
  readonly server?: TradingPlatformServerOptions;
  readonly environment?: NodeJS.ProcessEnv;
  readonly paperStateRepository?: PaperStateRepository;
  readonly tradeExecutionContextRepository?: TradeExecutionContextRepository;
  readonly paperCheckpointIntervalMs?: number;
  readonly healthCheckIntervalMs?: number;
  readonly dataDirectory?: string;
  readonly deploymentIdentity?: DeploymentIdentity;
  readonly okxRestHealthProbe?: OkxRestHealthProbe;
  readonly remotePaperOnly?: boolean;
  readonly now?: () => number;
}

const utcDay = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const defaultOkxRestHealthProbe: OkxRestHealthProbe = async () => {
  const response = await fetch('https://www.okx.com/api/v5/public/time', {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`OKX REST health probe returned HTTP ${response.status}`);
  const body = (await response.json()) as unknown;
  if (!isRecord(body) || body.code !== '0') {
    throw new Error('OKX REST health probe returned an invalid exchange envelope');
  }
};

export class TradingPlatformApplication implements TradingPlatformObserver {
  public readonly store: PlatformStateStore;
  public readonly engine: TradingPlatformEngine;
  public readonly server: TradingPlatformServer;

  private readonly now: () => number;
  private readonly paperCheckpointIntervalMs: number;
  private readonly healthCheckIntervalMs: number;
  private readonly notifications: NotificationService;
  private readonly paperStateRepository?: PaperStateRepository;
  private readonly tradeExecutionContextRepository?: TradeExecutionContextRepository;
  private readonly dataDirectory: string;
  private readonly deploymentIdentity: DeploymentIdentity;
  private readonly okxRestHealthProbe: OkxRestHealthProbe;
  private readonly startedAt: number;
  private summaryTimer: NodeJS.Timeout | null = null;
  private paperCheckpointTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private summaryDay: string;
  private symbols: readonly string[] = [];
  private candleController: CandleTimeframeController | null = null;
  private rebuildQueue: Promise<void> = Promise.resolve();
  private lastLiveCandleReceivedAt: number | null = null;
  private lastLiveCandleTimestamp: number | null = null;
  private lastStrategyEvaluationAt: number | null = null;
  private okxRestConnected = false;
  private okxRestLastSuccessAt: number | null = null;
  private okxRestLastError: string | null = null;
  private paperEngineError: string | null = null;
  private lastHealthSignature = '';
  private lastStaleRecoveryAt: number | null = null;

  public constructor(options: TradingPlatformApplicationOptions = {}) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.paperCheckpointIntervalMs = options.paperCheckpointIntervalMs ?? 5_000;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 30_000;
    if (
      !Number.isSafeInteger(this.paperCheckpointIntervalMs) ||
      this.paperCheckpointIntervalMs <= 0
    ) {
      throw new Error('paperCheckpointIntervalMs must be a positive safe integer');
    }
    if (
      !Number.isSafeInteger(this.healthCheckIntervalMs) ||
      this.healthCheckIntervalMs <= 0
    ) {
      throw new Error('healthCheckIntervalMs must be a positive safe integer');
    }
    const environment = options.environment ?? process.env;
    this.notifications = createNotificationServiceFromEnvironment(environment);
    this.paperStateRepository = options.paperStateRepository;
    this.tradeExecutionContextRepository = options.tradeExecutionContextRepository;
    this.dataDirectory = options.dataDirectory ?? '.';
    this.deploymentIdentity =
      options.deploymentIdentity ?? deploymentIdentityFromEnvironment(environment);
    this.okxRestHealthProbe = options.okxRestHealthProbe ?? defaultOkxRestHealthProbe;

    this.store = new PlatformStateStore({
      startingEquity: options.startingEquity,
      mode: options.mode,
      paperStateRepository: options.paperStateRepository,
      now: this.now,
    });
    this.engine = new TradingPlatformEngine(this.store, {
      notifications: this.notifications,
      now: this.now,
    });
    this.server = new TradingPlatformServer(this.store, this.engine, {
      ...options.server,
      healthProvider: () => this.getHealthSnapshot(),
      allowLiveMonitoringMode: !(options.remotePaperOnly ?? false),
      onSettingsChanged: async (previous, next) => {
        await options.server?.onSettingsChanged?.(previous, next);
        await this.handleSettingsChanged(previous, next);
      },
    });
    this.summaryDay = utcDay(this.now());
  }

  public async start(): Promise<void> {
    // Settings must load before paper state so timeframe/strategy context can be
    // compared deterministically before any live market subscription resumes.
    await this.server.loadPersistedSettings();
    const reconciliation = this.store.restorePaperState();
    this.tradeExecutionContextRepository?.load();
    await this.server.start();
    this.store.log('INFO', 'Trading platform application started', {
      url: this.server.getUrl(),
      mode: this.store.getSettings().mode,
      timeframe: this.store.getSettings().timeframe,
      paperStateLoaded: reconciliation.stateLoaded,
      reconciliation: reconciliation.result,
      gitCommit: this.deploymentIdentity.gitCommit,
      imageVersion: this.deploymentIdentity.imageVersion,
      configurationVersion: this.deploymentIdentity.configurationVersion,
      liveExecutionAllowed: false,
    });

    this.summaryTimer = setInterval(() => {
      const timestamp = this.now();
      const day = utcDay(timestamp);
      if (day !== this.summaryDay) {
        this.engine.sendDailySummary(timestamp);
        this.summaryDay = day;
      }
    }, 60_000);
    this.summaryTimer.unref();

    // High-frequency order-book marks are checkpointed on a bounded cadence;
    // fills, closes, funding and trailing/risk mutations persist immediately in
    // TradingPlatformEngine/PlatformStateStore.
    this.paperCheckpointTimer = setInterval(() => {
      try {
        this.store.persistPaperState(this.now());
      } catch (error: unknown) {
        this.store.log('ERROR', 'Periodic paper-state checkpoint failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.paperCheckpointIntervalMs);
    this.paperCheckpointTimer.unref();

    void this.runHealthCheck();
    this.healthTimer = setInterval(() => {
      void this.runHealthCheck();
    }, this.healthCheckIntervalMs);
    this.healthTimer.unref();
  }

  public async prepareCandleRuntime(input: {
    readonly symbols: readonly string[];
    readonly controller: CandleTimeframeController;
  }): Promise<void> {
    this.symbols = [...new Set(input.symbols)];
    this.candleController = input.controller;
    const timeframe = this.store.getSettings().timeframe;
    input.controller.setTimeframe(timeframe);
    await this.queueRebuild(timeframe, this.symbols);
  }

  public onOrderBook(instrumentId: string, state: MarketState): void {
    try {
      this.engine.onOrderBook(instrumentId, state);
      this.paperEngineError = null;
    } catch (error: unknown) {
      this.paperEngineError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  public onCandle(candle: OKXCandle): void {
    this.processCandle(candle, true);
  }

  public resetSymbols(symbols: readonly string[]): void {
    this.store.log('WARNING', 'Market-data shard reset observed by platform', {
      symbols: symbols.join(','),
      timeframe: this.store.getSettings().timeframe,
    });
    if (this.candleController !== null) {
      void this.queueRebuild(this.store.getSettings().timeframe, this.symbols).catch(
        (error: unknown) => {
          this.store.log('ERROR', 'Candle history reconciliation failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
    }
  }

  public async close(): Promise<void> {
    if (this.summaryTimer !== null) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = null;
    }
    if (this.paperCheckpointTimer !== null) {
      clearInterval(this.paperCheckpointTimer);
      this.paperCheckpointTimer = null;
    }
    if (this.healthTimer !== null) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.store.persistPaperState(this.now());
    await this.server.close();
  }

  public getUrl(): string {
    return this.server.getUrl();
  }

  public getHealthSnapshot(): PlatformHealthSnapshot {
    const timestamp = this.now();
    const platform = this.store.snapshot(timestamp);
    const connection = this.candleController?.getConnectionStatus?.();
    const persistence = this.paperStateRepository?.getHealth() ?? {
      healthy: true,
      lastSuccessfulSaveAt: null,
      lastError: null,
      fileSizeBytes: null,
    };
    return buildPlatformHealthSnapshot({
      now: timestamp,
      startedAt: this.startedAt,
      timeframe: platform.settings.timeframe,
      timeframeState: platform.timeframe.state,
      lastCandleTimestamp: this.lastLiveCandleTimestamp,
      lastCandleReceivedAt: this.lastLiveCandleReceivedAt,
      lastStrategyEvaluationAt: this.lastStrategyEvaluationAt,
      websocketConnected: connection?.state === 'CONNECTED',
      websocketLastMessageAt: connection?.lastMessageAt ?? null,
      websocketReconnectAttempts: connection?.reconnectAttempts ?? 0,
      okxRestConnected: this.okxRestConnected,
      okxRestLastSuccessAt: this.okxRestLastSuccessAt,
      okxRestLastError: this.okxRestLastError,
      persistenceHealthy: persistence.healthy,
      lastSuccessfulPersistenceAt: persistence.lastSuccessfulSaveAt,
      persistenceError: persistence.lastError,
      stateFilePath: this.paperStateRepository?.getFilePath() ?? null,
      paperEngineError: this.paperEngineError,
      openPositions: platform.positions.length,
      killSwitchActive: platform.risk.killSwitchActive,
      circuitBreakerActive: platform.risk.circuitBreakerActive,
      dataDirectory: this.dataDirectory,
      deployment: this.deploymentIdentity,
    });
  }

  private processCandle(candle: OKXCandle, live: boolean): void {
    if (live) {
      this.lastLiveCandleReceivedAt = this.now();
      this.lastLiveCandleTimestamp = candle.timestamp;
    }
    const beforeTradeIds =
      candle.confirm && this.tradeExecutionContextRepository !== undefined
        ? new Set(
            this.store.account
              .snapshot(candle.timestamp)
              .openPositions.map((position) => position.tradeId),
          )
        : null;
    try {
      this.engine.onCandle(candle);
      this.paperEngineError = null;
      if (candle.confirm) this.lastStrategyEvaluationAt = candle.timestamp;
      if (beforeTradeIds !== null) this.recordNewTradeContexts(beforeTradeIds);
    } catch (error: unknown) {
      this.paperEngineError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private recordNewTradeContexts(beforeTradeIds: ReadonlySet<string>): void {
    const repository = this.tradeExecutionContextRepository;
    if (repository === undefined) return;
    const config = this.store.getStrategyConfig();
    const fingerprint = strategyConfigurationFingerprint(config);
    const current = this.store.account.snapshot(this.now()).openPositions;
    for (const position of current) {
      if (beforeTradeIds.has(position.tradeId)) continue;
      try {
        repository.record({
          tradeId: position.tradeId,
          instrumentId: position.instrumentId,
          strategyId: position.strategyId,
          strategyVersion: position.strategyId,
          timeframe: position.timeframe,
          strategyConfig: config,
          strategyConfigFingerprint: fingerprint,
          deployment: this.deploymentIdentity,
          recordedAt: this.now(),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.paperEngineError = `trade execution context persistence failed: ${message}`;
        this.store.log('ERROR', 'Paper trade context persistence failed', {
          tradeId: position.tradeId,
          instrumentId: position.instrumentId,
          error: message,
        });
        this.store.setKillSwitch(true);
        void this.notifications.send({
          type: 'ERROR',
          timestamp: this.now(),
          title: 'Paper trade context persistence failed',
          message: `${position.instrumentId}: ${message}`,
          metadata: { tradeId: position.tradeId },
        });
      }
    }
  }

  private async runHealthCheck(): Promise<void> {
    try {
      await this.okxRestHealthProbe();
      this.okxRestConnected = true;
      this.okxRestLastSuccessAt = this.now();
      this.okxRestLastError = null;
    } catch (error: unknown) {
      this.okxRestConnected = false;
      this.okxRestLastError = error instanceof Error ? error.message : String(error);
    }

    const health = this.getHealthSnapshot();
    await this.recoverStaleMarketData(health);
    const signature = [
      health.application,
      health.okxRest.status,
      health.okxWebSocket.status,
      health.marketData.status,
      health.strategy.status,
      health.paperEngine.status,
      health.persistence.status,
      health.disk.status,
      health.risk.killSwitchActive,
      health.risk.circuitBreakerActive,
    ].join('|');
    if (signature === this.lastHealthSignature) return;
    this.lastHealthSignature = signature;

    if (health.application === 'RUNNING') {
      this.store.log('INFO', 'Remote paper platform health recovered', {
        application: health.application,
        marketData: health.marketData.status,
        websocket: health.okxWebSocket.status,
        persistence: health.persistence.status,
      });
      return;
    }

    this.store.log(
      health.application === 'FAILED' ? 'ERROR' : 'WARNING',
      'Remote paper platform health degraded',
      {
        application: health.application,
        okxRest: health.okxRest.status,
        websocket: health.okxWebSocket.status,
        marketData: health.marketData.status,
        persistence: health.persistence.status,
        disk: health.disk.status,
        killSwitchActive: health.risk.killSwitchActive,
        circuitBreakerActive: health.risk.circuitBreakerActive,
      },
    );
    void this.notifications.send({
      type: 'ERROR',
      timestamp: this.now(),
      title: `Remote paper platform ${health.application.toLowerCase()}`,
      message:
        `REST ${health.okxRest.status}; WS ${health.okxWebSocket.status}; ` +
        `market ${health.marketData.status}; persistence ${health.persistence.status}; ` +
        `disk ${health.disk.status}; kill switch ${health.risk.killSwitchActive}; ` +
        `circuit breaker ${health.risk.circuitBreakerActive}`,
      metadata: {
        timeframe: health.marketData.timeframe,
        killSwitchActive: health.risk.killSwitchActive,
        circuitBreakerActive: health.risk.circuitBreakerActive,
        liveExecutionAllowed: false,
      },
    });
  }

  private async recoverStaleMarketData(
    health: PlatformHealthSnapshot,
  ): Promise<void> {
    if (
      health.marketData.status !== 'STALE' ||
      health.okxWebSocket.status !== 'CONNECTED' ||
      this.candleController?.reconnect === undefined
    ) {
      return;
    }
    const timestamp = this.now();
    if (
      this.lastStaleRecoveryAt !== null &&
      timestamp - this.lastStaleRecoveryAt < health.marketData.staleAfterMs
    ) {
      return;
    }
    this.lastStaleRecoveryAt = timestamp;
    this.store.log('WARNING', 'Stale live candle stream detected; forcing reconnect', {
      timeframe: health.marketData.timeframe,
      lastCandleTimestamp: health.marketData.lastCandleTimestamp,
      lastReceivedAt: health.marketData.lastReceivedAt,
      staleAfterMs: health.marketData.staleAfterMs,
    });
    this.candleController.reconnect();
  }

  private async handleSettingsChanged(
    previous: DashboardSettings,
    next: DashboardSettings,
  ): Promise<void> {
    if (previous.timeframe === next.timeframe) {
      this.store.persistPaperState(this.now());
      return;
    }
    if (this.candleController === null || this.symbols.length === 0) {
      this.store.setTimeframeState(
        'READY',
        `Selected ${next.timeframe}; live candle runtime not attached yet`,
      );
      this.store.persistPaperState(this.now());
      return;
    }

    try {
      await this.queueRebuild(next.timeframe, this.symbols);
      this.store.persistPaperState(this.now());
    } catch (error: unknown) {
      // The server restores the settings object after this callback rejects. Restore
      // the actual live subscription and indicator state too, so the runtime cannot
      // remain half-switched on a timeframe whose history failed to initialize.
      this.store.updateSettings({ timeframe: previous.timeframe });
      try {
        await this.rebuildTimeframe(previous.timeframe, this.symbols);
        this.store.persistPaperState(this.now());
      } catch (restoreError: unknown) {
        this.store.log('ERROR', 'Previous timeframe restoration also failed', {
          timeframe: previous.timeframe,
          error:
            restoreError instanceof Error
              ? restoreError.message
              : String(restoreError),
        });
      }
      throw error;
    }
  }

  private queueRebuild(
    timeframe: TradingTimeframe,
    symbols: readonly string[],
  ): Promise<void> {
    const task = this.rebuildQueue.then(() =>
      this.rebuildTimeframe(timeframe, symbols),
    );
    this.rebuildQueue = task.catch(() => undefined);
    return task;
  }

  private async rebuildTimeframe(
    timeframe: TradingTimeframe,
    symbols: readonly string[],
  ): Promise<void> {
    const controller = this.candleController;
    if (controller === null) return;

    this.engine.beginTimeframeRebuild(timeframe);
    controller.setTimeframe(timeframe);
    this.store.log('INFO', 'Rebuilding strategy timeframe', {
      timeframe,
      instruments: symbols.length,
    });

    try {
      const required = Math.max(
        this.store.getStrategyConfig().slowEmaLength + 2,
        this.store.getStrategyConfig().rsiPeriod + 2,
        this.store.getStrategyConfig().atrPeriod + 2,
        75,
      );
      const bridge = new OkxCandleHistoryBridge({
        timeframe,
        maximumCandles: 100,
      });
      const historicalSink = {
        onCandle: (candle: OKXCandle): void => this.processCandle(candle, false),
      };
      const spec = tradingTimeframeSpec(timeframe);
      const results = [];
      for (const instrumentId of [...new Set(symbols)]) {
        const recoveredTimestamp = this.store.getRecoveredCandleTimestamp(
          instrumentId,
          timeframe,
        );
        if (recoveredTimestamp === null) {
          results.push(
            await bridge.syncInstrument(
              instrumentId,
              historicalSink,
              Math.min(100, required),
            ),
          );
          continue;
        }
        const oldestRequiredTimestamp = Math.max(
          0,
          recoveredTimestamp - required * spec.intervalMs,
        );
        results.push(
          await bridge.syncInstrumentFrom({
            instrumentId,
            sink: historicalSink,
            oldestRequiredTimestamp,
            recoveredAfterTimestamp: recoveredTimestamp,
          }),
        );
      }

      const barriers = new Map<string, number>();
      let recoveredCandles = 0;
      for (const result of results) {
        if (result.lastTimestamp !== null) {
          barriers.set(result.instrumentId, result.lastTimestamp);
        }
        recoveredCandles += result.recoveredCandles;
        this.store.log('INFO', 'OKX candle history synchronized', {
          instrumentId: result.instrumentId,
          timeframe,
          confirmedCandles: result.confirmedCandles,
          recoveredCandles: result.recoveredCandles,
          pagesFetched: result.pagesFetched,
        });
      }
      this.engine.completeTimeframeRebuild(timeframe, barriers);
      this.store.log('INFO', 'Paper market-data reconciliation completed', {
        timeframe,
        recoveredCandles,
        instruments: results.length,
      });
      this.store.persistPaperState(this.now());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.engine.failTimeframeRebuild(timeframe, message);
      throw error;
    }
  }
}
