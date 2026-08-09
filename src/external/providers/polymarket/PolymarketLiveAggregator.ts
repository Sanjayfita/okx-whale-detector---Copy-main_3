import type { ExternalSignalDirection } from '../../types/ExternalWhaleSignal';

export interface PolymarketLiveExecution {
  id: string;
  marketConditionId: string;
  occurredAt: number;
  direction: ExternalSignalDirection;
  notionalUsd: number;
}

export interface PolymarketLiveAggregation {
  marketConditionId: string;
  windowStartedAt: number;
  windowEndedAt: number;
  executionCount: number;
  bullishNotionalUsd: number;
  bearishNotionalUsd: number;
  netDirectionalNotionalUsd: number;
  dominance: number;
  direction: ExternalSignalDirection;
  qualifies: boolean;
}

export interface PolymarketLiveAggregatorConfig {
  windowMs: number;
  minimumNetNotionalUsd: number;
  minimumDominance: number;
  maximumExecutionsPerMarket: number;
}

const DEFAULT_CONFIG: PolymarketLiveAggregatorConfig = {
  windowMs: 60_000,
  minimumNetNotionalUsd: 5_000,
  minimumDominance: 0.15,
  maximumExecutionsPerMarket: 10_000,
};

export class PolymarketLiveAggregator {
  private readonly config: PolymarketLiveAggregatorConfig;
  private readonly executionsByMarket = new Map<
    string,
    PolymarketLiveExecution[]
  >();
  private readonly seenExecutionIds = new Set<string>();

  public constructor(config: Partial<PolymarketLiveAggregatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.windowMs <= 0) {
      throw new Error('windowMs must be greater than zero');
    }
    if (this.config.minimumNetNotionalUsd <= 0) {
      throw new Error('minimumNetNotionalUsd must be greater than zero');
    }
    if (this.config.minimumDominance < 0 || this.config.minimumDominance > 1) {
      throw new Error('minimumDominance must be between 0 and 1');
    }
  }

  public add(
    execution: PolymarketLiveExecution,
    now = execution.occurredAt,
  ): PolymarketLiveAggregation {
    if (execution.notionalUsd < 0 || !Number.isFinite(execution.notionalUsd)) {
      throw new Error(
        'execution notionalUsd must be a finite non-negative number',
      );
    }

    this.pruneMarket(execution.marketConditionId, now);

    if (
      execution.direction !== 'UNKNOWN' &&
      execution.direction !== 'NEUTRAL' &&
      !this.seenExecutionIds.has(execution.id)
    ) {
      const marketExecutions =
        this.executionsByMarket.get(execution.marketConditionId) ?? [];
      marketExecutions.push(execution);

      if (marketExecutions.length > this.config.maximumExecutionsPerMarket) {
        const removed = marketExecutions.splice(
          0,
          marketExecutions.length - this.config.maximumExecutionsPerMarket,
        );
        for (const item of removed) this.seenExecutionIds.delete(item.id);
      }

      this.executionsByMarket.set(
        execution.marketConditionId,
        marketExecutions,
      );
      this.seenExecutionIds.add(execution.id);
    }

    return this.get(execution.marketConditionId, now);
  }

  public get(
    marketConditionId: string,
    now = Date.now(),
  ): PolymarketLiveAggregation {
    this.pruneMarket(marketConditionId, now);
    const executions = this.executionsByMarket.get(marketConditionId) ?? [];

    let bullishNotionalUsd = 0;
    let bearishNotionalUsd = 0;

    for (const execution of executions) {
      if (execution.direction === 'BULLISH') {
        bullishNotionalUsd += execution.notionalUsd;
      } else if (execution.direction === 'BEARISH') {
        bearishNotionalUsd += execution.notionalUsd;
      }
    }

    const totalDirectionalNotionalUsd = bullishNotionalUsd + bearishNotionalUsd;
    const netDirectionalNotionalUsd = bullishNotionalUsd - bearishNotionalUsd;
    const dominance =
      totalDirectionalNotionalUsd === 0
        ? 0
        : Math.abs(netDirectionalNotionalUsd) / totalDirectionalNotionalUsd;
    const direction: ExternalSignalDirection =
      netDirectionalNotionalUsd > 0
        ? 'BULLISH'
        : netDirectionalNotionalUsd < 0
          ? 'BEARISH'
          : 'NEUTRAL';

    return {
      marketConditionId,
      windowStartedAt: now - this.config.windowMs,
      windowEndedAt: now,
      executionCount: executions.length,
      bullishNotionalUsd,
      bearishNotionalUsd,
      netDirectionalNotionalUsd,
      dominance,
      direction,
      qualifies:
        Math.abs(netDirectionalNotionalUsd) >=
          this.config.minimumNetNotionalUsd &&
        dominance >= this.config.minimumDominance,
    };
  }

  public getActive(now = Date.now()): PolymarketLiveAggregation[] {
    const marketConditionIds = [...this.executionsByMarket.keys()];

    return marketConditionIds
      .map((marketConditionId) => this.get(marketConditionId, now))
      .filter((aggregation) => aggregation.executionCount > 0);
  }

  public clear(): void {
    this.executionsByMarket.clear();
    this.seenExecutionIds.clear();
  }

  private pruneMarket(marketConditionId: string, now: number): void {
    const executions = this.executionsByMarket.get(marketConditionId);
    if (!executions) return;

    const cutoff = now - this.config.windowMs;
    const retained = executions.filter(
      (execution) => execution.occurredAt >= cutoff,
    );

    for (const execution of executions) {
      if (execution.occurredAt < cutoff) {
        this.seenExecutionIds.delete(execution.id);
      }
    }

    if (retained.length === 0) {
      this.executionsByMarket.delete(marketConditionId);
    } else {
      this.executionsByMarket.set(marketConditionId, retained);
    }
  }
}
