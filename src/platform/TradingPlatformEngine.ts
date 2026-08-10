import {
  estimateLinearLiquidationPrice,
  simulateMarketOrder,
} from '../backtest/ExecutionSimulator';
import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import type { TradingTimeframe } from '../config/tradingTimeframes';
import type { OrderBookManager } from '../core/OrderBookManager';
import type {
  NotificationService,
  TradingNotificationType,
} from '../notifications/NotificationService';
import type { PaperManagedPosition } from '../paper/PaperAccountLedger';
import type {
  EmaTrendCandle,
  EmaTrendOpenPosition,
} from '../strategy/EmaTrendStrategy';
import type { StrategySignalResult } from '../strategies/TradingStrategy';
import type { MarketInstrumentConfig } from '../types/instrument';
import {
  LazyExecutionBookStore,
  type ExecutionBookMaterializationMetrics,
} from './LazyExecutionBookStore';
import type {
  DashboardStrategyStatus,
  DashboardStrategyTelemetry,
} from './PlatformContracts';
import { PlatformStateStore } from './PlatformStateStore';

export interface ExecutionMarketState {
  readonly instrument: MarketInstrumentConfig;
  readonly orderBookManager: OrderBookManager;
}

export interface PaperEntryTraceContext {
  readonly tradeId: string;
  readonly instrumentId: string;
  readonly strategyId: string;
  readonly timeframe: TradingTimeframe;
  readonly recordedAt: number;
}

export interface TradingPlatformEngineOptions {
  readonly maximumStrategyCandles?: number;
  readonly paperLeverage?: number;
  readonly maintenanceMarginRate?: number;
  readonly notifications?: NotificationService;
  readonly beforePaperPositionOpen?: (
    context: PaperEntryTraceContext,
  ) => boolean;
  readonly now?: () => number;
}

type MutableStrategyTelemetry = {
  evaluations: number;
  insufficientHistory: number;
  noFreshEmaCrossover: number;
  priceTrendMismatch: number;
  rsiFilter: number;
  atrFilter: number;
  positionAlreadyOpen: number;
  entryReady: number;
};

const emptyStrategyTelemetry = (): MutableStrategyTelemetry => ({
  evaluations: 0,
  insufficientHistory: 0,
  noFreshEmaCrossover: 0,
  priceTrendMismatch: 0,
  rsiFilter: 0,
  atrFilter: 0,
  positionAlreadyOpen: 0,
  entryReady: 0,
});

const toEmaCandle = (candle: OKXCandle): EmaTrendCandle => ({
  timestamp: candle.timestamp,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
  confirm: candle.confirm,
});

const openPositionForStrategy = (
  position: PaperManagedPosition | undefined,
): EmaTrendOpenPosition | null =>
  position === undefined
    ? null
    : {
        direction: position.direction,
        openedAt: position.openedAt,
        entryPrice: position.entryPrice,
        stopLossPrice: position.stopLossPrice,
        takeProfitPrice: position.takeProfitPrice,
      };

const signalText = (result: StrategySignalResult): 'BUY' | 'SELL' | 'WAIT' => {
  if (result.action === 'BUY') return 'BUY';
  if (result.action === 'SELL') return 'SELL';
  if (result.action === 'EXIT' && result.direction === 'SHORT') return 'BUY';
  if (result.action === 'EXIT' && result.direction === 'LONG') return 'SELL';
  return 'WAIT';
};

const statusFromDecision = (
  result: StrategySignalResult,
  telemetry: DashboardStrategyTelemetry,
): DashboardStrategyStatus => {
  const diagnostics = result.diagnostics;
  const rsi = result.indicators.rsi ?? null;
  const atrPercent = result.indicators.atrPercent ?? null;

  return {
    strategyId: result.strategyId,
    instrumentId: result.instrumentId,
    state: diagnostics.state,
    signal: signalText(result),
    reasons: result.reasons,
    primaryReason: diagnostics.primaryReason,
    checks: [
      {
        label: 'Fresh EMA crossover',
        passed: diagnostics.freshEmaCrossover,
        detail: diagnostics.sufficientHistory
          ? diagnostics.freshEmaCrossover
            ? `${diagnostics.candidateDirection ?? ''} crossover detected`.trim()
            : 'No fresh EMA crossover'
          : 'Waiting for confirmed candle history',
      },
      {
        label: 'Price trend alignment',
        passed: diagnostics.priceTrendAlignment,
        detail:
          diagnostics.priceTrendAlignment === null
            ? 'Requires a fresh crossover direction first'
            : diagnostics.priceTrendAlignment
              ? 'Price location and slow EMA slope agree'
              : 'Price/slow EMA trend alignment not confirmed',
      },
      {
        label: 'RSI',
        passed: diagnostics.rsiPass,
        detail:
          rsi === null
            ? 'Waiting for RSI'
            : diagnostics.rsiPass === null
              ? `RSI ${rsi.toFixed(2)}; waiting for crossover direction`
              : `RSI ${rsi.toFixed(2)}`,
      },
      {
        label: 'ATR volatility',
        passed: diagnostics.atrVolatilityPass,
        detail:
          atrPercent === null
            ? 'Waiting for ATR'
            : `ATR ${atrPercent.toFixed(3)}%`,
      },
      {
        label: 'No open position',
        passed: !diagnostics.positionOpen,
        detail: diagnostics.positionOpen
          ? 'A paper position is already open'
          : 'No existing paper position blocks entry',
      },
    ],
    telemetry,
    updatedAt: result.observedAt,
  };
};

export class TradingPlatformEngine {
  private readonly books = new LazyExecutionBookStore();
  private readonly candles = new Map<string, EmaTrendCandle[]>();
  private readonly executionResumeAfter = new Map<string, number>();
  private readonly strategyTelemetry = new Map<
    string,
    MutableStrategyTelemetry
  >();
  private readonly maximumStrategyCandles: number;
  private readonly paperLeverage: number;
  private readonly maintenanceMarginRate: number;
  private readonly notifications?: NotificationService;
  private readonly beforePaperPositionOpen?: (
    context: PaperEntryTraceContext,
  ) => boolean;
  private readonly now: () => number;
  private rebuildingTimeframe = false;

  public constructor(
    public readonly store: PlatformStateStore,
    options: TradingPlatformEngineOptions = {},
  ) {
    this.maximumStrategyCandles = options.maximumStrategyCandles ?? 500;
    this.paperLeverage = options.paperLeverage ?? 2;
    this.maintenanceMarginRate = options.maintenanceMarginRate ?? 0.005;
    this.notifications = options.notifications;
    this.beforePaperPositionOpen = options.beforePaperPositionOpen;
    this.now = options.now ?? Date.now;

    if (
      !Number.isSafeInteger(this.maximumStrategyCandles) ||
      this.maximumStrategyCandles <= 0
    ) {
      throw new Error('maximumStrategyCandles must be a positive safe integer');
    }
    if (!Number.isFinite(this.paperLeverage) || this.paperLeverage <= 1) {
      throw new Error('paperLeverage must be greater than 1');
    }
    if (
      !Number.isFinite(this.maintenanceMarginRate) ||
      this.maintenanceMarginRate < 0 ||
      this.maintenanceMarginRate >= 1 / this.paperLeverage
    ) {
      throw new Error(
        'maintenanceMarginRate is incompatible with paperLeverage',
      );
    }
  }

  public beginTimeframeRebuild(timeframe: TradingTimeframe): void {
    this.rebuildingTimeframe = true;
    this.candles.clear();
    this.executionResumeAfter.clear();
    this.strategyTelemetry.clear();
    this.store.clearStrategyMarketState();
    this.store.setTimeframeState(
      'REBUILDING',
      `Loading confirmed OKX ${timeframe} candle history...`,
    );
  }

  public completeTimeframeRebuild(
    timeframe: TradingTimeframe,
    lastHistoricalTimestampByInstrument: ReadonlyMap<string, number>,
  ): void {
    this.executionResumeAfter.clear();
    for (const [
      instrumentId,
      timestamp,
    ] of lastHistoricalTimestampByInstrument) {
      this.executionResumeAfter.set(instrumentId, timestamp);
    }
    this.rebuildingTimeframe = false;
    this.store.setTimeframeState(
      'READY',
      `Using confirmed OKX ${timeframe} candles`,
    );
  }

  public failTimeframeRebuild(
    timeframe: TradingTimeframe,
    message: string,
  ): void {
    this.rebuildingTimeframe = true;
    this.store.setTimeframeState(
      'ERROR',
      `Unable to rebuild ${timeframe} candles: ${message}`,
    );
  }

  public getExecutionBookMetrics(): ExecutionBookMaterializationMetrics {
    return this.books.getMetrics();
  }

  public onOrderBook(instrumentId: string, state: ExecutionMarketState): void {
    this.books.observe(instrumentId, state);
    if (!state.orderBookManager.isUsableForSignals()) return;

    const midpoint = state.orderBookManager.getMidPrice();
    const position = this.store.account.getOpenPosition(instrumentId);
    if (midpoint === undefined || position === undefined) return;

    const executableExitPrice =
      position.direction === 'LONG'
        ? state.orderBookManager.getBestBid()?.price
        : state.orderBookManager.getBestAsk()?.price;
    if (executableExitPrice === undefined) return;

    const marked = this.store.account.markPosition({
      instrumentId,
      price: midpoint,
      timestamp: state.orderBookManager.getOrderBook().updatedAt,
    });
    this.evaluateProtectiveExit(marked, executableExitPrice);
  }

  public onCandle(candle: OKXCandle): void {
    const selectedTimeframe = this.store.getSettings().timeframe;
    if (candle.interval !== selectedTimeframe) return;

    const strategyCandle = toEmaCandle(candle);
    const history = this.candles.get(candle.instId) ?? [];
    const existing = history.findIndex(
      (value) => value.timestamp === candle.timestamp,
    );
    if (existing >= 0) history[existing] = strategyCandle;
    else history.push(strategyCandle);
    history.sort((left, right) => left.timestamp - right.timestamp);
    if (history.length > this.maximumStrategyCandles) {
      history.splice(0, history.length - this.maximumStrategyCandles);
    }
    this.candles.set(candle.instId, history);

    if (!candle.confirm) {
      this.store.appendCandle({
        instrumentId: candle.instId,
        timeframe: candle.interval,
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        confirmed: false,
        fastEma: null,
        slowEma: null,
        rsi: null,
        atr: null,
      });
      return;
    }

    const account = this.store.account.snapshot(candle.timestamp);
    const position = this.store.account.getOpenPosition(candle.instId);
    const strategy = this.store.strategies.getActive();
    const result = strategy.generateSignal({
      instrumentId: candle.instId,
      candles: history,
      accountEquity: account.equity,
      openPosition: openPositionForStrategy(position),
      config: this.store.getStrategyConfig(),
    });
    this.store.appendCandle({
      instrumentId: candle.instId,
      timeframe: candle.interval,
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      confirmed: true,
      fastEma: result.indicators.fastEma ?? null,
      slowEma: result.indicators.slowEma ?? null,
      rsi: result.indicators.rsi ?? null,
      atr: result.indicators.atr ?? null,
    });
    const telemetry = this.recordStrategyTelemetry(result);
    this.store.setStrategyStatus(statusFromDecision(result, telemetry));

    if (this.rebuildingTimeframe) return;
    const resumeAfter = this.executionResumeAfter.get(candle.instId);
    if (resumeAfter !== undefined && candle.timestamp <= resumeAfter) return;

    if (position !== undefined) {
      if (result.trailingStopPrice !== null) {
        this.store.account.markPosition({
          instrumentId: candle.instId,
          price: candle.close,
          timestamp: candle.timestamp,
          trailingStopPrice: result.trailingStopPrice,
          auditEventId:
            `trailing:${position.tradeId}:` +
            `${candle.timestamp}:${result.trailingStopPrice}`,
        });
        this.store.persistPaperState(candle.timestamp);
      }
      if (result.action === 'EXIT') {
        this.closePaperPosition(
          candle.instId,
          result.reasons[0] ?? 'STRATEGY_EXIT',
        );
      }
      return;
    }

    if (result.action !== 'BUY' && result.action !== 'SELL') return;
    if (this.store.getSettings().mode !== 'PAPER') {
      this.store.log(
        'WARNING',
        'Live strategy signal observed; order execution remains disabled',
        {
          instrumentId: candle.instId,
          signal: result.action,
        },
      );
      return;
    }
    this.openPaperPosition(result);
  }

  public onFunding(input: {
    readonly instrumentId: string;
    readonly fundingRatePercent: number;
    readonly timestamp: number;
    readonly fundingEventId?: string;
    readonly fundingId?: string;
  }): void {
    const position = this.store.account.getOpenPosition(input.instrumentId);
    if (position === undefined) return;
    if (!Number.isFinite(input.fundingRatePercent)) {
      throw new Error('fundingRatePercent must be finite');
    }
    const notional = position.currentPrice * position.quantityBaseUnits;
    const fundingPnl =
      notional *
      (input.fundingRatePercent / 100) *
      (position.direction === 'LONG' ? -1 : 1);
    const fundingId =
      input.fundingEventId ??
      input.fundingId ??
      `funding:${input.instrumentId}:${input.timestamp}:${input.fundingRatePercent}`;
    const funding = this.store.account.applyFundingEvent({
      fundingId,
      instrumentId: input.instrumentId,
      fundingPnl,
      fundingRatePercent: input.fundingRatePercent,
      positionNotional: notional,
      timestamp: input.timestamp,
    });
    if (!funding.applied) return;
    this.store.persistPaperState(input.timestamp);
    this.store.log('TRADE', 'Paper funding applied', {
      instrumentId: input.instrumentId,
      fundingId,
      fundingPnl,
      fundingRatePercent: input.fundingRatePercent,
    });
  }

  public sendDailySummary(timestamp = this.now()): void {
    const snapshot = this.store.snapshot(timestamp);
    this.notify(
      'DAILY_SUMMARY',
      'Trading platform daily summary',
      `Equity ${snapshot.overview.accountEquity.toFixed(2)}, ` +
        `PnL today ${snapshot.overview.pnlToday.toFixed(2)}, ` +
        `win rate ${snapshot.overview.winRate.toFixed(2)}%`,
      {
        equity: snapshot.overview.accountEquity,
        pnlToday: snapshot.overview.pnlToday,
        trades: snapshot.analytics.trades,
      },
    );
  }

  private recordStrategyTelemetry(
    result: StrategySignalResult,
  ): DashboardStrategyTelemetry {
    const telemetry =
      this.strategyTelemetry.get(result.strategyId) ?? emptyStrategyTelemetry();
    this.strategyTelemetry.set(result.strategyId, telemetry);
    telemetry.evaluations += 1;

    for (const reason of result.diagnostics.blockingReasons) {
      if (reason === 'INSUFFICIENT_CONFIRMED_CANDLES') {
        telemetry.insufficientHistory += 1;
      } else if (reason === 'NO_EMA_CROSSOVER') {
        telemetry.noFreshEmaCrossover += 1;
      } else if (reason === 'TREND_FILTER_NOT_CONFIRMED') {
        telemetry.priceTrendMismatch += 1;
      } else if (reason === 'RSI_FILTER_NOT_CONFIRMED') {
        telemetry.rsiFilter += 1;
      } else if (
        reason === 'LOW_VOLATILITY' ||
        reason === 'EXTREME_VOLATILITY'
      ) {
        telemetry.atrFilter += 1;
      } else if (reason === 'POSITION_ALREADY_OPEN') {
        telemetry.positionAlreadyOpen += 1;
      }
    }
    if (result.diagnostics.state === 'ENTRY_READY') telemetry.entryReady += 1;

    return { ...telemetry };
  }

  private openPaperPosition(result: StrategySignalResult): void {
    if (
      result.direction === null ||
      result.entryPrice === null ||
      result.stopLossPrice === null ||
      result.takeProfitPrice === null ||
      result.positionSizeBaseUnits <= 0 ||
      result.riskAmount <= 0
    ) {
      this.store.log('ERROR', 'Strategy emitted incomplete entry details', {
        strategyId: result.strategyId,
        instrumentId: result.instrumentId,
      });
      return;
    }

    const observedAt = this.books.getObservedAt(result.instrumentId);
    if (observedAt === undefined) {
      this.store.log(
        'WARNING',
        'Paper entry missed because no usable order book is available',
        {
          instrumentId: result.instrumentId,
          strategyId: result.strategyId,
        },
      );
      return;
    }

    const account = this.store.account.snapshot(observedAt);
    const realizedPnlToday =
      this.store.account.getRealizedPnlForDay(observedAt);
    const startingDayEquity = Math.max(
      Number.EPSILON,
      account.equity - realizedPnlToday - account.unrealizedPnl,
    );
    const riskDecision = this.store.riskManager.evaluateNewTrade({
      timestamp: observedAt,
      startingDayEquity,
      currentEquity: account.equity,
      peakEquity: account.peakEquity,
      openPositions: account.openPositions.length,
      tradesToday: this.store.account.getTradesForDay(observedAt),
      realizedPnlToday,
      requestedRiskPercent: this.store.getSettings().riskPerTradePercent,
      requestedLeverage: this.paperLeverage,
    });
    if (!riskDecision.allowed) {
      this.store.log('WARNING', 'Risk manager blocked paper entry', {
        instrumentId: result.instrumentId,
        reasons: riskDecision.reasons.join(','),
      });
      return;
    }

    const executionBook = this.books.get(result.instrumentId);
    if (executionBook === undefined) {
      this.store.log(
        'WARNING',
        'Paper entry missed because no usable order book is available',
        {
          instrumentId: result.instrumentId,
          strategyId: result.strategyId,
        },
      );
      return;
    }

    const fill = simulateMarketOrder({
      side: result.direction === 'LONG' ? 'BUY' : 'SELL',
      quantity: result.positionSizeBaseUnits,
      book: executionBook,
    });
    if (
      fill.status === 'REJECTED' ||
      fill.averagePrice === null ||
      fill.filledQuantity <= 0 ||
      !fill.minimumFillRatioMet
    ) {
      this.store.log('WARNING', 'Paper entry missed or under-filled', {
        instrumentId: result.instrumentId,
        fillRatio: fill.fillRatio,
        reason: fill.rejectionReasons.join(','),
      });
      return;
    }

    const stopDistance = Math.abs(result.entryPrice - result.stopLossPrice);
    const targetDistance = Math.abs(result.takeProfitPrice - result.entryPrice);
    const stopLossPrice =
      result.direction === 'LONG'
        ? fill.averagePrice - stopDistance
        : fill.averagePrice + stopDistance;
    const takeProfitPrice =
      result.direction === 'LONG'
        ? fill.averagePrice + targetDistance
        : fill.averagePrice - targetDistance;
    const actualRiskAmount = stopDistance * fill.filledQuantity;
    const timeframe = this.store.getSettings().timeframe;
    const tradeId =
      `paper:${result.strategyId}:${result.instrumentId}:` +
      `${timeframe}:${result.observedAt}`;
    const fillId = `${tradeId}:entry:${executionBook.observedAt}`;
    if (
      this.beforePaperPositionOpen !== undefined &&
      !this.beforePaperPositionOpen({
        tradeId,
        instrumentId: result.instrumentId,
        strategyId: result.strategyId,
        timeframe,
        recordedAt: executionBook.observedAt,
      })
    ) {
      this.store.log(
        'ERROR',
        'Paper entry blocked because trace context was not persisted',
        {
          tradeId,
          instrumentId: result.instrumentId,
        },
      );
      return;
    }
    const opened = this.store.account.openPositionFromFill({
      fillId,
      tradeId,
      instrumentId: result.instrumentId,
      direction: result.direction,
      openedAt: executionBook.observedAt,
      entryPrice: fill.averagePrice,
      quantityBaseUnits: fill.filledQuantity,
      stopLossPrice,
      takeProfitPrice,
      trailingStopPrice: null,
      riskAmount: actualRiskAmount,
      entryReason: result.reasons.join(',') || 'STRATEGY_ENTRY',
      entryFee: fill.fee,
      slippageBps: fill.slippageBps,
      strategyId: result.strategyId,
      timeframe,
    });
    if (!opened.applied) return;
    this.store.persistPaperState(executionBook.observedAt);
    this.store.log('TRADE', 'Paper position opened', {
      instrumentId: result.instrumentId,
      direction: result.direction,
      price: fill.averagePrice,
      quantity: fill.filledQuantity,
      fee: fill.fee,
      slippageBps: fill.slippageBps,
    });
    this.notify(
      'TRADE_OPENED',
      `Paper ${result.direction} opened`,
      `${result.instrumentId} @ ${fill.averagePrice.toFixed(8)}`,
      {
        instrumentId: result.instrumentId,
        quantity: fill.filledQuantity,
        riskAmount: actualRiskAmount,
      },
    );
  }

  private closePaperPosition(instrumentId: string, exitReason: string): void {
    const position = this.store.account.getOpenPosition(instrumentId);
    const book = this.books.get(instrumentId);
    if (position === undefined || book === undefined) return;
    const fill = simulateMarketOrder({
      side: position.direction === 'LONG' ? 'SELL' : 'BUY',
      quantity: position.quantityBaseUnits,
      book,
    });
    if (fill.averagePrice === null || fill.filledQuantity <= 0) {
      this.store.log(
        'WARNING',
        'Paper exit could not be filled; position remains open',
        {
          instrumentId,
          fillRatio: fill.fillRatio,
          reason: fill.rejectionReasons.join(','),
        },
      );
      return;
    }

    const fillId = `${position.tradeId}:exit:${book.observedAt}:${exitReason}`;
    const closed = this.store.account.closePositionFromFill({
      fillId,
      instrumentId,
      exitPrice: fill.averagePrice,
      quantityBaseUnits: fill.filledQuantity,
      closedAt: book.observedAt,
      exitReason,
      exitFee: fill.fee,
      slippageBps: fill.slippageBps,
    });
    if (!closed.applied || closed.trade === null) return;
    const trade = closed.trade;
    this.store.persistPaperState(book.observedAt);
    if (closed.remainingPosition !== null) {
      this.store.log('TRADE', 'Paper position partially reduced', {
        instrumentId,
        exitReason,
        filledQuantity: fill.filledQuantity,
        remainingQuantity: closed.remainingPosition.quantityBaseUnits,
        realizedNetPnl: trade.netPnl,
        fees: trade.fees,
      });
      this.store.log(
        'WARNING',
        'Residual paper exposure remains after a partial exit fill',
        {
          instrumentId,
          fillRatio: fill.fillRatio,
          remainingQuantity: closed.remainingPosition.quantityBaseUnits,
        },
      );
      return;
    }
    this.store.riskManager.recordClosedTrade({
      closedAt: trade.closedAt,
      netPnl: trade.netPnl,
    });
    this.store.log('TRADE', 'Paper position closed', {
      instrumentId,
      exitReason,
      netPnl: trade.netPnl,
      fees: trade.fees,
      fundingPnl: trade.fundingPnl,
    });
    const notificationType: TradingNotificationType = exitReason.includes(
      'STOP',
    )
      ? 'STOP_HIT'
      : exitReason.includes('TAKE_PROFIT')
        ? 'TAKE_PROFIT'
        : 'TRADE_CLOSED';
    this.notify(
      notificationType,
      'Paper position closed',
      `${instrumentId}: ${exitReason}, net PnL ${trade.netPnl.toFixed(2)}`,
      {
        instrumentId,
        netPnl: trade.netPnl,
        rMultiple: trade.rMultiple,
      },
    );
  }

  private evaluateProtectiveExit(
    position: PaperManagedPosition,
    executableExitPrice: number,
  ): void {
    const price = executableExitPrice;
    const stopHit =
      position.direction === 'LONG'
        ? price <= position.stopLossPrice
        : price >= position.stopLossPrice;
    if (stopHit) {
      this.closePaperPosition(position.instrumentId, 'STOP_LOSS');
      return;
    }
    const targetHit =
      position.direction === 'LONG'
        ? price >= position.takeProfitPrice
        : price <= position.takeProfitPrice;
    if (targetHit) {
      this.closePaperPosition(position.instrumentId, 'TAKE_PROFIT');
      return;
    }
    const trailingHit =
      position.trailingStopPrice !== null &&
      (position.direction === 'LONG'
        ? price <= position.trailingStopPrice
        : price >= position.trailingStopPrice);
    if (trailingHit) {
      this.closePaperPosition(position.instrumentId, 'TRAILING_STOP');
      return;
    }

    const liquidationPrice = estimateLinearLiquidationPrice({
      direction: position.direction,
      entryPrice: position.entryPrice,
      leverage: this.paperLeverage,
      maintenanceMarginRate: this.maintenanceMarginRate,
    });
    const liquidated =
      position.direction === 'LONG'
        ? price <= liquidationPrice
        : price >= liquidationPrice;
    if (liquidated) {
      this.store.log('ERROR', 'Paper liquidation threshold reached', {
        instrumentId: position.instrumentId,
        liquidationPrice,
        currentPrice: price,
      });
      this.closePaperPosition(position.instrumentId, 'LIQUIDATION');
    }
  }

  private notify(
    type: TradingNotificationType,
    title: string,
    message: string,
    metadata: Readonly<Record<string, string | number | boolean | null>>,
  ): void {
    if (this.notifications === undefined) return;
    void this.notifications.send({
      type,
      timestamp: this.now(),
      title,
      message,
      metadata,
    });
  }
}
