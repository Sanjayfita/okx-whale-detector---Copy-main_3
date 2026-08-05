import {
  simulateMarketOrder,
  type ExecutionOrderBook,
  type ExecutionSimulationPolicy,
  type MarketFillResult,
} from '../backtest/ExecutionSimulator';

export interface ShadowSignal {
  readonly signalId: string;
  readonly strategyId: string;
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly direction: 'LONG' | 'SHORT';
  readonly requestedContracts: number;
  readonly explanationFingerprint: string;
}

export interface PaperExecutionReference {
  readonly signalId: string;
  readonly status: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED';
  readonly filledContracts: number;
  readonly averagePrice: number | null;
  readonly slippageBps: number | null;
}

export interface ShadowOutcomeObservation {
  readonly observedAt: number;
  readonly markPrice: number;
  readonly returnBps: number;
}

export interface ShadowTradeRecord {
  readonly signal: ShadowSignal;
  readonly processedAt: number;
  readonly bookObservedAt: number;
  readonly referencePrice: number | null;
  readonly fill: MarketFillResult;
  readonly paperReference: PaperExecutionReference | null;
  readonly shadowVsPaperPriceBps: number | null;
  readonly outcomes: readonly ShadowOutcomeObservation[];
  readonly liveOrderSubmitted: false;
}

export interface ShadowTradingPolicy {
  readonly maximumBookAgeMs: number;
  readonly missedOpportunityThresholdBps: number;
  readonly execution: ExecutionSimulationPolicy;
}

export const DEFAULT_SHADOW_TRADING_POLICY: ShadowTradingPolicy = {
  maximumBookAgeMs: 1_000,
  missedOpportunityThresholdBps: 10,
  execution: {
    takerFeeBps: 5,
    maxLevelParticipationRate: 0.25,
    latencyMs: 150,
    adverseLatencyBpsPerSecond: 1,
    minimumFillRatio: 0.95,
  },
};

export interface ShadowDailyReport {
  readonly dayStart: number;
  readonly dayEnd: number;
  readonly signalCount: number;
  readonly filledCount: number;
  readonly partialFillCount: number;
  readonly rejectedCount: number;
  readonly completedOutcomeCount: number;
  readonly missedOpportunityCount: number;
  readonly averageFillRatio: number;
  readonly averageShadowSlippageBps: number | null;
  readonly averageShadowVsPaperPriceBps: number | null;
  readonly averageObservedReturnBps: number | null;
  readonly liveOrderSubmitted: false;
  readonly liveExecutionAllowed: false;
}

const averageOrNull = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const midpoint = (book: ExecutionOrderBook): number | null => {
  const bestBid = book.bids
    .filter((level) => Number.isFinite(level.price) && level.price > 0)
    .sort((left, right) => right.price - left.price)[0]?.price;
  const bestAsk = book.asks
    .filter((level) => Number.isFinite(level.price) && level.price > 0)
    .sort((left, right) => left.price - right.price)[0]?.price;
  return bestBid === undefined || bestAsk === undefined || bestAsk <= bestBid
    ? null
    : (bestBid + bestAsk) / 2;
};

export class ShadowTradingEngine {
  private readonly records = new Map<string, ShadowTradeRecord>();

  public constructor(
    private readonly policy: ShadowTradingPolicy = DEFAULT_SHADOW_TRADING_POLICY,
  ) {}

  public processSignal(input: {
    readonly signal: ShadowSignal;
    readonly book: ExecutionOrderBook;
    readonly processedAt: number;
    readonly paperReference?: PaperExecutionReference | null;
  }): ShadowTradeRecord {
    if (
      input.signal.signalId.trim().length === 0 ||
      input.signal.strategyId.trim().length === 0 ||
      input.signal.instrumentId.trim().length === 0 ||
      input.signal.explanationFingerprint.trim().length === 0
    ) {
      throw new Error('shadow signal identifiers must not be empty');
    }
    if (this.records.has(input.signal.signalId)) {
      throw new Error(`duplicate shadow signal ${input.signal.signalId}`);
    }
    if (
      !Number.isSafeInteger(input.signal.observedAt) ||
      !Number.isSafeInteger(input.processedAt) ||
      !Number.isSafeInteger(input.book.observedAt) ||
      input.signal.observedAt < 0 ||
      input.processedAt < input.signal.observedAt
    ) {
      throw new Error('invalid shadow signal timestamps');
    }
    if (
      input.processedAt - input.book.observedAt > this.policy.maximumBookAgeMs ||
      input.book.observedAt > input.processedAt
    ) {
      throw new Error('shadow order book is stale or from the future');
    }
    if (
      input.paperReference !== undefined &&
      input.paperReference !== null &&
      input.paperReference.signalId !== input.signal.signalId
    ) {
      throw new Error('paper reference signalId mismatch');
    }

    const fill = simulateMarketOrder({
      side: input.signal.direction === 'LONG' ? 'BUY' : 'SELL',
      quantity: input.signal.requestedContracts,
      book: input.book,
      policy: this.policy.execution,
    });
    const paperReference = input.paperReference ?? null;
    const shadowVsPaperPriceBps =
      fill.averagePrice === null || paperReference?.averagePrice === null ||
      paperReference?.averagePrice === undefined
        ? null
        : ((fill.averagePrice - paperReference.averagePrice) /
            paperReference.averagePrice) *
          10_000 *
          (input.signal.direction === 'LONG' ? 1 : -1);
    const record: ShadowTradeRecord = {
      signal: input.signal,
      processedAt: input.processedAt,
      bookObservedAt: input.book.observedAt,
      referencePrice: fill.averagePrice ?? midpoint(input.book),
      fill,
      paperReference,
      shadowVsPaperPriceBps,
      outcomes: [],
      liveOrderSubmitted: false,
    };
    this.records.set(input.signal.signalId, record);
    return record;
  }

  public observeOutcome(input: {
    readonly signalId: string;
    readonly observedAt: number;
    readonly markPrice: number;
  }): ShadowTradeRecord {
    const record = this.records.get(input.signalId);
    if (record === undefined) {
      throw new Error(`unknown shadow signal ${input.signalId}`);
    }
    if (
      !Number.isSafeInteger(input.observedAt) ||
      input.observedAt < record.processedAt ||
      !Number.isFinite(input.markPrice) ||
      input.markPrice <= 0 ||
      record.referencePrice === null
    ) {
      throw new Error('invalid shadow outcome observation');
    }
    const returnBps =
      ((input.markPrice - record.referencePrice) / record.referencePrice) *
      10_000 *
      (record.signal.direction === 'LONG' ? 1 : -1);
    const updated: ShadowTradeRecord = {
      ...record,
      outcomes: [
        ...record.outcomes,
        { observedAt: input.observedAt, markPrice: input.markPrice, returnBps },
      ].sort((left, right) => left.observedAt - right.observedAt),
    };
    this.records.set(input.signalId, updated);
    return updated;
  }

  public getRecord(signalId: string): ShadowTradeRecord | null {
    return this.records.get(signalId) ?? null;
  }

  public generateDailyReport(input: {
    readonly dayStart: number;
    readonly dayEnd: number;
  }): ShadowDailyReport {
    if (
      !Number.isSafeInteger(input.dayStart) ||
      !Number.isSafeInteger(input.dayEnd) ||
      input.dayStart < 0 ||
      input.dayEnd <= input.dayStart
    ) {
      throw new Error('invalid shadow report range');
    }
    const records = [...this.records.values()].filter(
      (record) =>
        record.processedAt >= input.dayStart && record.processedAt < input.dayEnd,
    );
    const completedOutcomes = records.flatMap((record) => record.outcomes.at(-1) ?? []);
    const missedOpportunityCount = records.filter((record) => {
      if (record.fill.status !== 'REJECTED') {
        return false;
      }
      const outcome = record.outcomes.at(-1);
      return (
        outcome !== undefined &&
        outcome.returnBps >= this.policy.missedOpportunityThresholdBps
      );
    }).length;
    return {
      dayStart: input.dayStart,
      dayEnd: input.dayEnd,
      signalCount: records.length,
      filledCount: records.filter((record) => record.fill.status === 'FILLED').length,
      partialFillCount: records.filter(
        (record) => record.fill.status === 'PARTIALLY_FILLED',
      ).length,
      rejectedCount: records.filter((record) => record.fill.status === 'REJECTED').length,
      completedOutcomeCount: completedOutcomes.length,
      missedOpportunityCount,
      averageFillRatio:
        records.length === 0
          ? 0
          : records.reduce((sum, record) => sum + record.fill.fillRatio, 0) /
            records.length,
      averageShadowSlippageBps: averageOrNull(
        records.flatMap((record) =>
          record.fill.slippageBps === null ? [] : [record.fill.slippageBps],
        ),
      ),
      averageShadowVsPaperPriceBps: averageOrNull(
        records.flatMap((record) =>
          record.shadowVsPaperPriceBps === null
            ? []
            : [record.shadowVsPaperPriceBps],
        ),
      ),
      averageObservedReturnBps: averageOrNull(
        completedOutcomes.map((outcome) => outcome.returnBps),
      ),
      liveOrderSubmitted: false,
      liveExecutionAllowed: false,
    };
  }
}
