import { ExternalSignalCorrelationService } from '../../core/ExternalSignalCorrelationService';
import { ExternalSignalRelevanceEngine } from '../../core/ExternalSignalRelevanceEngine';
import type {
  EffectiveExternalSignal,
  ExternalWhaleSignal,
} from '../../types/ExternalWhaleSignal';
import { PolymarketLiveAggregator } from './PolymarketLiveAggregator';
import { PolymarketLiveSignalFactory } from './PolymarketLiveSignalFactory';
import {
  PolymarketMarketWebSocketClient,
  type PolymarketLiveTrade,
} from './PolymarketMarketWebSocketClient';
import {
  PolymarketPublicClient,
  type PolymarketMarket,
} from './PolymarketPublicClient';
import { PolymarketWhaleDetector } from './PolymarketWhaleDetector';
import type { PipelineProfiler } from '../../../core/PipelineProfiler';

export interface PolymarketLiveSignalRuntimeOptions {
  minimumSignalUsd: number;
  minimumLiquidityUsd: number;
  marketLimit: number;
  watchMarkets: number;
  windowSeconds: number;
  minimumDominance: number;
  signalCooldownSeconds: number;
  statusSeconds: number;
  showExecutions: boolean;
  enabled?: boolean;
}

export interface PolymarketLiveSignalRuntimeDependencies {
  publicClient?: PolymarketPublicClient;
  webSocketClientFactory?: (
    tokenIds: readonly string[],
    onTrade: (trade: PolymarketLiveTrade) => void,
  ) => PolymarketMarketWebSocketClient;
  detector?: PolymarketWhaleDetector;
  aggregator?: PolymarketLiveAggregator;
  signalFactory?: PolymarketLiveSignalFactory;
  correlationService?: ExternalSignalCorrelationService;
  relevanceEngine?: ExternalSignalRelevanceEngine;
  now?: () => number;
  timerApi?: Pick<typeof globalThis, 'setInterval' | 'clearInterval'> & {
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
  };
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  onSignal?: (
    signal: ExternalWhaleSignal,
    effective: EffectiveExternalSignal,
  ) => void;
  profiler?: PipelineProfiler;
}

interface TokenContextEntry {
  market: PolymarketMarket;
  outcome: string;
}

const formatUsd = (value: number): string =>
  value.toLocaleString('en-US', { maximumFractionDigits: 2 });

const resolutionTime = (endDate: string | undefined): number => {
  if (!endDate) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(endDate);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

export class PolymarketLiveSignalRuntime {
  private readonly options: PolymarketLiveSignalRuntimeOptions;
  private readonly dependencies: PolymarketLiveSignalRuntimeDependencies;
  private readonly publicClient: PolymarketPublicClient;
  private readonly detector: PolymarketWhaleDetector;
  private readonly aggregator: PolymarketLiveAggregator;
  private readonly signalFactory: PolymarketLiveSignalFactory;
  private readonly correlationService: ExternalSignalCorrelationService;
  private readonly relevanceEngine: ExternalSignalRelevanceEngine;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly now: () => number;
  private readonly profiler?: PipelineProfiler;
  private readonly timerApi: Pick<
    typeof globalThis,
    'setInterval' | 'clearInterval'
  > & {
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
  };
  private readonly lastSignalAtByMarket = new Map<string, number>();
  private readonly emittedSignalIds = new Set<string>();
  private started = false;
  private startPromise: Promise<void> | undefined;
  private lifecycleGeneration = 0;
  private statusTimer: ReturnType<typeof globalThis.setInterval> | undefined;
  private webSocketClient: PolymarketMarketWebSocketClient | undefined;
  private marketByCondition = new Map<string, PolymarketMarket>();
  private tokenContext = new Map<string, TokenContextEntry>();
  private receivedExecutions = 0;
  private directionalExecutions = 0;
  private unknownTokenExecutions = 0;
  private unknownDirectionExecutions = 0;
  private emittedSignals = 0;
  private lastExecutionAt: number | undefined;

  public constructor(
    options: Partial<PolymarketLiveSignalRuntimeOptions> = {},
    dependencies: PolymarketLiveSignalRuntimeDependencies = {},
  ) {
    this.options = {
      minimumSignalUsd: 5_000,
      minimumLiquidityUsd: 5_000,
      marketLimit: 2_000,
      watchMarkets: 100,
      windowSeconds: 60,
      minimumDominance: 0.15,
      signalCooldownSeconds: 15,
      statusSeconds: 30,
      showExecutions: false,
      enabled: true,
      ...options,
    };
    this.dependencies = dependencies;
    this.publicClient =
      dependencies.publicClient ?? new PolymarketPublicClient();
    this.detector =
      dependencies.detector ??
      new PolymarketWhaleDetector({
        minimumLiquidityUsd: this.options.minimumLiquidityUsd,
        minimumTradeNotionalUsd: 0,
      });
    this.aggregator =
      dependencies.aggregator ??
      new PolymarketLiveAggregator({
        windowMs: this.options.windowSeconds * 1_000,
        minimumNetNotionalUsd: this.options.minimumSignalUsd,
        minimumDominance: this.options.minimumDominance,
      });
    this.signalFactory =
      dependencies.signalFactory ??
      new PolymarketLiveSignalFactory({
        minimumNetNotionalUsd: this.options.minimumSignalUsd,
      });
    this.correlationService =
      dependencies.correlationService ?? new ExternalSignalCorrelationService();
    this.relevanceEngine =
      dependencies.relevanceEngine ?? new ExternalSignalRelevanceEngine();
    this.logger = dependencies.logger ?? console;
    this.now = dependencies.now ?? (() => Date.now());
    this.profiler = dependencies.profiler;
    this.timerApi = dependencies.timerApi ?? globalThis;
  }

  public async start(): Promise<void> {
    if (!this.options.enabled) {
      this.logger.warn('Polymarket live ingestion disabled in configuration.');
      return;
    }

    if (this.started) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    const generation = ++this.lifecycleGeneration;
    this.logger.log('Starting Polymarket live ingestion in background...');
    this.startPromise = this.initialize(generation);

    try {
      await this.startPromise;
    } catch (error) {
      if (this.isActiveGeneration(generation)) {
        this.logger.warn(
          'Polymarket live ingestion is unavailable; continuing in OKX-only mode.',
          error,
        );
      }
    } finally {
      if (this.isActiveGeneration(generation)) {
        this.startPromise = undefined;
      }
    }
  }

  public stop(): void {
    if (!this.started && !this.startPromise) {
      return;
    }

    this.lifecycleGeneration += 1;
    this.started = false;

    if (this.statusTimer) {
      this.timerApi.clearInterval(this.statusTimer);
      this.statusTimer = undefined;
    }

    this.webSocketClient?.close();
    this.webSocketClient = undefined;
    this.aggregator.clear();
    this.lastSignalAtByMarket.clear();
    this.emittedSignalIds.clear();
  }

  private async initialize(generation: number): Promise<void> {
    const markets = await this.publicClient.getActiveMarkets(
      this.options.marketLimit,
    );

    if (!this.isActiveGeneration(generation)) {
      return;
    }
    const discoveryTime = this.now();
    const watchedMarkets = markets
      .filter((market) => this.detector.isRelevantMarket(market))
      .filter((market) => (market.tokenIds?.length ?? 0) > 0)
      .sort((left, right) => {
        const leftResolution = resolutionTime(left.endDate);
        const rightResolution = resolutionTime(right.endDate);
        const leftUpcoming = leftResolution >= discoveryTime;
        const rightUpcoming = rightResolution >= discoveryTime;

        if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
        if (leftResolution !== rightResolution) {
          return leftResolution - rightResolution;
        }
        return right.volume - left.volume;
      })
      .slice(0, this.options.watchMarkets);

    if (!this.isActiveGeneration(generation)) {
      return;
    }

    this.marketByCondition = new Map(
      watchedMarkets.map((market) => [market.conditionId, market]),
    );
    this.tokenContext = new Map<string, TokenContextEntry>();

    for (const market of watchedMarkets) {
      const tokenIds = market.tokenIds ?? [];
      const outcomes = market.outcomes ?? [];

      tokenIds.forEach((tokenId, index) => {
        this.tokenContext.set(tokenId, {
          market,
          outcome: outcomes[index] ?? `Outcome ${index + 1}`,
        });
      });
    }

    if (!this.isActiveGeneration(generation)) {
      return;
    }

    if (this.tokenContext.size === 0) {
      throw new Error(
        'No relevant Polymarket outcome token IDs were discovered',
      );
    }

    this.logger.log('POLYMARKET LIVE WHALE WATCHER');
    this.logger.log(`Markets discovered: ${markets.length}`);
    this.logger.log(`Relevant markets watched: ${watchedMarkets.length}`);
    this.logger.log(`Outcome tokens subscribed: ${this.tokenContext.size}`);
    this.logger.log(
      `Minimum rolling net signal: $${this.options.minimumSignalUsd.toLocaleString('en-US')}`,
    );
    this.logger.log(`Rolling window: ${this.options.windowSeconds}s`);
    this.logger.log(
      `Minimum dominance: ${(this.options.minimumDominance * 100).toFixed(1)}%`,
    );
    this.logger.log(
      `Signal cooldown: ${this.options.signalCooldownSeconds}s per market`,
    );
    this.logger.log(`Status interval: ${this.options.statusSeconds}s`);
    this.logger.log(
      `Individual executions: ${this.options.showExecutions ? 'shown' : 'hidden'}`,
    );
    this.logger.log('Waiting for real-time trades. Press Ctrl+C to stop.\n');

    if (!this.isActiveGeneration(generation)) {
      return;
    }

    const tokenIds = [...this.tokenContext.keys()];
    this.webSocketClient =
      this.dependencies.webSocketClientFactory?.(tokenIds, (trade) =>
        this.handleTrade(trade),
      ) ??
      new PolymarketMarketWebSocketClient(
        tokenIds,
        (trade) => this.handleTrade(trade),
        {},
        this.profiler,
      );

    if (!this.isActiveGeneration(generation)) {
      return;
    }

    this.statusTimer = this.timerApi.setInterval(() => {
      this.logStatus();
    }, this.options.statusSeconds * 1_000);

    if (!this.isActiveGeneration(generation)) {
      return;
    }

    this.started = true;
    this.webSocketClient.connect();
    this.logger.log('Polymarket live ingestion ready.');
  }

  private isActiveGeneration(generation: number): boolean {
    return this.lifecycleGeneration === generation;
  }

  private handleTrade(liveTrade: PolymarketLiveTrade): void {
    this.receivedExecutions += 1;
    this.lastExecutionAt = this.now();

    const context = this.tokenContext.get(liveTrade.tokenId);
    if (!context) {
      this.unknownTokenExecutions += 1;
      return;
    }

    const interpretation = this.measure('polymarket.interpretation', () =>
      this.detector.interpretTrade(
        {
          proxyWallet: '',
          side: liveTrade.side,
          asset: liveTrade.tokenId,
          conditionId: context.market.conditionId,
          size: liveTrade.size,
          price: liveTrade.price,
          timestamp: liveTrade.timestamp,
          title: context.market.question,
          slug: context.market.slug,
          eventSlug: '',
          outcome: context.outcome,
          outcomeIndex: (context.market.tokenIds ?? []).indexOf(
            liveTrade.tokenId,
          ),
          transactionHash:
            liveTrade.transactionHash ??
            `${liveTrade.tokenId}:${liveTrade.timestamp}:${liveTrade.price}:${liveTrade.size}:${liveTrade.side}`,
        },
        context.market,
      ),
    );

    if (
      interpretation.direction === 'UNKNOWN' ||
      interpretation.direction === 'NEUTRAL'
    ) {
      this.unknownDirectionExecutions += 1;
      if (this.options.showExecutions) {
        this.logger.log(
          `UNKNOWN EXECUTION | ${context.outcome} | ${liveTrade.side} | ${context.market.question}`,
        );
      }
      return;
    }

    this.directionalExecutions += 1;

    if (this.options.showExecutions) {
      this.logger.log(
        `EXECUTION | ${interpretation.direction} | $${formatUsd(interpretation.notionalUsd)} | ${context.market.question}`,
      );
    }

    const executionId =
      liveTrade.transactionHash ??
      `${liveTrade.tokenId}:${liveTrade.timestamp}:${liveTrade.price}:${liveTrade.size}:${liveTrade.side}`;
    const now = this.now();
    const aggregation = this.measure('polymarket.aggregation', () =>
      this.aggregator.add(
        {
          id: executionId,
          marketConditionId: context.market.conditionId,
          occurredAt: interpretation.occurredAt,
          direction: interpretation.direction,
          notionalUsd: interpretation.notionalUsd,
        },
        now,
      ),
    );

    if (!aggregation.qualifies) return;

    const lastSignalAt =
      this.lastSignalAtByMarket.get(context.market.conditionId) ?? 0;
    if (now - lastSignalAt < this.options.signalCooldownSeconds * 1_000) {
      return;
    }

    this.lastSignalAtByMarket.set(context.market.conditionId, now);
    const storedSignal = this.measure(
      'polymarket.signalConstructionStore',
      () => {
        const signal = this.signalFactory.create(
          context.market,
          aggregation,
          now,
        );
        return this.correlationService.addSignal(signal, now);
      },
    );
    const evaluationSymbol = storedSignal.asset
      ? `${storedSignal.asset}-USDT`
      : 'MACRO';
    const effective = this.relevanceEngine.evaluate(
      storedSignal,
      evaluationSymbol,
      now,
    );
    this.emittedSignals += 1;

    if (this.emittedSignalIds.has(storedSignal.id)) {
      return;
    }
    this.emittedSignalIds.add(storedSignal.id);

    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.log(`${aggregation.direction} | ${context.market.question}`);
    this.logger.log(
      `Rolling net: $${formatUsd(Math.abs(aggregation.netDirectionalNotionalUsd))}`,
    );
    this.logger.log(`Bullish: $${formatUsd(aggregation.bullishNotionalUsd)}`);
    this.logger.log(`Bearish: $${formatUsd(aggregation.bearishNotionalUsd)}`);
    this.logger.log(
      `Dominance: ${(aggregation.dominance * 100).toFixed(1)}% | Executions: ${aggregation.executionCount}`,
    );
    this.logger.log(
      `EXTERNAL SIGNAL | ${storedSignal.provider}/${storedSignal.category} | Asset: ${storedSignal.asset ?? 'MACRO'}`,
    );
    this.logger.log(
      `Confidence: ${storedSignal.confidence.toFixed(1)}% | Relevance: ${(effective.relevance * 100).toFixed(1)}% | Freshness: ${(effective.freshness * 100).toFixed(1)}%`,
    );
    this.logger.log(
      `Correlation-ready confidence: ${effective.effectiveConfidence.toFixed(1)}%`,
    );
    this.logger.log(
      `Stored external signals: ${this.correlationService.getSize(now)}`,
    );
    this.logger.log(`Window: last ${this.options.windowSeconds}s`);
    this.dependencies.onSignal?.(storedSignal, effective);
  }

  private logStatus(): void {
    const startedAt = performance.now();

    try {
      const now = this.now();
      const lastExecution = this.lastExecutionAt
        ? `${Math.max(0, Math.round((now - this.lastExecutionAt) / 1_000))}s ago`
        : 'none yet';
      this.logger.log(
        `[LIVE STATUS] executions=${this.receivedExecutions} directional=${this.directionalExecutions} unknownToken=${this.unknownTokenExecutions} unknownDirection=${this.unknownDirectionExecutions} signals=${this.emittedSignals} stored=${this.correlationService.getSize(now)} lastExecution=${lastExecution}`,
      );

      const strongestMarkets = this.aggregator
        .getActive(now)
        .sort(
          (left, right) =>
            Math.abs(right.netDirectionalNotionalUsd) -
            Math.abs(left.netDirectionalNotionalUsd),
        )
        .slice(0, 3);

      for (const aggregation of strongestMarkets) {
        const market = this.marketByCondition.get(
          aggregation.marketConditionId,
        );
        this.logger.log(
          `  TOP FLOW | ${aggregation.direction} net=$${formatUsd(Math.abs(aggregation.netDirectionalNotionalUsd))} bull=$${formatUsd(aggregation.bullishNotionalUsd)} bear=$${formatUsd(aggregation.bearishNotionalUsd)} dominance=${(aggregation.dominance * 100).toFixed(1)}% executions=${aggregation.executionCount} | ${market?.question ?? aggregation.marketConditionId}`,
        );
      }
    } finally {
      this.profiler?.record(
        'polymarket.statusReporting',
        performance.now() - startedAt,
      );
    }
  }

  private measure<T>(stage: string, operation: () => T): T {
    if (!this.profiler) {
      return operation();
    }

    return this.profiler.measure(stage, operation);
  }
}
