import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import type { MarketState } from '../core/MarketState';
import { createNotificationServiceFromEnvironment } from '../notifications/createNotificationService';
import type { PlatformMode } from './PlatformContracts';
import { PlatformStateStore } from './PlatformStateStore';
import { TradingPlatformEngine } from './TradingPlatformEngine';
import type { TradingPlatformObserver } from './TradingPlatformObserver';
import {
  TradingPlatformServer,
  type TradingPlatformServerOptions,
} from './TradingPlatformServer';

export interface TradingPlatformApplicationOptions {
  readonly mode?: PlatformMode;
  readonly startingEquity?: number;
  readonly server?: TradingPlatformServerOptions;
  readonly environment?: NodeJS.ProcessEnv;
  readonly now?: () => number;
}

const utcDay = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);

/**
 * Composition root for the usability layer. The existing OKX runtime only sees the
 * small TradingPlatformObserver interface; all dashboard, paper account, risk and
 * notification concerns remain here.
 */
export class TradingPlatformApplication implements TradingPlatformObserver {
  public readonly store: PlatformStateStore;
  public readonly engine: TradingPlatformEngine;
  public readonly server: TradingPlatformServer;

  private readonly now: () => number;
  private summaryTimer: NodeJS.Timeout | null = null;
  private summaryDay: string;

  public constructor(options: TradingPlatformApplicationOptions = {}) {
    this.now = options.now ?? Date.now;
    this.store = new PlatformStateStore({
      startingEquity: options.startingEquity,
      mode: options.mode,
      now: this.now,
    });
    this.engine = new TradingPlatformEngine(this.store, {
      notifications: createNotificationServiceFromEnvironment(
        options.environment ?? process.env,
      ),
      now: this.now,
    });
    this.server = new TradingPlatformServer(
      this.store,
      this.engine,
      options.server,
    );
    this.summaryDay = utcDay(this.now());
  }

  public async start(): Promise<void> {
    await this.server.start();
    this.store.log('INFO', 'Trading platform application started', {
      url: this.server.getUrl(),
      mode: this.store.getSettings().mode,
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
    });
  }

  public async close(): Promise<void> {
    if (this.summaryTimer !== null) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = null;
    }
    await this.server.close();
  }

  public getUrl(): string {
    return this.server.getUrl();
  }
}
