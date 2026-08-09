import {
  ExternalSignalCorrelationEngine,
  type ExternalSignalCorrelationConfig,
} from './ExternalSignalCorrelationEngine';
import { ExternalSignalRelevanceEngine } from './ExternalSignalRelevanceEngine';
import { ExternalSignalStore } from './ExternalSignalStore';
import type {
  EffectiveExternalSignal,
  ExternalWhaleSignal,
} from '../types/ExternalWhaleSignal';
import type { MarketSignal } from '../../types/signal';
import type { MarketEvaluation } from '../../types/marketEvaluation';
import type { PerformanceRecorder } from '../../core/PipelineProfiler';

export interface ExternalSignalCorrelationServiceConfig {
  maximumSignals?: number;
  retentionMs?: number;
  categoryMaximumAgeMs?: Record<string, number>;
  correlation?: Partial<ExternalSignalCorrelationConfig>;
}

export class ExternalSignalCorrelationService {
  private readonly store: ExternalSignalStore;
  private readonly relevanceEngine: ExternalSignalRelevanceEngine;
  private readonly correlationEngine: ExternalSignalCorrelationEngine;

  public constructor(config: ExternalSignalCorrelationServiceConfig = {}) {
    this.store = new ExternalSignalStore({
      maximumSignals: config.maximumSignals ?? 10_000,
      retentionMs: config.retentionMs ?? 24 * 60 * 60 * 1_000,
    });
    this.relevanceEngine = new ExternalSignalRelevanceEngine({
      categoryMaximumAgeMs: config.categoryMaximumAgeMs as Record<
        string,
        number
      >,
    });
    this.correlationEngine = new ExternalSignalCorrelationEngine(
      config.correlation,
    );
  }

  public addSignal(
    signal: ExternalWhaleSignal,
    now = Date.now(),
  ): ExternalWhaleSignal {
    return this.store.add(signal, now).signal;
  }

  public getFreshRelevantSignals(
    marketSymbol: string,
    now = Date.now(),
  ): EffectiveExternalSignal[] {
    return this.store
      .getAll(now)
      .map((signal) =>
        this.relevanceEngine.evaluate(signal, marketSymbol, now),
      );
  }

  public correlateMarketSignal(
    marketSymbol: string,
    marketSignal: MarketSignal,
    now = Date.now(),
    performanceRecorder?: PerformanceRecorder,
  ): MarketEvaluation {
    const retrieve = (): EffectiveExternalSignal[] =>
      this.getFreshRelevantSignals(marketSymbol, now);
    const effectiveSignals = performanceRecorder
      ? performanceRecorder.measure(
          'summary.externalSignals.retrieveRelevance',
          retrieve,
        )
      : retrieve();
    const correlate = (): MarketEvaluation =>
      this.correlateEffectiveSignals(
        marketSymbol,
        marketSignal,
        effectiveSignals,
        now,
      );

    return performanceRecorder
      ? performanceRecorder.measure('summary.correlation', correlate)
      : correlate();
  }

  public correlateEffectiveSignals(
    marketSymbol: string,
    marketSignal: MarketSignal,
    effectiveSignals: readonly EffectiveExternalSignal[],
    now = Date.now(),
  ): MarketEvaluation {
    const correlatedSignal = this.correlationEngine.correlate(
      marketSymbol,
      marketSignal,
      effectiveSignals,
      now,
    );

    return {
      marketSignal,
      correlatedSignal,
    };
  }

  public getSize(now = Date.now()): number {
    return this.store.getSize(now);
  }

  public getStoredSize(): number {
    return this.store.getStoredSize();
  }

  public clear(): void {
    this.store.clear();
  }
}
