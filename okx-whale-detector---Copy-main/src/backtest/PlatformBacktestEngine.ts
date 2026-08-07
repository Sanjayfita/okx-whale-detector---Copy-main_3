import {
  calculatePerformanceAnalytics,
  type EquityPoint,
  type PerformanceAnalyticsReport,
} from '../analytics/PerformanceAnalytics';
import type { TradingStrategyConfig } from '../config/tradingStrategyConfig';
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

export interface HistoricalBacktestCandle extends EmaTrendCandle {
  readonly fundingRatePercent?: number;
}

export interface PlatformBacktestPolicy {
  readonly initialEquity: number;
  readonly feeBps: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
}

export const DEFAULT_PLATFORM_BACKTEST_POLICY: PlatformBacktestPolicy = Object.freeze({
  initialEquity: 10_000,
  feeBps: 5,
  spreadBps: 2,
  slippageBps: 1,
});

export interface PlatformBacktestTrade {
  readonly tradeId: string;
  readonly episodeId: string;
  readonly instrumentId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly openedAt: number;
  readonly closedAt: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
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
}

export interface BuyAndHoldBenchmark {
  readonly entryPrice: number | null;
  readonly exitPrice: number | null;
  readonly returnPercent: number;
}

export interface PlatformBacktestReport {
  readonly strategyId: string;
  readonly instrumentId: string;
  readonly candleCount: number;
  readonly trades: readonly PlatformBacktestTrade[];
  readonly equityCurve: readonly EquityPoint[];
  readonly analytics: PerformanceAnalyticsReport;
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
  readonly openedAt: number;
  readonly entryPrice: number;
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

const requireFiniteNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
};

const validatePolicy = (policy: PlatformBacktestPolicy): void => {
  if (!Number.isFinite(policy.initialEquity) || policy.initialEquity <= 0) {
    throw new Error('initialEquity must be positive and finite');
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
}): PlatformBacktestTrade => {
  const closingSide = input.position.direction === 'LONG' ? 'SELL' : 'BUY';
  const exitPrice = adversePrice({
    referencePrice: input.referencePrice,
    side: closingSide,
    policy: input.policy,
  });
  const grossPnl = movementPnl({
    direction: input.position.direction,
    entryPrice: input.position.entryPrice,
    exitPrice,
    quantity: input.position.quantityBaseUnits,
  });
  const exitFee =
    exitPrice * input.position.quantityBaseUnits * (input.policy.feeBps / 10_000);
  const exitSlippageCost =
    Math.abs(exitPrice - input.referencePrice) * input.position.quantityBaseUnits;
  const feeCost = input.position.entryFee + exitFee;
  const slippageCost = input.position.entrySlippageCost + exitSlippageCost;
  const netPnl = grossPnl - feeCost + input.position.fundingPnl;

  return {
    tradeId: `${input.instrumentId}:${input.position.openedAt}:${input.candle.timestamp}`,
    episodeId: episodeId(input.instrumentId, input.position.openedAt),
    instrumentId: input.instrumentId,
    direction: input.position.direction,
    openedAt: input.position.openedAt,
    closedAt: input.candle.timestamp,
    entryPrice: input.position.entryPrice,
    exitPrice,
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
  };
};

/**
 * Candle-close backtester for the dashboard and CLI.
 * Stops are evaluated before targets on ambiguous OHLC bars. A trailing stop
 * calculated from a candle becomes eligible only on the following candle.
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
    readonly candles: readonly HistoricalBacktestCandle[];
    readonly config: TradingStrategyConfig;
  }): PlatformBacktestReport {
    if (input.instrumentId.trim().length === 0) {
      throw new Error('instrumentId must not be empty');
    }
    const candles = input.candles
      .filter((candle) => candle.confirm)
      .slice()
      .sort((left, right) => left.timestamp - right.timestamp);
    let realizedEquity = this.policy.initialEquity;
    let position: OpenBacktestPosition | null = null;
    const trades: PlatformBacktestTrade[] = [];
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
      });
      trades.push(trade);
      realizedEquity += trade.netPnl;
      position = null;
    };

    for (const candle of candles) {
      history.push(candle);

      if (position !== null) {
        const current = position;
        const stopHit =
          current.direction === 'LONG'
            ? candle.low <= current.stopLossPrice
            : candle.high >= current.stopLossPrice;
        if (stopHit) {
          finish(current, candle, current.stopLossPrice, 'STOP_LOSS');
        } else {
          const targetHit =
            current.direction === 'LONG'
              ? candle.high >= current.takeProfitPrice
              : candle.low <= current.takeProfitPrice;
          if (targetHit) {
            finish(current, candle, current.takeProfitPrice, 'TAKE_PROFIT');
          } else if (current.trailingStopPrice !== null) {
            const trailingHit =
              current.direction === 'LONG'
                ? candle.low <= current.trailingStopPrice
                : candle.high >= current.trailingStopPrice;
            if (trailingHit) {
              finish(current, candle, current.trailingStopPrice, 'TRAILING_STOP');
            }
          }
        }
      }

      if (position !== null && candle.fundingRatePercent !== undefined) {
        const current = position;
        if (!Number.isFinite(candle.fundingRatePercent)) {
          throw new Error('fundingRatePercent must be finite when supplied');
        }
        const notional: number = candle.close * current.quantityBaseUnits;
        const fundingPayment: number =
          notional *
          (candle.fundingRatePercent / 100) *
          (current.direction === 'LONG' ? -1 : 1);
        position = {
          ...current,
          fundingPnl: current.fundingPnl + fundingPayment,
        };
      }

      const currentForSignal = position;
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
        const current = position;
        if (result.action === 'EXIT') {
          finish(
            current,
            candle,
            candle.close,
            result.reasons[0] ?? 'STRATEGY_EXIT',
          );
        } else if (result.trailingStopPrice !== null) {
          position = { ...current, trailingStopPrice: result.trailingStopPrice };
        }
      } else if (
        (result.action === 'BUY' || result.action === 'SELL') &&
        result.direction !== null &&
        result.entryPrice !== null &&
        result.stopLossPrice !== null &&
        result.takeProfitPrice !== null &&
        result.positionSizeBaseUnits > 0
      ) {
        const openingSide = result.direction === 'LONG' ? 'BUY' : 'SELL';
        const fillPrice = adversePrice({
          referencePrice: candle.close,
          side: openingSide,
          policy: this.policy,
        });
        const stopDistance = Math.abs(result.entryPrice - result.stopLossPrice);
        const targetDistance = Math.abs(result.takeProfitPrice - result.entryPrice);
        const stopLossPrice =
          result.direction === 'LONG'
            ? fillPrice - stopDistance
            : fillPrice + stopDistance;
        const takeProfitPrice =
          result.direction === 'LONG'
            ? fillPrice + targetDistance
            : fillPrice - targetDistance;
        const entryFee =
          fillPrice *
          result.positionSizeBaseUnits *
          (this.policy.feeBps / 10_000);
        const entrySlippageCost =
          Math.abs(fillPrice - candle.close) * result.positionSizeBaseUnits;
        position = {
          direction: result.direction,
          openedAt: candle.timestamp,
          entryPrice: fillPrice,
          quantityBaseUnits: result.positionSizeBaseUnits,
          stopLossPrice,
          takeProfitPrice,
          riskAmount: stopDistance * result.positionSizeBaseUnits,
          entryReason: result.reasons.join(',') || 'STRATEGY_ENTRY',
          entryFee,
          entrySlippageCost,
          fundingPnl: 0,
          trailingStopPrice: null,
        };
      }

      const currentForMark = position;
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
      strategyId: this.strategy.id,
      instrumentId: input.instrumentId,
      candleCount: candles.length,
      trades,
      equityCurve,
      analytics,
      buyAndHold,
      endingEquity: realizedEquity,
      netReturnPercent:
        ((realizedEquity - this.policy.initialEquity) / this.policy.initialEquity) *
        100,
      liveExecutionAllowed: false,
    };
  }

  public compareCandidates(input: {
    readonly instrumentId: string;
    readonly candles: readonly HistoricalBacktestCandle[];
    readonly candidates: readonly {
      readonly candidateId: string;
      readonly config: TradingStrategyConfig;
    }[];
  }): readonly ParameterCandidateResult[] {
    const ids = new Set<string>();
    if (input.candidates.length === 0 || input.candidates.length > 25) {
      throw new Error('candidate comparison requires between 1 and 25 candidates');
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
          candles: input.candles,
          config: candidate.config,
        }),
      };
    });
  }

  public createWalkForwardPlan(input: {
    readonly instrumentId: string;
    readonly candles: readonly HistoricalBacktestCandle[];
    readonly policy: PurgedWalkForwardPolicy;
  }): PurgedWalkForwardPlan<WalkForwardObservation> {
    const observations: WalkForwardObservation[] = input.candles
      .filter((candle) => candle.confirm)
      .map((candle, index) => ({
        id: `${input.instrumentId}:${candle.timestamp}:${index}`,
        observedAt: candle.timestamp,
        labelEndAt: candle.timestamp,
        episodeId: episodeId(input.instrumentId, candle.timestamp),
      }));
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
      latencyMs: 0,
    }));
    return runExecutionMonteCarlo({ trades, policy: input.policy });
  }

  public exportTradesCsv(report: PlatformBacktestReport): string {
    const header = [
      'tradeId',
      'instrumentId',
      'direction',
      'openedAt',
      'closedAt',
      'entryPrice',
      'exitPrice',
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
    ];
    const rows = report.trades.map((trade) =>
      [
        trade.tradeId,
        trade.instrumentId,
        trade.direction,
        trade.openedAt,
        trade.closedAt,
        trade.entryPrice,
        trade.exitPrice,
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
      ]
        .map(csvEscape)
        .join(','),
    );
    return `${header.join(',')}\n${rows.join('\n')}${rows.length > 0 ? '\n' : ''}`;
  }
}
