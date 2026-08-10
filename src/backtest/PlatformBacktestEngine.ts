import {
  calculatePerformanceAnalytics,
  type EquityPoint,
  type PerformanceAnalyticsReport,
} from '../analytics/PerformanceAnalytics';
import type { TradingStrategyConfig } from '../config/tradingStrategyConfig';
import {
  calculateBacktestStatistics,
  type BacktestStatistics,
} from './BacktestStatistics';
import {
  normalizeBacktestQuantity,
  quantizeBacktestFillPrice,
  validateBacktestInstrumentSpecification,
  type BacktestInstrumentSpecification,
} from './BacktestInstrumentSpecification';
import {
  createPurgedWalkForwardPlan,
  type PurgedWalkForwardPlan,
  type PurgedWalkForwardPolicy,
  type WalkForwardObservation,
} from '../research/PurgedWalkForward';
import {
  runExecutionMonteCarlo,
  type ExecutionMonteCarloPolicy,
  type ExecutionMonteCarloReport,
  type MonteCarloTrade,
} from '../research/ExecutionMonteCarloValidation';
import type {
  EmaTrendCandle,
  EmaTrendOpenPosition,
} from '../strategy/EmaTrendStrategy';
import { EmaTrendTradingStrategy } from '../strategies/emaTrend/EmaTrendTradingStrategy';
import type { TradingStrategy } from '../strategies/TradingStrategy';

export type HistoricalBacktestCandle = EmaTrendCandle;

export interface PlatformBacktestFundingEvent {
  readonly eventId: string;
  readonly timestamp: number;
  readonly fundingRatePercent: number;
  /** Point-in-time mark used by the venue for this settlement. */
  readonly markPrice: number;
}

export interface PlatformBacktestPolicy {
  readonly initialEquity: number;
  readonly leverage: number;
  readonly feeBps: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
}

export const DEFAULT_PLATFORM_BACKTEST_POLICY: PlatformBacktestPolicy =
  Object.freeze({
    initialEquity: 10_000,
    leverage: 2,
    feeBps: 5,
    spreadBps: 2,
    slippageBps: 1,
  });

export interface PlatformBacktestTrade {
  readonly tradeId: string;
  readonly episodeId: string;
  readonly instrumentId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly decidedAt: number;
  readonly openedAt: number;
  readonly closedAt: number;
  readonly entryReferencePrice: number;
  readonly exitReferencePrice: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly requestedQuantityBaseUnits: number;
  readonly quantityBaseUnits: number;
  readonly entryReason: string;
  readonly exitReason: string;
  readonly grossPnl: number;
  readonly feeCost: number;
  readonly fundingPnl: number;
  readonly slippageCost: number;
  readonly netPnl: number;
  readonly riskAmount: number;
  readonly rMultiple: number;
  readonly durationMs: number;
  readonly entryLatencyMs: number;
}

export interface PlatformBacktestTradeRejection {
  readonly decidedAt: number;
  readonly executionAt: number | null;
  readonly reason:
    | 'NO_FUTURE_MARKET_EVENT'
    | 'LEVERAGE_LIMIT'
    | 'BELOW_MINIMUM_ORDER_SIZE'
    | 'BELOW_MINIMUM_ORDER_VALUE';
  readonly requestedQuantityBaseUnits: number;
  readonly normalizedQuantityBaseUnits: number;
}

export interface BuyAndHoldBenchmark {
  readonly entryPrice: number | null;
  readonly exitPrice: number | null;
  readonly returnPercent: number;
}

export interface PlatformBacktestReport {
  readonly schemaVersion: 2;
  readonly executionModel: 'NEXT_CONFIRMED_CANDLE_OPEN';
  readonly inputFingerprint: string | null;
  readonly strategyId: string;
  readonly instrumentId: string;
  readonly instrumentSpecification: BacktestInstrumentSpecification;
  readonly candleCount: number;
  readonly fundingEventCount: number;
  readonly appliedFundingEventCount: number;
  readonly trades: readonly PlatformBacktestTrade[];
  readonly tradeRejections: readonly PlatformBacktestTradeRejection[];
  readonly equityCurve: readonly EquityPoint[];
  readonly analytics: PerformanceAnalyticsReport;
  readonly statistics: BacktestStatistics;
  readonly buyAndHold: BuyAndHoldBenchmark;
  readonly endingEquity: number;
  readonly netReturnPercent: number;
  readonly liveExecutionAllowed: false;
}

export interface ParameterCandidateResult {
  readonly candidateId: string;
  readonly config: TradingStrategyConfig;
  readonly report: PlatformBacktestReport;
}

interface OpenBacktestPosition {
  readonly direction: 'LONG' | 'SHORT';
  readonly decidedAt: number;
  readonly openedAt: number;
  readonly entryReferencePrice: number;
  readonly entryPrice: number;
  readonly requestedQuantityBaseUnits: number;
  readonly quantityBaseUnits: number;
  readonly stopLossPrice: number;
  readonly takeProfitPrice: number;
  readonly riskAmount: number;
  readonly entryReason: string;
  readonly entryFee: number;
  readonly entrySlippageCost: number;
  readonly fundingPnl: number;
  readonly trailingStopPrice: number | null;
}

interface PendingBacktestEntry {
  readonly direction: 'LONG' | 'SHORT';
  readonly decidedAt: number;
  readonly strategyEntryPrice: number;
  readonly strategyStopLossPrice: number;
  readonly strategyTakeProfitPrice: number;
  readonly quantityBaseUnits: number;
  readonly entryReason: string;
}

interface PendingBacktestExit {
  readonly decidedAt: number;
  readonly reason: string;
}

const requireFiniteNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
};

const validatePolicy = (policy: PlatformBacktestPolicy): void => {
  if (!Number.isFinite(policy.initialEquity) || policy.initialEquity <= 0) {
    throw new Error('initialEquity must be positive and finite');
  }
  if (!Number.isFinite(policy.leverage) || policy.leverage <= 0) {
    throw new Error('leverage must be positive and finite');
  }
  requireFiniteNonNegative(policy.feeBps, 'feeBps');
  requireFiniteNonNegative(policy.spreadBps, 'spreadBps');
  requireFiniteNonNegative(policy.slippageBps, 'slippageBps');
};

const executionCostBps = (policy: PlatformBacktestPolicy): number =>
  policy.spreadBps / 2 + policy.slippageBps;

const adversePrice = (input: {
  readonly referencePrice: number;
  readonly side: 'BUY' | 'SELL';
  readonly policy: PlatformBacktestPolicy;
}): number =>
  input.referencePrice *
  (1 +
    (input.side === 'BUY' ? 1 : -1) *
      (executionCostBps(input.policy) / 10_000));

const movementPnl = (input: {
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
}): number =>
  (input.direction === 'LONG'
    ? input.exitPrice - input.entryPrice
    : input.entryPrice - input.exitPrice) * input.quantity;

const episodeId = (instrumentId: string, timestamp: number): string =>
  `${instrumentId}:${new Date(timestamp).toISOString().slice(0, 10)}`;

const toOpenPosition = (
  position: OpenBacktestPosition,
): EmaTrendOpenPosition => ({
  direction: position.direction,
  openedAt: position.openedAt,
  entryPrice: position.entryPrice,
  stopLossPrice: position.stopLossPrice,
  takeProfitPrice: position.takeProfitPrice,
});

const csvEscape = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const closeTrade = (input: {
  readonly instrumentId: string;
  readonly position: OpenBacktestPosition;
  readonly candle: HistoricalBacktestCandle;
  readonly referencePrice: number;
  readonly reason: string;
  readonly policy: PlatformBacktestPolicy;
  readonly instrumentSpecification: BacktestInstrumentSpecification;
}): PlatformBacktestTrade => {
  const closingSide = input.position.direction === 'LONG' ? 'SELL' : 'BUY';
  const exitPrice = quantizeBacktestFillPrice(
    adversePrice({
      referencePrice: input.referencePrice,
      side: closingSide,
      policy: input.policy,
    }),
    input.instrumentSpecification.tickSize,
    closingSide,
  );
  const grossPnl = movementPnl({
    direction: input.position.direction,
    entryPrice: input.position.entryReferencePrice,
    exitPrice: input.referencePrice,
    quantity: input.position.quantityBaseUnits,
  });
  const exitFee =
    exitPrice *
    input.position.quantityBaseUnits *
    (input.policy.feeBps / 10_000);
  const exitSlippageCost =
    Math.abs(exitPrice - input.referencePrice) *
    input.position.quantityBaseUnits;
  const feeCost = input.position.entryFee + exitFee;
  const slippageCost = input.position.entrySlippageCost + exitSlippageCost;
  const netPnl = grossPnl - feeCost - slippageCost + input.position.fundingPnl;

  return {
    tradeId: `${input.instrumentId}:${input.position.openedAt}:${input.candle.timestamp}`,
    episodeId: episodeId(input.instrumentId, input.position.openedAt),
    instrumentId: input.instrumentId,
    direction: input.position.direction,
    decidedAt: input.position.decidedAt,
    openedAt: input.position.openedAt,
    closedAt: input.candle.timestamp,
    entryReferencePrice: input.position.entryReferencePrice,
    exitReferencePrice: input.referencePrice,
    entryPrice: input.position.entryPrice,
    exitPrice,
    requestedQuantityBaseUnits: input.position.requestedQuantityBaseUnits,
    quantityBaseUnits: input.position.quantityBaseUnits,
    entryReason: input.position.entryReason,
    exitReason: input.reason,
    grossPnl,
    feeCost,
    fundingPnl: input.position.fundingPnl,
    slippageCost,
    netPnl,
    riskAmount: input.position.riskAmount,
    rMultiple:
      input.position.riskAmount > 0 ? netPnl / input.position.riskAmount : 0,
    durationMs: input.candle.timestamp - input.position.openedAt,
    entryLatencyMs: input.position.openedAt - input.position.decidedAt,
  };
};

/**
 * Chronological candle backtester for the dashboard and CLI.
 * Decisions made from a confirmed candle become executable only at the next
 * candle open. Stops are evaluated before targets on ambiguous OHLC bars. A
 * trailing stop calculated from a candle becomes eligible on the next candle.
 */
export class PlatformBacktestEngine {
  public constructor(
    private readonly strategy: TradingStrategy = new EmaTrendTradingStrategy(),
    private readonly policy: PlatformBacktestPolicy = DEFAULT_PLATFORM_BACKTEST_POLICY,
  ) {
    validatePolicy(policy);
  }

  public run(input: {
    readonly instrumentId: string;
    readonly instrumentSpecification: BacktestInstrumentSpecification;
    readonly candles: readonly HistoricalBacktestCandle[];
    readonly fundingEvents?: readonly PlatformBacktestFundingEvent[];
    readonly inputFingerprint?: string;
    readonly config: TradingStrategyConfig;
  }): PlatformBacktestReport {
    if (input.instrumentId.trim().length === 0) {
      throw new Error('instrumentId must not be empty');
    }
    validateBacktestInstrumentSpecification(
      input.instrumentSpecification,
      input.instrumentId,
    );
    if (this.policy.leverage > input.instrumentSpecification.maximumLeverage) {
      throw new Error('backtest leverage exceeds the instrument maximum');
    }
    if (
      input.inputFingerprint !== undefined &&
      !/^[a-f0-9]{64}$/u.test(input.inputFingerprint)
    ) {
      throw new Error('inputFingerprint must be a lowercase SHA-256 digest');
    }
    const candles = input.candles
      .filter((candle) => candle.confirm)
      .slice()
      .sort((left, right) => left.timestamp - right.timestamp);
    const candleTimestamps = new Set<number>();
    for (const candle of candles) {
      if (
        !Number.isSafeInteger(candle.timestamp) ||
        candle.timestamp < 0 ||
        !Number.isFinite(candle.open) ||
        !Number.isFinite(candle.high) ||
        !Number.isFinite(candle.low) ||
        !Number.isFinite(candle.close) ||
        candle.open <= 0 ||
        candle.high <= 0 ||
        candle.low <= 0 ||
        candle.close <= 0 ||
        candle.high < Math.max(candle.open, candle.close) ||
        candle.low > Math.min(candle.open, candle.close) ||
        candle.high < candle.low
      ) {
        throw new Error(`invalid confirmed candle at ${candle.timestamp}`);
      }
      if (candleTimestamps.has(candle.timestamp)) {
        throw new Error(
          `duplicate confirmed candle timestamp ${candle.timestamp}`,
        );
      }
      candleTimestamps.add(candle.timestamp);
    }
    const fundingEvents = (input.fundingEvents ?? [])
      .slice()
      .sort(
        (left, right) =>
          left.timestamp - right.timestamp ||
          left.eventId.localeCompare(right.eventId),
      );
    const fundingEventIds = new Set<string>();
    for (const event of fundingEvents) {
      if (
        event.eventId.trim().length === 0 ||
        fundingEventIds.has(event.eventId)
      ) {
        throw new Error('funding event IDs must be non-empty and unique');
      }
      if (!Number.isSafeInteger(event.timestamp) || event.timestamp < 0) {
        throw new Error(`invalid funding timestamp for ${event.eventId}`);
      }
      if (!Number.isFinite(event.fundingRatePercent)) {
        throw new Error(`invalid funding rate for ${event.eventId}`);
      }
      if (!Number.isFinite(event.markPrice) || event.markPrice <= 0) {
        throw new Error(`invalid funding mark price for ${event.eventId}`);
      }
      fundingEventIds.add(event.eventId);
    }
    let realizedEquity = this.policy.initialEquity;
    let position: OpenBacktestPosition | null = null;
    let pendingEntry: PendingBacktestEntry | null = null;
    let pendingExit: PendingBacktestExit | null = null;
    let nextFundingEventIndex = 0;
    let appliedFundingEventCount = 0;
    const trades: PlatformBacktestTrade[] = [];
    const tradeRejections: PlatformBacktestTradeRejection[] = [];
    const equityCurve: EquityPoint[] = [
      { timestamp: candles[0]?.timestamp ?? 0, equity: realizedEquity },
    ];
    const history: HistoricalBacktestCandle[] = [];

    const finish = (
      currentPosition: OpenBacktestPosition,
      candle: HistoricalBacktestCandle,
      referencePrice: number,
      reason: string,
    ): void => {
      const trade = closeTrade({
        instrumentId: input.instrumentId,
        position: currentPosition,
        candle,
        referencePrice,
        reason,
        policy: this.policy,
        instrumentSpecification: input.instrumentSpecification,
      });
      trades.push(trade);
      realizedEquity += trade.netPnl;
      position = null;
    };

    const applyFundingThrough = (timestamp: number): void => {
      while (nextFundingEventIndex < fundingEvents.length) {
        const event = fundingEvents[nextFundingEventIndex];
        if (event === undefined || event.timestamp > timestamp) break;
        nextFundingEventIndex += 1;
        if (position === null) continue;

        const current: OpenBacktestPosition = position;
        const positionNotional = event.markPrice * current.quantityBaseUnits;
        const fundingPayment =
          positionNotional *
          (event.fundingRatePercent / 100) *
          (current.direction === 'LONG' ? -1 : 1);
        position = {
          ...current,
          fundingPnl: current.fundingPnl + fundingPayment,
        };
        appliedFundingEventCount += 1;
      }
    };

    for (const candle of candles) {
      // Venue settlement at a boundary applies to exposure held immediately
      // before orders triggered for the same boundary become executable.
      applyFundingThrough(candle.timestamp);

      if (pendingExit !== null && position !== null) {
        const current: OpenBacktestPosition = position;
        finish(current, candle, candle.open, pendingExit.reason);
      }
      pendingExit = null;

      if (pendingEntry !== null && position === null) {
        const openingSide = pendingEntry.direction === 'LONG' ? 'BUY' : 'SELL';
        const fillPrice = quantizeBacktestFillPrice(
          adversePrice({
            referencePrice: candle.open,
            side: openingSide,
            policy: this.policy,
          }),
          input.instrumentSpecification.tickSize,
          openingSide,
        );
        const leverageCappedQuantity = Math.min(
          pendingEntry.quantityBaseUnits,
          (realizedEquity * this.policy.leverage) / fillPrice,
        );
        const requestedNormalizedQuantity = normalizeBacktestQuantity(
          pendingEntry.quantityBaseUnits,
          input.instrumentSpecification.lotSizeBaseUnits,
        );
        const normalizedQuantity = normalizeBacktestQuantity(
          leverageCappedQuantity,
          input.instrumentSpecification.lotSizeBaseUnits,
        );
        const belowMinimumSize =
          normalizedQuantity <
          input.instrumentSpecification.minimumOrderBaseUnits;
        const belowMinimumValue =
          normalizedQuantity * fillPrice <
          input.instrumentSpecification.minimumOrderValue;

        if (belowMinimumSize || belowMinimumValue) {
          tradeRejections.push({
            decidedAt: pendingEntry.decidedAt,
            executionAt: candle.timestamp,
            reason: belowMinimumSize
              ? requestedNormalizedQuantity >=
                input.instrumentSpecification.minimumOrderBaseUnits
                ? 'LEVERAGE_LIMIT'
                : 'BELOW_MINIMUM_ORDER_SIZE'
              : 'BELOW_MINIMUM_ORDER_VALUE',
            requestedQuantityBaseUnits: pendingEntry.quantityBaseUnits,
            normalizedQuantityBaseUnits: normalizedQuantity,
          });
        } else {
          const stopDistance = Math.abs(
            pendingEntry.strategyEntryPrice -
              pendingEntry.strategyStopLossPrice,
          );
          const targetDistance = Math.abs(
            pendingEntry.strategyTakeProfitPrice -
              pendingEntry.strategyEntryPrice,
          );
          const closingSide =
            pendingEntry.direction === 'LONG' ? 'SELL' : 'BUY';
          const stopLossPrice = quantizeBacktestFillPrice(
            pendingEntry.direction === 'LONG'
              ? fillPrice - stopDistance
              : fillPrice + stopDistance,
            input.instrumentSpecification.tickSize,
            closingSide,
          );
          const takeProfitPrice = quantizeBacktestFillPrice(
            pendingEntry.direction === 'LONG'
              ? fillPrice + targetDistance
              : fillPrice - targetDistance,
            input.instrumentSpecification.tickSize,
            closingSide,
          );
          const entryFee =
            fillPrice * normalizedQuantity * (this.policy.feeBps / 10_000);
          const entrySlippageCost =
            Math.abs(fillPrice - candle.open) * normalizedQuantity;
          position = {
            direction: pendingEntry.direction,
            decidedAt: pendingEntry.decidedAt,
            openedAt: candle.timestamp,
            entryReferencePrice: candle.open,
            entryPrice: fillPrice,
            requestedQuantityBaseUnits: pendingEntry.quantityBaseUnits,
            quantityBaseUnits: normalizedQuantity,
            stopLossPrice,
            takeProfitPrice,
            riskAmount:
              Math.abs(fillPrice - stopLossPrice) * normalizedQuantity,
            entryReason: pendingEntry.entryReason,
            entryFee,
            entrySlippageCost,
            fundingPnl: 0,
            trailingStopPrice: null,
          };
        }
      }
      pendingEntry = null;

      if (position !== null) {
        const current: OpenBacktestPosition = position;
        const stopHit =
          current.direction === 'LONG'
            ? candle.low <= current.stopLossPrice
            : candle.high >= current.stopLossPrice;
        if (stopHit) {
          const gapAdjustedStop =
            current.openedAt === candle.timestamp
              ? current.stopLossPrice
              : current.direction === 'LONG'
                ? Math.min(current.stopLossPrice, candle.open)
                : Math.max(current.stopLossPrice, candle.open);
          finish(current, candle, gapAdjustedStop, 'STOP_LOSS');
        } else {
          const targetHit =
            current.direction === 'LONG'
              ? candle.high >= current.takeProfitPrice
              : candle.low <= current.takeProfitPrice;
          if (targetHit) {
            const gapAdjustedTarget =
              current.openedAt === candle.timestamp
                ? current.takeProfitPrice
                : current.direction === 'LONG'
                  ? Math.max(current.takeProfitPrice, candle.open)
                  : Math.min(current.takeProfitPrice, candle.open);
            finish(current, candle, gapAdjustedTarget, 'TAKE_PROFIT');
          } else if (current.trailingStopPrice !== null) {
            const trailingHit =
              current.direction === 'LONG'
                ? candle.low <= current.trailingStopPrice
                : candle.high >= current.trailingStopPrice;
            if (trailingHit) {
              const gapAdjustedTrailing =
                current.openedAt === candle.timestamp
                  ? current.trailingStopPrice
                  : current.direction === 'LONG'
                    ? Math.min(current.trailingStopPrice, candle.open)
                    : Math.max(current.trailingStopPrice, candle.open);
              finish(current, candle, gapAdjustedTrailing, 'TRAILING_STOP');
            }
          }
        }
      }

      history.push(candle);

      const currentForSignal: OpenBacktestPosition | null = position;
      const equityForSignal =
        currentForSignal === null
          ? realizedEquity
          : realizedEquity +
            movementPnl({
              direction: currentForSignal.direction,
              entryPrice: currentForSignal.entryPrice,
              exitPrice: candle.close,
              quantity: currentForSignal.quantityBaseUnits,
            }) +
            currentForSignal.fundingPnl;
      const result = this.strategy.generateSignal({
        instrumentId: input.instrumentId,
        candles: history,
        accountEquity: Math.max(Number.EPSILON, equityForSignal),
        openPosition:
          currentForSignal === null ? null : toOpenPosition(currentForSignal),
        config: input.config,
      });

      if (position !== null) {
        const current: OpenBacktestPosition = position;
        if (result.action === 'EXIT') {
          pendingExit = {
            decidedAt: candle.timestamp,
            reason: result.reasons[0] ?? 'STRATEGY_EXIT',
          };
        } else if (result.trailingStopPrice !== null) {
          position = {
            ...current,
            trailingStopPrice: result.trailingStopPrice,
          };
        }
      } else if (
        (result.action === 'BUY' || result.action === 'SELL') &&
        result.direction !== null &&
        result.entryPrice !== null &&
        result.stopLossPrice !== null &&
        result.takeProfitPrice !== null &&
        result.positionSizeBaseUnits > 0
      ) {
        pendingEntry = {
          direction: result.direction,
          decidedAt: candle.timestamp,
          strategyEntryPrice: result.entryPrice,
          strategyStopLossPrice: result.stopLossPrice,
          strategyTakeProfitPrice: result.takeProfitPrice,
          quantityBaseUnits: result.positionSizeBaseUnits,
          entryReason: result.reasons.join(',') || 'STRATEGY_ENTRY',
        };
      }

      const currentForMark: OpenBacktestPosition | null = position;
      const markEquity =
        currentForMark === null
          ? realizedEquity
          : realizedEquity +
            movementPnl({
              direction: currentForMark.direction,
              entryPrice: currentForMark.entryPrice,
              exitPrice: candle.close,
              quantity: currentForMark.quantityBaseUnits,
            }) +
            currentForMark.fundingPnl -
            currentForMark.entryFee;
      equityCurve.push({ timestamp: candle.timestamp, equity: markEquity });
    }

    if (pendingEntry !== null) {
      tradeRejections.push({
        decidedAt: pendingEntry.decidedAt,
        executionAt: null,
        reason: 'NO_FUTURE_MARKET_EVENT',
        requestedQuantityBaseUnits: pendingEntry.quantityBaseUnits,
        normalizedQuantityBaseUnits: 0,
      });
    }
    const last = candles[candles.length - 1];
    if (position !== null && last !== undefined) {
      finish(position, last, last.close, 'END_OF_BACKTEST');
      equityCurve.push({ timestamp: last.timestamp, equity: realizedEquity });
    }

    const analytics = calculatePerformanceAnalytics({
      trades: trades.map((trade) => ({
        openedAt: trade.openedAt,
        closedAt: trade.closedAt,
        netPnl: trade.netPnl,
        riskAmount: trade.riskAmount,
      })),
      equityCurve,
    });
    const statistics = calculateBacktestStatistics({
      initialEquity: this.policy.initialEquity,
      trades: trades.map((trade) => ({
        id: trade.tradeId,
        openedAt: trade.openedAt,
        closedAt: trade.closedAt,
        grossPnl: trade.grossPnl,
        feeCost: trade.feeCost,
        fundingPnl: trade.fundingPnl,
        netPnl: trade.netPnl,
        initialRisk: trade.riskAmount,
      })),
    });
    const first = candles[0];
    const final = candles[candles.length - 1];
    const buyAndHold: BuyAndHoldBenchmark = {
      entryPrice: first?.close ?? null,
      exitPrice: final?.close ?? null,
      returnPercent:
        first === undefined || final === undefined
          ? 0
          : ((final.close - first.close) / first.close) * 100,
    };

    return {
      schemaVersion: 2,
      executionModel: 'NEXT_CONFIRMED_CANDLE_OPEN',
      inputFingerprint: input.inputFingerprint ?? null,
      strategyId: this.strategy.id,
      instrumentId: input.instrumentId,
      instrumentSpecification: { ...input.instrumentSpecification },
      candleCount: candles.length,
      fundingEventCount: fundingEvents.length,
      appliedFundingEventCount,
      trades,
      tradeRejections,
      equityCurve,
      analytics,
      statistics,
      buyAndHold,
      endingEquity: realizedEquity,
      netReturnPercent:
        ((realizedEquity - this.policy.initialEquity) /
          this.policy.initialEquity) *
        100,
      liveExecutionAllowed: false,
    };
  }

  public compareCandidates(input: {
    readonly instrumentId: string;
    readonly instrumentSpecification: BacktestInstrumentSpecification;
    readonly candles: readonly HistoricalBacktestCandle[];
    readonly candidates: readonly {
      readonly candidateId: string;
      readonly config: TradingStrategyConfig;
    }[];
  }): readonly ParameterCandidateResult[] {
    const ids = new Set<string>();
    if (input.candidates.length === 0 || input.candidates.length > 25) {
      throw new Error(
        'candidate comparison requires between 1 and 25 candidates',
      );
    }
    return input.candidates.map((candidate) => {
      if (
        candidate.candidateId.trim().length === 0 ||
        ids.has(candidate.candidateId)
      ) {
        throw new Error('candidate IDs must be non-empty and unique');
      }
      ids.add(candidate.candidateId);
      return {
        candidateId: candidate.candidateId,
        config: candidate.config,
        report: this.run({
          instrumentId: input.instrumentId,
          instrumentSpecification: input.instrumentSpecification,
          candles: input.candles,
          config: candidate.config,
        }),
      };
    });
  }

  public createWalkForwardPlan(input: {
    readonly instrumentId: string;
    readonly candles: readonly HistoricalBacktestCandle[];
    /** Predeclared outcome horizon used to purge overlapping labels. */
    readonly labelHorizonMs: number;
    readonly policy: PurgedWalkForwardPolicy;
  }): PurgedWalkForwardPlan<WalkForwardObservation> {
    if (
      !Number.isSafeInteger(input.labelHorizonMs) ||
      input.labelHorizonMs <= 0
    ) {
      throw new Error('labelHorizonMs must be a positive safe integer');
    }
    const observations: WalkForwardObservation[] = input.candles
      .filter((candle) => candle.confirm)
      .map((candle, index) => {
        const labelEndAt = candle.timestamp + input.labelHorizonMs;
        if (!Number.isSafeInteger(labelEndAt)) {
          throw new Error(
            `label horizon overflows for candle ${candle.timestamp}`,
          );
        }
        return {
          id: `${input.instrumentId}:${candle.timestamp}:${index}`,
          observedAt: candle.timestamp,
          labelEndAt,
          episodeId: episodeId(input.instrumentId, candle.timestamp),
        };
      });
    return createPurgedWalkForwardPlan({ observations, policy: input.policy });
  }

  public runMonteCarlo(input: {
    readonly report: PlatformBacktestReport;
    readonly policy?: Partial<ExecutionMonteCarloPolicy>;
  }): ExecutionMonteCarloReport {
    const trades: MonteCarloTrade[] = input.report.trades.map((trade) => ({
      tradeId: trade.tradeId,
      episodeId: trade.episodeId,
      grossPnl: trade.grossPnl,
      feeCost: trade.feeCost,
      fundingPnl: trade.fundingPnl,
      slippageCost: trade.slippageCost,
      notional: trade.entryPrice * trade.quantityBaseUnits,
      latencyMs: trade.entryLatencyMs,
    }));
    return runExecutionMonteCarlo({ trades, policy: input.policy });
  }

  public exportTradesCsv(report: PlatformBacktestReport): string {
    const header = [
      'tradeId',
      'instrumentId',
      'direction',
      'decidedAt',
      'openedAt',
      'closedAt',
      'entryReferencePrice',
      'exitReferencePrice',
      'entryPrice',
      'exitPrice',
      'requestedQuantityBaseUnits',
      'quantityBaseUnits',
      'entryReason',
      'exitReason',
      'grossPnl',
      'feeCost',
      'fundingPnl',
      'slippageCost',
      'netPnl',
      'riskAmount',
      'rMultiple',
      'durationMs',
      'entryLatencyMs',
    ];
    const rows = report.trades.map((trade) =>
      [
        trade.tradeId,
        trade.instrumentId,
        trade.direction,
        trade.decidedAt,
        trade.openedAt,
        trade.closedAt,
        trade.entryReferencePrice,
        trade.exitReferencePrice,
        trade.entryPrice,
        trade.exitPrice,
        trade.requestedQuantityBaseUnits,
        trade.quantityBaseUnits,
        trade.entryReason,
        trade.exitReason,
        trade.grossPnl,
        trade.feeCost,
        trade.fundingPnl,
        trade.slippageCost,
        trade.netPnl,
        trade.riskAmount,
        trade.rMultiple,
        trade.durationMs,
        trade.entryLatencyMs,
      ]
        .map(csvEscape)
        .join(','),
    );
    return `${header.join(',')}\n${rows.join('\n')}${rows.length > 0 ? '\n' : ''}`;
  }
}
