import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import {
  tradingTimeframeSpec,
  type TradingTimeframe,
} from '../config/tradingTimeframes';
import type { MarketState } from '../core/MarketState';
import { createNotificationServiceFromEnvironment } from '../notifications/createNotificationService';
import type { PaperStateRepository } from '../paper/PaperStateRepository';
import type { DashboardSettings, PlatformMode } from './PlatformContracts';
import { OkxCandleHistoryBridge } from './OkxCandleHistoryBridge';
import { PlatformStateStore } from './PlatformStateStore';
import { TradingPlatformEngine } from './TradingPlatformEngine';
import type {
  CandleTimeframeController,
  TradingPlatformObserver,
} from './TradingPlatformObserver';
import {
  TradingPlatformServer,
  type TradingPlatformServerOptions,
} from './TradingPlatformServer';

export interface TradingPlatformApplicationOptions {
  readonly mode?: PlatformMode;
  readonly startingEquity?: number;
  readonly server?: TradingPlatformServerOptions;
  readonly environment?: NodeJS.ProcessEnv;
  readonly paperStateRepository?: PaperStateRepository;
  readonly paperCheckpointIntervalMs?: number;
  readonly now?: () => number;
}

const utcDay = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);

export class TradingPlatformApplication implements TradingPlatformObserver {
  public readonly store: PlatformStateStore;
  public readonly engine: TradingPlatformEngine;
  public readonly server: TradingPlatformServer;

  private readonly now: () => number;
  private readonly paperCheckpointIntervalMs: number;
  private summaryTimer: NodeJS.Timeout | null = null;
  private paperCheckpointTimer: NodeJS.Timeout | null = null;
  private summaryDay: string;
  private symbols: readonly string[] = [];
  private candleController: CandleTimeframeController | null = null;
  private rebuildQueue: Promise<void> = Promise.resolve();

  public constructor(options: TradingPlatformApplicationOptions = {}) {
    this.now = options.now ?? Date.now;
    this.paperCheckpointIntervalMs = options.paperCheckpointIntervalMs ?? 5_000;
    if (
      !Number.isSafeInteger(this.paperCheckpointIntervalMs) ||
      this.paperCheckpointIntervalMs <= 0
    ) {
      throw new Error('paperCheckpointIntervalMs must be a positive safe integer');
    }
    this.store = new PlatformStateStore({
      startingEquity: options.startingEquity,
      mode: options.mode,
      paperStateRepository: options.paperStateRepository,
      now: this.now,
    });
    this.engine = new TradingPlatformEngine(this.store, {
      notifications: createNotificationServiceFromEnvironment(
        options.environment ?? process.env,
      ),
      now: this.now,
    });
    this.server = new TradingPlatformServer(this.store, this.engine, {
      ...options.server,
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
    await this.server.start();
    this.store.log('INFO', 'Trading platform application started', {
      url: this.server.getUrl(),
      mode: this.store.getSettings().mode,
      timeframe: this.store.getSettings().timeframe,
      paperStateLoaded: reconciliation.stateLoaded,
      reconciliation: reconciliation.result,
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
    this.engine.onOrderBook(instrumentId, state);
  }

  public onCandle(candle: OKXCandle): void {
    this.engine.onCandle(candle);
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
    this.store.persistPaperState(this.now());
    await this.server.close();
  }

  public getUrl(): string {
    return this.server.getUrl();
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
              this,
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
            sink: this,
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
