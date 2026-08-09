import type { ThroughputConfig } from '../config/throughputConfig';
import type {
  PipelineProfiler,
  RecentPipelineStageStats,
} from './PipelineProfiler';

export type ThroughputLogger = (message: string) => void;

type StreamKind = 'orderBook' | 'candle';

interface SymbolCounts {
  orderBook: number;
  candle: number;
}

export interface ThroughputSummary {
  intervalMs: number;
  orderBookUpdates: number;
  candleUpdates: number;
  orderBookPerSecond: number;
  candlePerSecond: number;
  maximumEventLoopLagMs: number;
  busiestSymbols: readonly {
    symbol: string;
    totalUpdates: number;
  }[];
}

export class ThroughputMonitor {
  private readonly counts = new Map<string, SymbolCounts>();
  private reportTimer?: NodeJS.Timeout;
  private eventLoopTimer?: NodeJS.Timeout;
  private intervalStartedAt: number;
  private maximumEventLoopLagMs = 0;
  private lastLagWarningAt?: number;

  public constructor(
    private readonly config: ThroughputConfig,
    private readonly logger: ThroughputLogger = console.log,
    private readonly warningLogger: ThroughputLogger = console.warn,
    now: number = Date.now(),
    private readonly profiler?: PipelineProfiler,
  ) {
    this.intervalStartedAt = now;
  }

  public record(symbol: string, stream: StreamKind): void {
    const counts = this.counts.get(symbol) ?? { orderBook: 0, candle: 0 };
    counts[stream] += 1;
    this.counts.set(symbol, counts);
  }

  public recordEventLoopLag(lagMs: number, now: number = Date.now()): void {
    if (!Number.isFinite(lagMs) || lagMs < 0) {
      return;
    }

    this.maximumEventLoopLagMs = Math.max(this.maximumEventLoopLagMs, lagMs);

    if (lagMs < this.config.eventLoopLagWarningMs) {
      return;
    }

    if (
      this.lastLagWarningAt !== undefined &&
      now - this.lastLagWarningAt < this.config.warningCooldownMs
    ) {
      return;
    }

    this.lastLagWarningAt = now;
    const recent = this.profiler?.getRecentSnapshot() ?? [];
    const busiestStages = [...recent]
      .sort((left, right) => right.p95Ms - left.p95Ms)
      .slice(0, 5)
      .map(
        (stage) =>
          `${stage.stage}:p95=${stage.p95Ms.toFixed(2)}ms/n=${stage.count}`,
      )
      .join(', ');
    const summarize = (
      predicate: (stage: RecentPipelineStageStats) => boolean,
    ): string => {
      const matches = recent.filter(predicate);

      if (matches.length === 0) {
        return 'n/a';
      }

      const p95Ms = Math.max(...matches.map((stage) => stage.p95Ms));
      const count = matches.reduce((total, stage) => total + stage.count, 0);
      return `p95=${p95Ms.toFixed(2)}ms/n=${count}`;
    };
    let orderBookMessages = 0;
    let candleMessages = 0;

    for (const counts of this.counts.values()) {
      orderBookMessages += counts.orderBook;
      candleMessages += counts.candle;
    }
    const polymarketMessages =
      recent.find((stage) => stage.stage === 'polymarket.queueDelay')?.count ??
      0;

    this.warningLogger(
      `⚠️ Event-loop lag: ${lagMs.toFixed(2)}ms ` +
        `(threshold ${this.config.eventLoopLagWarningMs}ms)\n` +
        `Recent activity around lag sample (observed elapsed time may include GC/OS scheduling; not definitive causation): ` +
        `stages=${busiestStages || 'n/a'} | ` +
        `queue=${summarize((stage) => stage.stage.includes('queueDelay'))} | ` +
        `messages=books:${orderBookMessages},candles:${candleMessages},polymarket:${polymarketMessages} | ` +
        `console=${summarize((stage) => stage.stage.includes('console'))} | ` +
        `polymarket=${summarize((stage) => stage.stage.startsWith('polymarket.'))} | ` +
        `alertPersistence=${summarize((stage) => stage.stage.startsWith('alert.persistence'))}`,
    );
  }

  public report(now: number = Date.now()): ThroughputSummary {
    const intervalMs = Math.max(1, now - this.intervalStartedAt);
    let orderBookUpdates = 0;
    let candleUpdates = 0;

    const busiestSymbols = [...this.counts.entries()]
      .map(([symbol, counts]) => {
        orderBookUpdates += counts.orderBook;
        candleUpdates += counts.candle;

        return {
          symbol,
          totalUpdates: counts.orderBook + counts.candle,
        };
      })
      .sort((left, right) => right.totalUpdates - left.totalUpdates)
      .slice(0, this.config.maximumSymbolsInReport);

    const seconds = intervalMs / 1_000;
    const summary: ThroughputSummary = {
      intervalMs,
      orderBookUpdates,
      candleUpdates,
      orderBookPerSecond: orderBookUpdates / seconds,
      candlePerSecond: candleUpdates / seconds,
      maximumEventLoopLagMs: this.maximumEventLoopLagMs,
      busiestSymbols,
    };

    const busiest = busiestSymbols.length
      ? busiestSymbols
          .map((entry) => `${entry.symbol}:${entry.totalUpdates}`)
          .join(', ')
      : 'none';

    this.logger(
      `📈 THROUGHPUT | Books: ${summary.orderBookPerSecond.toFixed(1)}/s | ` +
        `Candles: ${summary.candlePerSecond.toFixed(1)}/s | ` +
        `Max loop lag: ${summary.maximumEventLoopLagMs.toFixed(1)}ms | ` +
        `Busiest: ${busiest}`,
    );

    this.counts.clear();
    this.maximumEventLoopLagMs = 0;
    this.intervalStartedAt = now;

    return summary;
  }

  public start(): void {
    if (this.reportTimer || this.eventLoopTimer) {
      return;
    }

    this.reportTimer = setInterval(
      () => this.report(),
      this.config.reportIntervalMs,
    );

    let expectedAt = Date.now() + this.config.eventLoopSampleIntervalMs;
    this.eventLoopTimer = setInterval(() => {
      const now = Date.now();
      this.recordEventLoopLag(Math.max(0, now - expectedAt), now);
      expectedAt = now + this.config.eventLoopSampleIntervalMs;
    }, this.config.eventLoopSampleIntervalMs);

    this.reportTimer.unref();
    this.eventLoopTimer.unref();
  }

  public stop(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = undefined;
    }

    if (this.eventLoopTimer) {
      clearInterval(this.eventLoopTimer);
      this.eventLoopTimer = undefined;
    }
  }

  public resetSymbols(symbols: readonly string[]): void {
    for (const symbol of symbols) {
      this.counts.delete(symbol);
    }
  }
}
