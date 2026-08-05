import type { HealthConfig } from '../config/healthConfig';

export type HealthLogger = (message: string) => void;

interface SymbolHealthState {
  registeredAt: number;
  lastOrderBookAt?: number;
  lastCandleAt?: number;
  staleOrderBook: boolean;
  staleCandle: boolean;
}

export interface MarketHealthSummary {
  totalSymbols: number;
  healthySymbols: number;
  warmingSymbols: number;
  staleOrderBookSymbols: readonly string[];
  staleCandleSymbols: readonly string[];
}

export class MarketHealthMonitor {
  private readonly states = new Map<string, SymbolHealthState>();
  private checkTimer?: NodeJS.Timeout;
  private reportTimer?: NodeJS.Timeout;

  public constructor(
    symbols: readonly string[],
    private readonly config: HealthConfig,
    private readonly logger: HealthLogger = console.log,
    private readonly warningLogger: HealthLogger = console.warn,
    now: number = Date.now(),
  ) {
    for (const symbol of new Set(symbols)) {
      this.states.set(symbol, {
        registeredAt: now,
        staleOrderBook: false,
        staleCandle: false,
      });
    }
  }

  public recordOrderBook(symbol: string, now: number = Date.now()): void {
    const state = this.states.get(symbol);

    if (!state) {
      return;
    }

    state.lastOrderBookAt = now;

    if (state.staleOrderBook) {
      state.staleOrderBook = false;
      this.logger(`✅ Order book recovered for ${symbol}`);
    }
  }

  public recordCandle(symbol: string, now: number = Date.now()): void {
    const state = this.states.get(symbol);

    if (!state) {
      return;
    }

    state.lastCandleAt = now;

    if (state.staleCandle) {
      state.staleCandle = false;
      this.logger(`✅ Candle stream recovered for ${symbol}`);
    }
  }

  public check(now: number = Date.now()): MarketHealthSummary {
    const staleOrderBookSymbols: string[] = [];
    const staleCandleSymbols: string[] = [];
    let warmingSymbols = 0;
    let healthySymbols = 0;

    for (const [symbol, state] of this.states) {
      const withinGrace = now - state.registeredAt < this.config.startupGraceMs;

      if (withinGrace && (!state.lastOrderBookAt || !state.lastCandleAt)) {
        warmingSymbols += 1;
        continue;
      }

      const orderBookAge = state.lastOrderBookAt
        ? now - state.lastOrderBookAt
        : Number.POSITIVE_INFINITY;
      const candleAge = state.lastCandleAt
        ? now - state.lastCandleAt
        : Number.POSITIVE_INFINITY;
      const orderBookStale = orderBookAge >= this.config.orderBookStaleAfterMs;
      const candleStale = candleAge >= this.config.candleStaleAfterMs;

      if (orderBookStale) {
        staleOrderBookSymbols.push(symbol);

        if (!state.staleOrderBook) {
          state.staleOrderBook = true;
          this.warningLogger(
            `⚠️ Stale order book for ${symbol}: no update for ${this.formatAge(orderBookAge)}`,
          );
        }
      }

      if (candleStale) {
        staleCandleSymbols.push(symbol);

        if (!state.staleCandle) {
          state.staleCandle = true;
          this.warningLogger(
            `⚠️ Stale candle stream for ${symbol}: no update for ${this.formatAge(candleAge)}`,
          );
        }
      }

      if (!orderBookStale && !candleStale) {
        healthySymbols += 1;
      }
    }

    return {
      totalSymbols: this.states.size,
      healthySymbols,
      warmingSymbols,
      staleOrderBookSymbols,
      staleCandleSymbols,
    };
  }

  public report(now: number = Date.now()): MarketHealthSummary {
    const summary = this.check(now);

    this.logger(
      `💚 MARKET HEALTH | Healthy: ${summary.healthySymbols}/${summary.totalSymbols} | ` +
        `Warming: ${summary.warmingSymbols} | ` +
        `Stale books: ${summary.staleOrderBookSymbols.length} | ` +
        `Stale candles: ${summary.staleCandleSymbols.length}`,
    );

    return summary;
  }

  public start(): void {
    if (this.checkTimer || this.reportTimer) {
      return;
    }

    this.checkTimer = setInterval(
      () => this.check(),
      this.config.checkIntervalMs,
    );
    this.reportTimer = setInterval(
      () => this.report(),
      this.config.reportIntervalMs,
    );

    this.checkTimer.unref();
    this.reportTimer.unref();
  }

  public stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }

    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = undefined;
    }
  }

  public resetSymbols(
    symbols: readonly string[],
    now: number = Date.now(),
  ): void {
    for (const symbol of symbols) {
      if (!this.states.has(symbol)) {
        continue;
      }

      this.states.set(symbol, {
        registeredAt: now,
        staleOrderBook: false,
        staleCandle: false,
      });
    }
  }

  private formatAge(ageMs: number): string {
    if (!Number.isFinite(ageMs)) {
      return 'since startup';
    }

    return `${(ageMs / 1_000).toFixed(1)}s`;
  }
}
