import {
  calculatePerformanceAnalytics,
  type EquityPoint,
  type PerformanceAnalyticsReport,
} from '../analytics/PerformanceAnalytics';

export type ManagedPositionDirection = 'LONG' | 'SHORT';

export interface PaperManagedPosition {
  readonly instrumentId: string;
  readonly direction: ManagedPositionDirection;
  readonly openedAt: number;
  readonly entryPrice: number;
  readonly quantityBaseUnits: number;
  readonly stopLossPrice: number;
  readonly takeProfitPrice: number;
  readonly trailingStopPrice: number | null;
  readonly riskAmount: number;
  readonly entryReason: string;
  readonly entryFee: number;
  readonly fundingPnl: number;
  readonly currentPrice: number;
  readonly unrealizedPnl: number;
}

export interface PaperJournalTrade {
  readonly tradeId: string;
  readonly instrumentId: string;
  readonly direction: ManagedPositionDirection;
  readonly openedAt: number;
  readonly closedAt: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantityBaseUnits: number;
  readonly entryReason: string;
  readonly exitReason: string;
  readonly grossPnl: number;
  readonly fees: number;
  readonly fundingPnl: number;
  readonly netPnl: number;
  readonly riskAmount: number;
  readonly rMultiple: number | null;
  readonly durationMs: number;
}

export interface PaperAccountSnapshot {
  readonly startingEquity: number;
  readonly cashBalance: number;
  readonly equity: number;
  readonly unrealizedPnl: number;
  readonly realizedNetPnl: number;
  readonly peakEquity: number;
  readonly openPositions: readonly PaperManagedPosition[];
  readonly trades: readonly PaperJournalTrade[];
  readonly equityCurve: readonly EquityPoint[];
  readonly analytics: PerformanceAnalyticsReport;
  readonly liveExecutionAllowed: false;
}

const requireTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const requirePositiveFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
};

const requireNonNegativeFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative and finite`);
  }
};

const unrealized = (
  direction: ManagedPositionDirection,
  entryPrice: number,
  currentPrice: number,
  quantity: number,
): number =>
  (direction === 'LONG' ? currentPrice - entryPrice : entryPrice - currentPrice) *
  quantity;

const utcDay = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);

/**
 * Account and journal bookkeeping for paper/shadow execution.
 *
 * Fill realism remains the responsibility of PaperTradingEngine / ExecutionSimulator.
 * This class owns balance, mark-to-market equity, trade reasons and risk-normalized
 * performance so the dashboard and risk manager read one consistent state.
 */
export class PaperAccountLedger {
  private cashBalance: number;
  private peakEquity: number;
  private readonly positions = new Map<string, PaperManagedPosition>();
  private readonly trades: PaperJournalTrade[] = [];
  private readonly equityCurve: EquityPoint[] = [];

  public constructor(private readonly startingEquity: number) {
    requirePositiveFinite(startingEquity, 'startingEquity');
    this.cashBalance = startingEquity;
    this.peakEquity = startingEquity;
    this.recordEquity(0);
  }

  public openPosition(input: {
    readonly instrumentId: string;
    readonly direction: ManagedPositionDirection;
    readonly openedAt: number;
    readonly entryPrice: number;
    readonly quantityBaseUnits: number;
    readonly stopLossPrice: number;
    readonly takeProfitPrice: number;
    readonly trailingStopPrice?: number | null;
    readonly riskAmount: number;
    readonly entryReason: string;
    readonly entryFee: number;
  }): PaperManagedPosition {
    if (input.instrumentId.trim().length === 0) {
      throw new Error('instrumentId must not be empty');
    }
    if (this.positions.has(input.instrumentId)) {
      throw new Error(`position already exists for ${input.instrumentId}`);
    }
    requireTimestamp(input.openedAt, 'openedAt');
    requirePositiveFinite(input.entryPrice, 'entryPrice');
    requirePositiveFinite(input.quantityBaseUnits, 'quantityBaseUnits');
    requirePositiveFinite(input.stopLossPrice, 'stopLossPrice');
    requirePositiveFinite(input.takeProfitPrice, 'takeProfitPrice');
    requirePositiveFinite(input.riskAmount, 'riskAmount');
    requireNonNegativeFinite(input.entryFee, 'entryFee');
    if (input.entryReason.trim().length === 0) {
      throw new Error('entryReason must not be empty');
    }

    const position: PaperManagedPosition = {
      instrumentId: input.instrumentId,
      direction: input.direction,
      openedAt: input.openedAt,
      entryPrice: input.entryPrice,
      quantityBaseUnits: input.quantityBaseUnits,
      stopLossPrice: input.stopLossPrice,
      takeProfitPrice: input.takeProfitPrice,
      trailingStopPrice: input.trailingStopPrice ?? null,
      riskAmount: input.riskAmount,
      entryReason: input.entryReason,
      entryFee: input.entryFee,
      fundingPnl: 0,
      currentPrice: input.entryPrice,
      unrealizedPnl: 0,
    };
    this.cashBalance -= input.entryFee;
    this.positions.set(input.instrumentId, position);
    this.recordEquity(input.openedAt);
    return position;
  }

  public markPosition(input: {
    readonly instrumentId: string;
    readonly price: number;
    readonly timestamp: number;
    readonly trailingStopPrice?: number | null;
  }): PaperManagedPosition {
    const position = this.requirePosition(input.instrumentId);
    requirePositiveFinite(input.price, 'price');
    requireTimestamp(input.timestamp, 'timestamp');
    const updated: PaperManagedPosition = {
      ...position,
      currentPrice: input.price,
      trailingStopPrice:
        input.trailingStopPrice === undefined
          ? position.trailingStopPrice
          : input.trailingStopPrice,
      unrealizedPnl: unrealized(
        position.direction,
        position.entryPrice,
        input.price,
        position.quantityBaseUnits,
      ),
    };
    this.positions.set(input.instrumentId, updated);
    this.recordEquity(input.timestamp);
    return updated;
  }

  public applyFunding(input: {
    readonly instrumentId: string;
    readonly fundingPnl: number;
    readonly timestamp: number;
  }): PaperManagedPosition {
    const position = this.requirePosition(input.instrumentId);
    if (!Number.isFinite(input.fundingPnl)) {
      throw new Error('fundingPnl must be finite');
    }
    requireTimestamp(input.timestamp, 'timestamp');
    const updated = {
      ...position,
      fundingPnl: position.fundingPnl + input.fundingPnl,
    };
    this.cashBalance += input.fundingPnl;
    this.positions.set(input.instrumentId, updated);
    this.recordEquity(input.timestamp);
    return updated;
  }

  public closePosition(input: {
    readonly instrumentId: string;
    readonly exitPrice: number;
    readonly closedAt: number;
    readonly exitReason: string;
    readonly exitFee: number;
  }): PaperJournalTrade {
    const position = this.requirePosition(input.instrumentId);
    requirePositiveFinite(input.exitPrice, 'exitPrice');
    requireTimestamp(input.closedAt, 'closedAt');
    requireNonNegativeFinite(input.exitFee, 'exitFee');
    if (input.closedAt < position.openedAt) {
      throw new Error('closedAt must not precede openedAt');
    }
    if (input.exitReason.trim().length === 0) {
      throw new Error('exitReason must not be empty');
    }

    const grossPnl = unrealized(
      position.direction,
      position.entryPrice,
      input.exitPrice,
      position.quantityBaseUnits,
    );
    const fees = position.entryFee + input.exitFee;
    const netPnl = grossPnl - fees + position.fundingPnl;
    const trade: PaperJournalTrade = {
      tradeId: `${position.instrumentId}:${position.openedAt}:${input.closedAt}`,
      instrumentId: position.instrumentId,
      direction: position.direction,
      openedAt: position.openedAt,
      closedAt: input.closedAt,
      entryPrice: position.entryPrice,
      exitPrice: input.exitPrice,
      quantityBaseUnits: position.quantityBaseUnits,
      entryReason: position.entryReason,
      exitReason: input.exitReason,
      grossPnl,
      fees,
      fundingPnl: position.fundingPnl,
      netPnl,
      riskAmount: position.riskAmount,
      rMultiple: position.riskAmount > 0 ? netPnl / position.riskAmount : null,
      durationMs: input.closedAt - position.openedAt,
    };

    // Entry fee and funding were already applied to cash when they occurred.
    this.cashBalance += grossPnl - input.exitFee;
    this.positions.delete(input.instrumentId);
    this.trades.push(trade);
    this.recordEquity(input.closedAt);
    return trade;
  }

  public snapshot(timestamp = Date.now()): PaperAccountSnapshot {
    requireTimestamp(timestamp, 'timestamp');
    this.recordEquity(timestamp);
    const positions = [...this.positions.values()].sort((left, right) =>
      left.instrumentId.localeCompare(right.instrumentId),
    );
    const unrealizedPnl = positions.reduce(
      (sum, position) => sum + position.unrealizedPnl,
      0,
    );
    const equity = this.cashBalance + unrealizedPnl;
    const analytics = calculatePerformanceAnalytics({
      trades: this.trades.map((trade) => ({
        openedAt: trade.openedAt,
        closedAt: trade.closedAt,
        netPnl: trade.netPnl,
        riskAmount: trade.riskAmount,
      })),
      equityCurve: this.equityCurve,
    });
    return {
      startingEquity: this.startingEquity,
      cashBalance: this.cashBalance,
      equity,
      unrealizedPnl,
      realizedNetPnl: this.cashBalance - this.startingEquity,
      peakEquity: this.peakEquity,
      openPositions: positions,
      trades: this.trades.slice(),
      equityCurve: this.equityCurve.slice(),
      analytics,
      liveExecutionAllowed: false,
    };
  }

  public getRealizedPnlForDay(timestamp: number): number {
    requireTimestamp(timestamp, 'timestamp');
    const day = utcDay(timestamp);
    return this.trades
      .filter((trade) => utcDay(trade.closedAt) === day)
      .reduce((sum, trade) => sum + trade.netPnl, 0);
  }

  public getTradesForDay(timestamp: number): number {
    requireTimestamp(timestamp, 'timestamp');
    const day = utcDay(timestamp);
    return this.trades.filter((trade) => utcDay(trade.openedAt) === day).length;
  }

  public getOpenPosition(instrumentId: string): PaperManagedPosition | undefined {
    return this.positions.get(instrumentId);
  }

  private requirePosition(instrumentId: string): PaperManagedPosition {
    const position = this.positions.get(instrumentId);
    if (position === undefined) {
      throw new Error(`no open position for ${instrumentId}`);
    }
    return position;
  }

  private recordEquity(timestamp: number): void {
    const unrealizedPnl = [...this.positions.values()].reduce(
      (sum, position) => sum + position.unrealizedPnl,
      0,
    );
    const equity = this.cashBalance + unrealizedPnl;
    this.peakEquity = Math.max(this.peakEquity, equity);
    const last = this.equityCurve[this.equityCurve.length - 1];
    if (last?.timestamp === timestamp) {
      this.equityCurve[this.equityCurve.length - 1] = { timestamp, equity };
      return;
    }
    this.equityCurve.push({ timestamp, equity });
  }
}
