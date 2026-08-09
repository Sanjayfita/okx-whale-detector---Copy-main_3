import type { OKXOrderBookUpdate } from '../clients/okx/OKXWebSocketClient';
import type { CorrelatedAlertEngine } from '../alerts/CorrelatedAlertEngine';
import { performanceConfig } from '../config/performanceConfig';
import type { MarketState } from '../core/MarketState';
import { PipelineProfiler } from '../core/PipelineProfiler';
import {
  PerformanceTrace,
  type MessagePerformanceContext,
} from '../core/PerformanceTrace';
import { ProcessingMonitor } from '../core/ProcessingMonitor';
import { SummaryThrottle } from '../core/SummaryThrottle';
import type { WhaleScanResult } from '../core/WhaleTracker';
import {
  MarketReporter,
  type MarketSummaryAggregates,
} from '../reporting/MarketReporter';
import { CorrelatedAlertReporter } from '../reporting/CorrelatedAlertReporter';
import type { ExternalSignalCorrelationService } from '../external/core/ExternalSignalCorrelationService';
import type { CorrelatedAlertRecorder } from '../recording/CorrelatedAlertRecorder';
import { createCorrelatedAlertEvaluationContext } from '../recording/correlatedAlertEvaluationContext';
import type { CorrelatedAlertProvenance } from '../types/correlatedAlertEvaluation';
import type { MarketEvaluation } from '../types/marketEvaluation';
import type { OrderLevel } from '../types/orderbook';
import type { Wall } from '../types/wall';
import type { VersionedCorrelatedAlert } from '../types/correlatedAlert';
import type { CorrelatedAlertEvaluationContext } from '../types/correlatedAlertEvaluation';
import type { AlphaMarketContextSnapshot } from '../research/alphaFeatureTypes';

export interface MarketEngineFreshnessOptions {
  readonly maximumOrderBookAgeMs?: number;
  readonly maximumFutureSkewMs?: number;
}

export interface AlphaMarketContextObserverInput {
  readonly alert: VersionedCorrelatedAlert;
  readonly evaluationContext: CorrelatedAlertEvaluationContext;
  readonly marketContext: AlphaMarketContextSnapshot;
}

export type AlphaMarketContextObserver = (
  input: AlphaMarketContextObserverInput,
) => void;

export const prepareMarketSummaryAggregates = (
  whaleScan: Pick<
    WhaleScanResult,
    'active' | 'totalBidNotionalQuote' | 'totalAskNotionalQuote'
  >,
  walls: readonly Wall[],
): MarketSummaryAggregates => {
  let bidWhaleCount = 0;
  let askWhaleCount = 0;

  for (const whale of whaleScan.active) {
    if (whale.side === 'BID') {
      bidWhaleCount += 1;
    } else {
      askWhaleCount += 1;
    }
  }

  let newWallCount = 0;
  let activeWallCount = 0;
  let persistentWallCount = 0;
  let strongWallCount = 0;

  for (const wall of walls) {
    switch (wall.status) {
      case 'NEW':
        newWallCount += 1;
        break;
      case 'ACTIVE':
        activeWallCount += 1;
        break;
      case 'PERSISTENT':
        persistentWallCount += 1;
        break;
      case 'STRONG':
        strongWallCount += 1;
        break;
    }
  }

  return {
    bidWhaleCount,
    askWhaleCount,
    totalBidWhaleNotionalQuote: whaleScan.totalBidNotionalQuote,
    totalAskWhaleNotionalQuote: whaleScan.totalAskNotionalQuote,
    totalActiveWhaleCount: whaleScan.active.length,
    trackedWallCount: walls.length,
    newWallCount,
    activeWallCount,
    persistentWallCount,
    strongWallCount,
  };
};

const sumNotional = (levels: Iterable<OrderLevel>): number => {
  let total = 0;
  for (const level of levels) {
    total += level.notionalQuote;
  }
  return total;
};

export class MarketEngine {
  private readonly sequenceGapSymbols = new Set<string>();
  private readonly suspendedSymbols = new Set<string>();
  private readonly lastEvaluations = new Map<string, MarketEvaluation>();
  private readonly maximumOrderBookAgeMs: number;
  private readonly maximumFutureSkewMs: number;

  constructor(
    private readonly marketStates: Map<string, MarketState>,
    private readonly summaryThrottle: SummaryThrottle,
    private readonly reporter: MarketReporter = new MarketReporter(),
    private readonly processingMonitor: ProcessingMonitor = new ProcessingMonitor(
      performanceConfig,
    ),
    private readonly pipelineProfiler: PipelineProfiler = new PipelineProfiler(),
    private readonly correlationService?: ExternalSignalCorrelationService,
    private readonly correlatedAlertEngine?: CorrelatedAlertEngine,
    private readonly correlatedAlertReporter: CorrelatedAlertReporter = new CorrelatedAlertReporter(),
    private readonly correlatedAlertRecorder?: CorrelatedAlertRecorder,
    private readonly clock: () => number = Date.now,
    private readonly alertProvenance: CorrelatedAlertProvenance = 'LIVE',
    private readonly onSequenceGap?: (symbol: string) => void,
    freshness: MarketEngineFreshnessOptions = {},
    private readonly alphaMarketContextObserver?: AlphaMarketContextObserver,
  ) {
    this.maximumOrderBookAgeMs =
      freshness.maximumOrderBookAgeMs ?? Number.POSITIVE_INFINITY;
    this.maximumFutureSkewMs = freshness.maximumFutureSkewMs ?? 5_000;

    if (
      (this.maximumOrderBookAgeMs !== Number.POSITIVE_INFINITY &&
        (!Number.isSafeInteger(this.maximumOrderBookAgeMs) ||
          this.maximumOrderBookAgeMs <= 0)) ||
      !Number.isSafeInteger(this.maximumFutureSkewMs) ||
      this.maximumFutureSkewMs < 0
    ) {
      throw new Error('Invalid market-engine freshness configuration');
    }
  }

  public processOrderBookUpdate(
    update: OKXOrderBookUpdate,
    messagePerformance?: MessagePerformanceContext,
  ): void {
    const startedAt = performance.now();
    const trace = new PerformanceTrace(
      this.pipelineProfiler,
      performanceConfig.attributionEnabled && this.pipelineProfiler.isEnabled(),
      messagePerformance,
    );

    try {
      const state = this.marketStates.get(update.instId);

      if (!state) {
        return;
      }

      const wasApplied = trace.measure('orderBook.applyUpdate', () =>
        state.orderBookManager.applyUpdate(
          update.bids,
          update.asks,
          update.timestamp,
          update.seqId,
          update.prevSeqId,
          update.action,
        ),
      );

      if (!wasApplied) {
        this.suspendOrderBookDerivedState(update.instId, state);

        if (!this.sequenceGapSymbols.has(update.instId)) {
          this.sequenceGapSymbols.add(update.instId);
          state.orderBookManager.markResyncing();
          this.reporter.reportSequenceGap(update.instId);

          try {
            this.onSequenceGap?.(update.instId);
          } catch (error: unknown) {
            console.error(
              `Failed to request order-book resync for ${update.instId}:`,
              error,
            );
          }
        }

        return;
      }

      if (update.action === 'snapshot') {
        const recovered = this.sequenceGapSymbols.delete(update.instId);
        if (recovered) {
          this.reporter.reportSequenceRecovery(update.instId);
        }
      }

      const orderBook = state.orderBookManager.getOrderBook();
      trace.updateDiagnostics({
        bidDepth: orderBook.bids.size,
        askDepth: orderBook.asks.size,
        depthPruned: state.orderBookManager.didLastUpdatePruneDepth(),
        externalSignalStoreSize: this.correlationService?.getStoredSize(),
      });

      if (!orderBook.initialized || orderBook.status !== 'SYNCED') {
        return;
      }

      const now = this.clock();
      const bookAgeMs = now - update.timestamp;

      if (
        !Number.isSafeInteger(now) ||
        now < 0 ||
        bookAgeMs >= this.maximumOrderBookAgeMs ||
        bookAgeMs < -this.maximumFutureSkewMs
      ) {
        this.suspendOrderBookDerivedState(update.instId, state);
        return;
      }

      if (!state.orderBookManager.isUsableForSignals()) {
        this.suspendOrderBookDerivedState(update.instId, state);
        return;
      }

      this.suspendedSymbols.delete(update.instId);

      const result = trace.measure('whaleTracker.scan', () =>
        state.whaleTracker.scan(orderBook),
      );
      const currentPrice = state.orderBookManager.getMidPrice();

      if (currentPrice === undefined) {
        return;
      }

      const scoredWhales = trace.measure('whaleScore.scoreAndPrune', () => {
        const scored = state.whaleScoreEngine.scoreMany(
          result.active,
          currentPrice,
        );
        state.whaleScoreEngine.prune(result.active);
        return scored;
      });

      trace.measure('behavior.analyzeAndPrune', () => {
        for (const whale of result.active) {
          const currentBehaviors = state.whaleBehaviorEngine.analyze(whale);
          const enteredBehaviors =
            state.behaviorTransitionTracker.getEnteredBehaviors(
              whale,
              currentBehaviors,
            );

          for (const behavior of enteredBehaviors) {
            this.reporter.reportBehavior(behavior);
          }
        }

        state.whaleBehaviorEngine.prune(result.active);
        state.behaviorTransitionTracker.prune(result.active);
      });

      const walls = trace.measure('wallDetector.detect', () =>
        state.wallDetector.detect(orderBook),
      );
      trace.updateDiagnostics({
        activeWhales: result.active.length,
        activeWalls: walls.length,
      });

      trace.measure('whaleEvents.detectAndReport', () => {
        const whaleEvents = state.whaleEventDetector.detect(result.active);
        const bidDepthNotional = sumNotional(orderBook.bids.values());
        const askDepthNotional = sumNotional(orderBook.asks.values());

        for (const event of whaleEvents) {
          if (event.type === 'REMOVED') {
            const assessment = state.tradeFlowTracker.assessRemoval(
              event.whale,
              event.whale.side === 'BID' ? bidDepthNotional : askDepthNotional,
              this.clock(),
            );
            const behavior = state.whaleBehaviorEngine.analyzeRemoval(
              event.whale,
              assessment,
            );

            if (behavior) {
              if (behavior.type === 'SPOOF') {
                this.reporter.reportSpoof(update.instId, behavior);
              } else {
                this.reporter.reportBehavior(behavior);
              }
            }
          }

          this.reporter.reportWhaleEvent(update.instId, event);
        }
      });

      trace.measure('refill.detectAndPrune', () => {
        for (const whale of result.active) {
          const refill = state.whaleRefillDetector.detect(whale);

          if (refill) {
            this.reporter.reportRefill(update.instId, refill);
          }
        }

        state.whaleRefillDetector.prune(result.active);
      });

      for (const moved of result.movedWhales) {
        this.reporter.reportMovedWhale(update.instId, moved);
      }

      if (!this.summaryThrottle.shouldDisplay(update.instId)) {
        return;
      }

      trace.updateDiagnostics({ summaryProcessed: true });
      trace.measure('summary.analyzeAndReport', () => {
        const bestBid = state.orderBookManager.getBestBid();
        const bestAsk = state.orderBookManager.getBestAsk();
        const marketSignal = trace.measure('summary.marketAnalysis', () =>
          state.marketAnalyzer.analyze(result.active, currentPrice),
        );
        const correlationNow = this.clock();
        const evaluation = this.correlationService?.correlateMarketSignal(
          update.instId,
          marketSignal,
          correlationNow,
          trace,
        );

        if (evaluation) {
          this.lastEvaluations.set(update.instId, evaluation);
        }

        this.reporter.reportSummary(
          {
            symbol: update.instId,
            currentPrice,
            bestBidPrice: bestBid?.price,
            bestAskPrice: bestAsk?.price,
            aggregates: prepareMarketSummaryAggregates(result, walls),
            scoredWhales,
            marketSignal,
            evaluation,
          },
          trace,
        );

        if (evaluation) {
          const alert = trace.measure('alert.evaluation', () =>
            this.correlatedAlertEngine?.evaluate(evaluation, correlationNow),
          );

          if (alert && evaluation.correlatedSignal) {
            const evaluationContext = createCorrelatedAlertEvaluationContext({
              instrument: state.instrument,
              correlatedSignal: evaluation.correlatedSignal,
              sourceMarketTimestamp: update.timestamp,
              referenceTimestamp: update.timestamp,
              referenceMidpoint: currentPrice,
              referenceBestBid: bestBid?.price,
              referenceBestAsk: bestAsk?.price,
            });

            trace.updateDiagnostics({ alertEmitted: true });
            this.correlatedAlertReporter.report(alert, trace);

            if (evaluationContext) {
              try {
                const recordResult = this.correlatedAlertRecorder?.record(
                  alert,
                  {
                    provenance: this.alertProvenance,
                    evaluationContext,
                  },
                  trace,
                );
                if (
                  recordResult?.persisted &&
                  this.alphaMarketContextObserver
                ) {
                  const marketContext = this.captureAlphaMarketContext(
                    state,
                    result,
                    orderBook,
                    alert,
                  );
                  if (marketContext) {
                    this.alphaMarketContextObserver({
                      alert,
                      evaluationContext,
                      marketContext,
                    });
                  }
                }
              } catch (error: unknown) {
                console.error(
                  `Correlated alert recording failed for ${update.instId}:`,
                  error,
                );
              }
            }
          }
        }
      });
    } finally {
      this.processingMonitor.record(
        update.instId,
        performance.now() - startedAt,
        Date.now(),
        trace,
      );
    }
  }

  public getPipelineProfile() {
    return this.pipelineProfiler.getSnapshot();
  }

  public getLastEvaluation(symbol: string): MarketEvaluation | undefined {
    return this.lastEvaluations.get(symbol);
  }

  public reset(): void {
    this.sequenceGapSymbols.clear();
    this.suspendedSymbols.clear();
    this.summaryThrottle.reset();
    this.processingMonitor.reset();
    this.pipelineProfiler.reset();
    this.lastEvaluations.clear();
    this.correlatedAlertEngine?.clear();
  }

  public resetSymbols(symbols: readonly string[]): void {
    for (const symbol of symbols) {
      this.sequenceGapSymbols.delete(symbol);
      this.suspendedSymbols.delete(symbol);
      this.summaryThrottle.reset(symbol);
      const state = this.marketStates.get(symbol);
      state?.tradeFlowTracker.reset();
      state?.resetOrderBookDerivedState();
    }

    this.processingMonitor.resetSymbols(symbols);

    for (const symbol of symbols) {
      this.lastEvaluations.delete(symbol);
      this.correlatedAlertEngine?.resetSymbol(symbol);
    }
  }

  private suspendOrderBookDerivedState(
    symbol: string,
    state: MarketState,
  ): void {
    if (this.suspendedSymbols.has(symbol)) {
      return;
    }

    this.suspendedSymbols.add(symbol);
    state.resetOrderBookDerivedState();
    this.summaryThrottle.reset(symbol);
    this.lastEvaluations.delete(symbol);
    this.correlatedAlertEngine?.resetSymbol(symbol);
  }

  private captureAlphaMarketContext(
    state: MarketState,
    whaleScan: WhaleScanResult,
    orderBook: ReturnType<MarketState['orderBookManager']['getOrderBook']>,
    alert: VersionedCorrelatedAlert,
  ): AlphaMarketContextSnapshot | undefined {
    if (orderBook.updatedAt > alert.createdAt) return undefined;
    const requiredSide = alert.bias === 'BULLISH' ? 'BID' : 'ASK';
    const whale = whaleScan.active
      .filter((candidate) => candidate.side === requiredSide)
      .sort(
        (left, right) =>
          right.notionalQuote - left.notionalQuote ||
          left.wallId.localeCompare(right.wallId),
      )[0];
    if (!whale) return undefined;
    const executionEvidence = state.tradeFlowTracker.measureWhaleExecution(
      whale,
      alert.createdAt,
    );
    const candles = state.candleHistory
      .getAll()
      .filter(
        (candle) =>
          candle.confirm && candle.timestamp + 60_000 <= alert.createdAt,
      )
      .map((candle) =>
        Object.freeze({
          intervalStart: candle.timestamp,
          intervalEnd: candle.timestamp + 60_000,
          availabilityTimestamp: alert.createdAt,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volumeCurrencyQuote,
        }),
      );
    return Object.freeze({
      instrumentId: alert.symbol,
      detectedAt: alert.createdAt,
      candles: Object.freeze(candles),
      orderBook: Object.freeze({
        eventTimestamp: orderBook.updatedAt,
        availabilityTimestamp: alert.createdAt,
        bids: Object.freeze(
          [...orderBook.bids.values()]
            .sort((left, right) => right.price - left.price)
            .map((level) =>
              Object.freeze({ price: level.price, size: level.size }),
            ),
        ),
        asks: Object.freeze(
          [...orderBook.asks.values()]
            .sort((left, right) => left.price - right.price)
            .map((level) =>
              Object.freeze({ price: level.price, size: level.size }),
            ),
        ),
      }),
      trades: state.tradeFlowTracker.getResearchTrades(alert.createdAt),
      whale: Object.freeze({
        availabilityTimestamp: alert.createdAt,
        wallPersistenceMs:
          whale.ageSeconds === undefined ? null : whale.ageSeconds * 1_000,
        refillCount: state.whaleRefillDetector.getRefillCount(whale),
        spoofProbability: null,
        absorptionScore: null,
        executionRatio: Math.min(
          1,
          Math.max(0, executionEvidence.executedRatio),
        ),
        whaleNotionalQuote: whale.notionalQuote,
      }),
    });
  }
}
