import {
  calculatePerformanceAnalytics,
  type EquityPoint,
  type PerformanceAnalyticsReport,
} from '../analytics/PerformanceAnalytics';
import type { TradingTimeframe } from '../config/tradingTimeframes';

export type ManagedPositionDirection = 'LONG' | 'SHORT';

export type PaperLedgerEventType =
  | 'FILL'
  | 'POSITION_OPEN'
  | 'POSITION_REDUCE'
  | 'POSITION_CLOSE'
  | 'FEE'
  | 'FUNDING'
  | 'STOP_UPDATE'
  | 'TARGET_UPDATE'
  | 'TRAILING_UPDATE'
  | 'RISK_STATE_UPDATE';

export interface PaperLedgerEvent {
  readonly eventId: string;
  readonly type: PaperLedgerEventType;
  readonly timestamp: number;
  readonly instrumentId: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PaperFillRecord {
  readonly fillId: string;
  readonly instrumentId: string;
  readonly side: 'BUY' | 'SELL';
  readonly timestamp: number;
  readonly quantityBaseUnits: number;
  readonly averagePrice: number;
  readonly fee: number;
  readonly slippageBps: number | null;
  readonly reduceOnly: boolean;
  readonly strategyId: string;
  readonly timeframe: TradingTimeframe;
}

export interface PaperFundingRecord {
  readonly fundingId: string;
  readonly instrumentId: string;
  readonly timestamp: number;
  readonly direction: ManagedPositionDirection;
  readonly positionNotional: number;
  readonly fundingRatePercent: number;
  readonly fundingPnl: number;
}

export interface PaperManagedPosition {
  readonly tradeId: string;
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
  readonly strategyId: string;
  readonly timeframe: TradingTimeframe;
  readonly entryFillId: string | null;
  readonly entrySlippageBps: number | null;
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
  readonly strategyId: string;
  readonly timeframe: TradingTimeframe;
  readonly entryFillId: string | null;
  readonly exitFillId: string | null;
  readonly entrySlippageBps: number | null;
  readonly exitSlippageBps: number | null;
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
  readonly fills: readonly PaperFillRecord[];
  readonly fundingEvents: readonly PaperFundingRecord[];
  readonly ledgerEvents: readonly PaperLedgerEvent[];
  readonly equityCurve: readonly EquityPoint[];
  readonly analytics: PerformanceAnalyticsReport;
  readonly liveExecutionAllowed: false;
}

export interface PaperAccountPersistedState {
  readonly schemaVersion: 1;
  readonly startingEquity: number;
  readonly cashBalance: number;
  readonly peakEquity: number;
  readonly openPositions: readonly PaperManagedPosition[];
  readonly trades: readonly PaperJournalTrade[];
  readonly fills: readonly PaperFillRecord[];
  readonly fundingEvents: readonly PaperFundingRecord[];
  readonly ledgerEvents: readonly PaperLedgerEvent[];
  readonly equityCurve: readonly EquityPoint[];
}

export interface PaperAccountRestoreResult {
  readonly positionsRestored: number;
  readonly tradesRestored: number;
  readonly fillsRestored: number;
  readonly fundingEventsRestored: number;
  readonly duplicateEvents: number;
  readonly warnings: readonly string[];
}

const EQUITY_SAMPLE_INTERVAL_MS = 60_000;
const MAXIMUM_EQUITY_CURVE_POINTS = 50_000;

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

const requireFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
};

const requireNonEmpty = (value: string, name: string): void => {
  if (value.trim().length === 0) throw new Error(`${name} must not be empty`);
};

const unrealized = (
  direction: ManagedPositionDirection,
  entryPrice: number,
  currentPrice: number,
  quantity: number,
): number =>
  (direction === 'LONG'
    ? currentPrice - entryPrice
    : entryPrice - currentPrice) * quantity;

const utcDay = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);

const approximatelyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(1e-8, Math.abs(right) * 1e-10);

const uniqueBy = <T>(
  values: readonly T[],
  key: (value: T) => string,
): { readonly values: T[]; readonly duplicates: number } => {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) {
      duplicates += 1;
      continue;
    }
    seen.add(identity);
    unique.push(value);
  }
  return { values: unique, duplicates };
};

const boundEquityCurve = (
  curve: readonly EquityPoint[],
): readonly EquityPoint[] => {
  if (curve.length <= MAXIMUM_EQUITY_CURVE_POINTS) return curve;
  const first = curve[0];
  if (first === undefined) return [];
  return [first, ...curve.slice(-(MAXIMUM_EQUITY_CURVE_POINTS - 1))];
};

/**
 * Account and journal bookkeeping for paper/shadow execution.
 *
 * Fill realism remains the responsibility of the execution simulator. This class
 * owns balance, positions, funding, the closed-trade journal and explicit durable
 * event identities. Runtime persistence uses exportState()/restoreState() rather
 * than serializing this class instance.
 */
export class PaperAccountLedger {
  private startingEquity: number;
  private cashBalance: number;
  private peakEquity: number;
  private readonly positions = new Map<string, PaperManagedPosition>();
  private readonly trades: PaperJournalTrade[] = [];
  private readonly fills: PaperFillRecord[] = [];
  private readonly fundingEvents: PaperFundingRecord[] = [];
  private readonly ledgerEvents: PaperLedgerEvent[] = [];
  private readonly fillIds = new Set<string>();
  private readonly fundingIds = new Set<string>();
  private readonly ledgerEventIds = new Set<string>();
  private readonly equityCurve: EquityPoint[] = [];

  public constructor(startingEquity: number) {
    requirePositiveFinite(startingEquity, 'startingEquity');
    this.startingEquity = startingEquity;
    this.cashBalance = startingEquity;
    this.peakEquity = startingEquity;
    this.recordEquity(0, true);
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
    readonly tradeId?: string;
    readonly strategyId?: string;
    readonly timeframe?: TradingTimeframe;
    readonly entryFillId?: string | null;
    readonly entrySlippageBps?: number | null;
  }): PaperManagedPosition {
    requireNonEmpty(input.instrumentId, 'instrumentId');
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
    requireNonEmpty(input.entryReason, 'entryReason');
    if (
      input.entrySlippageBps !== undefined &&
      input.entrySlippageBps !== null
    ) {
      requireFinite(input.entrySlippageBps, 'entrySlippageBps');
    }

    const tradeId =
      input.tradeId ?? `paper:${input.instrumentId}:${input.openedAt}`;
    const strategyId = input.strategyId ?? 'legacy-paper';
    requireNonEmpty(tradeId, 'tradeId');
    requireNonEmpty(strategyId, 'strategyId');
    const position: PaperManagedPosition = {
      tradeId,
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
      strategyId,
      timeframe: input.timeframe ?? '1m',
      entryFillId: input.entryFillId ?? null,
      entrySlippageBps: input.entrySlippageBps ?? null,
    };
    this.cashBalance -= input.entryFee;
    this.positions.set(input.instrumentId, position);
    this.recordEquity(input.openedAt, true);
    return position;
  }

  public openPositionFromFill(input: {
    readonly fillId: string;
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
    readonly slippageBps: number | null;
    readonly strategyId: string;
    readonly timeframe: TradingTimeframe;
    readonly tradeId: string;
  }): {
    readonly applied: boolean;
    readonly position: PaperManagedPosition | null;
  } {
    requireNonEmpty(input.fillId, 'fillId');
    if (this.fillIds.has(input.fillId)) {
      return {
        applied: false,
        position: this.positions.get(input.instrumentId) ?? null,
      };
    }
    if (input.slippageBps !== null)
      requireFinite(input.slippageBps, 'slippageBps');
    const position = this.openPosition({
      ...input,
      entryFillId: input.fillId,
      entrySlippageBps: input.slippageBps,
    });
    const fill: PaperFillRecord = {
      fillId: input.fillId,
      instrumentId: input.instrumentId,
      side: input.direction === 'LONG' ? 'BUY' : 'SELL',
      timestamp: input.openedAt,
      quantityBaseUnits: input.quantityBaseUnits,
      averagePrice: input.entryPrice,
      fee: input.entryFee,
      slippageBps: input.slippageBps,
      reduceOnly: false,
      strategyId: input.strategyId,
      timeframe: input.timeframe,
    };
    this.fills.push(fill);
    this.fillIds.add(fill.fillId);
    this.recordAuditEvent({
      eventId: `fill:${fill.fillId}`,
      type: 'FILL',
      timestamp: fill.timestamp,
      instrumentId: fill.instrumentId,
      details: {
        side: fill.side,
        quantityBaseUnits: fill.quantityBaseUnits,
        averagePrice: fill.averagePrice,
        reduceOnly: false,
      },
    });
    if (fill.fee > 0) {
      this.recordAuditEvent({
        eventId: `fee:${fill.fillId}`,
        type: 'FEE',
        timestamp: fill.timestamp,
        instrumentId: fill.instrumentId,
        details: { amount: fill.fee, stage: 'ENTRY' },
      });
    }
    this.recordAuditEvent({
      eventId: `position-open:${input.tradeId}`,
      type: 'POSITION_OPEN',
      timestamp: input.openedAt,
      instrumentId: input.instrumentId,
      details: {
        tradeId: input.tradeId,
        direction: input.direction,
        quantityBaseUnits: input.quantityBaseUnits,
        entryPrice: input.entryPrice,
        strategyId: input.strategyId,
        timeframe: input.timeframe,
      },
    });
    this.recordAuditEvent({
      eventId: `stop:${input.tradeId}:${input.openedAt}`,
      type: 'STOP_UPDATE',
      timestamp: input.openedAt,
      instrumentId: input.instrumentId,
      details: { stopLossPrice: input.stopLossPrice },
    });
    this.recordAuditEvent({
      eventId: `target:${input.tradeId}:${input.openedAt}`,
      type: 'TARGET_UPDATE',
      timestamp: input.openedAt,
      instrumentId: input.instrumentId,
      details: { takeProfitPrice: input.takeProfitPrice },
    });
    return { applied: true, position };
  }

  public markPosition(input: {
    readonly instrumentId: string;
    readonly price: number;
    readonly timestamp: number;
    readonly trailingStopPrice?: number | null;
    readonly auditEventId?: string;
  }): PaperManagedPosition {
    const position = this.requirePosition(input.instrumentId);
    requirePositiveFinite(input.price, 'price');
    requireTimestamp(input.timestamp, 'timestamp');
    const nextTrailing =
      input.trailingStopPrice === undefined
        ? position.trailingStopPrice
        : input.trailingStopPrice;
    if (nextTrailing !== null)
      requirePositiveFinite(nextTrailing, 'trailingStopPrice');
    const updated: PaperManagedPosition = {
      ...position,
      currentPrice: input.price,
      trailingStopPrice: nextTrailing,
      unrealizedPnl: unrealized(
        position.direction,
        position.entryPrice,
        input.price,
        position.quantityBaseUnits,
      ),
    };
    this.positions.set(input.instrumentId, updated);
    if (
      input.auditEventId !== undefined &&
      nextTrailing !== position.trailingStopPrice
    ) {
      this.recordAuditEvent({
        eventId: input.auditEventId,
        type: 'TRAILING_UPDATE',
        timestamp: input.timestamp,
        instrumentId: input.instrumentId,
        details: { trailingStopPrice: nextTrailing },
      });
    }
    this.recordEquity(input.timestamp);
    return updated;
  }

  public applyFunding(input: {
    readonly instrumentId: string;
    readonly fundingPnl: number;
    readonly timestamp: number;
  }): PaperManagedPosition {
    const position = this.requirePosition(input.instrumentId);
    requireFinite(input.fundingPnl, 'fundingPnl');
    requireTimestamp(input.timestamp, 'timestamp');
    const updated = {
      ...position,
      fundingPnl: position.fundingPnl + input.fundingPnl,
    };
    this.cashBalance += input.fundingPnl;
    this.positions.set(input.instrumentId, updated);
    this.recordEquity(input.timestamp, true);
    return updated;
  }

  public applyFundingEvent(input: {
    readonly fundingId: string;
    readonly instrumentId: string;
    readonly fundingPnl: number;
    readonly fundingRatePercent: number;
    readonly positionNotional: number;
    readonly timestamp: number;
  }): {
    readonly applied: boolean;
    readonly position: PaperManagedPosition | null;
  } {
    requireNonEmpty(input.fundingId, 'fundingId');
    if (this.fundingIds.has(input.fundingId)) {
      return {
        applied: false,
        position: this.positions.get(input.instrumentId) ?? null,
      };
    }
    const position = this.positions.get(input.instrumentId);
    if (position === undefined) return { applied: false, position: null };
    requireFinite(input.fundingRatePercent, 'fundingRatePercent');
    requirePositiveFinite(input.positionNotional, 'positionNotional');
    const updated = this.applyFunding(input);
    const record: PaperFundingRecord = {
      fundingId: input.fundingId,
      instrumentId: input.instrumentId,
      timestamp: input.timestamp,
      direction: position.direction,
      positionNotional: input.positionNotional,
      fundingRatePercent: input.fundingRatePercent,
      fundingPnl: input.fundingPnl,
    };
    this.fundingEvents.push(record);
    this.fundingIds.add(record.fundingId);
    this.recordAuditEvent({
      eventId: `funding:${record.fundingId}`,
      type: 'FUNDING',
      timestamp: record.timestamp,
      instrumentId: record.instrumentId,
      details: {
        direction: record.direction,
        positionNotional: record.positionNotional,
        fundingRatePercent: record.fundingRatePercent,
        fundingPnl: record.fundingPnl,
      },
    });
    return { applied: true, position: updated };
  }

  public closePosition(input: {
    readonly instrumentId: string;
    readonly exitPrice: number;
    readonly closedAt: number;
    readonly exitReason: string;
    readonly exitFee: number;
    readonly exitFillId?: string | null;
    readonly exitSlippageBps?: number | null;
  }): PaperJournalTrade {
    const position = this.requirePosition(input.instrumentId);
    requirePositiveFinite(input.exitPrice, 'exitPrice');
    requireTimestamp(input.closedAt, 'closedAt');
    requireNonNegativeFinite(input.exitFee, 'exitFee');
    if (input.exitSlippageBps !== undefined && input.exitSlippageBps !== null) {
      requireFinite(input.exitSlippageBps, 'exitSlippageBps');
    }
    if (input.closedAt < position.openedAt) {
      throw new Error('closedAt must not precede openedAt');
    }
    requireNonEmpty(input.exitReason, 'exitReason');

    const grossPnl = unrealized(
      position.direction,
      position.entryPrice,
      input.exitPrice,
      position.quantityBaseUnits,
    );
    const fees = position.entryFee + input.exitFee;
    const netPnl = grossPnl - fees + position.fundingPnl;
    const trade: PaperJournalTrade = {
      tradeId: position.tradeId,
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
      strategyId: position.strategyId,
      timeframe: position.timeframe,
      entryFillId: position.entryFillId,
      exitFillId: input.exitFillId ?? null,
      entrySlippageBps: position.entrySlippageBps,
      exitSlippageBps: input.exitSlippageBps ?? null,
    };

    // Entry fee and funding were already applied to cash when they occurred.
    this.cashBalance += grossPnl - input.exitFee;
    this.positions.delete(input.instrumentId);
    this.trades.push(trade);
    this.recordEquity(input.closedAt, true);
    return trade;
  }

  public closePositionFromFill(input: {
    readonly fillId: string;
    readonly instrumentId: string;
    readonly exitPrice: number;
    readonly quantityBaseUnits: number;
    readonly closedAt: number;
    readonly exitReason: string;
    readonly exitFee: number;
    readonly slippageBps: number | null;
  }): {
    readonly applied: boolean;
    readonly trade: PaperJournalTrade | null;
    readonly remainingPosition: PaperManagedPosition | null;
  } {
    requireNonEmpty(input.fillId, 'fillId');
    if (this.fillIds.has(input.fillId)) {
      return {
        applied: false,
        trade:
          this.trades.find((trade) => trade.exitFillId === input.fillId) ??
          null,
        remainingPosition: this.positions.get(input.instrumentId) ?? null,
      };
    }
    const position = this.requirePosition(input.instrumentId);
    requirePositiveFinite(input.exitPrice, 'exitPrice');
    requirePositiveFinite(input.quantityBaseUnits, 'quantityBaseUnits');
    requireTimestamp(input.closedAt, 'closedAt');
    requireNonEmpty(input.exitReason, 'exitReason');
    requireNonNegativeFinite(input.exitFee, 'exitFee');
    if (input.closedAt < position.openedAt) {
      throw new Error('closedAt must not precede openedAt');
    }
    if (input.quantityBaseUnits > position.quantityBaseUnits + Number.EPSILON) {
      throw new Error('closing fill exceeds the open paper position');
    }
    if (input.slippageBps !== null)
      requireFinite(input.slippageBps, 'slippageBps');
    const closingQuantity = Math.min(
      input.quantityBaseUnits,
      position.quantityBaseUnits,
    );
    const closingFraction = closingQuantity / position.quantityBaseUnits;
    const fullyClosed =
      position.quantityBaseUnits - closingQuantity <= Number.EPSILON;
    const allocatedEntryFee = position.entryFee * closingFraction;
    const allocatedFundingPnl = position.fundingPnl * closingFraction;
    const allocatedRiskAmount = position.riskAmount * closingFraction;
    const grossPnl = unrealized(
      position.direction,
      position.entryPrice,
      input.exitPrice,
      closingQuantity,
    );
    const fees = allocatedEntryFee + input.exitFee;
    const netPnl = grossPnl - fees + allocatedFundingPnl;
    const trade: PaperJournalTrade = {
      tradeId: fullyClosed
        ? position.tradeId
        : `${position.tradeId}:partial:${input.fillId}`,
      instrumentId: position.instrumentId,
      direction: position.direction,
      openedAt: position.openedAt,
      closedAt: input.closedAt,
      entryPrice: position.entryPrice,
      exitPrice: input.exitPrice,
      quantityBaseUnits: closingQuantity,
      entryReason: position.entryReason,
      exitReason: input.exitReason,
      grossPnl,
      fees,
      fundingPnl: allocatedFundingPnl,
      netPnl,
      riskAmount: allocatedRiskAmount,
      rMultiple: allocatedRiskAmount > 0 ? netPnl / allocatedRiskAmount : null,
      durationMs: input.closedAt - position.openedAt,
      strategyId: position.strategyId,
      timeframe: position.timeframe,
      entryFillId: position.entryFillId,
      exitFillId: input.fillId,
      entrySlippageBps: position.entrySlippageBps,
      exitSlippageBps: input.slippageBps,
    };
    this.cashBalance += grossPnl - input.exitFee;
    this.trades.push(trade);

    const remainingPosition: PaperManagedPosition | null = fullyClosed
      ? null
      : {
          ...position,
          quantityBaseUnits: position.quantityBaseUnits - closingQuantity,
          entryFee: position.entryFee - allocatedEntryFee,
          fundingPnl: position.fundingPnl - allocatedFundingPnl,
          riskAmount: position.riskAmount - allocatedRiskAmount,
          unrealizedPnl: unrealized(
            position.direction,
            position.entryPrice,
            position.currentPrice,
            position.quantityBaseUnits - closingQuantity,
          ),
        };
    if (remainingPosition === null) {
      this.positions.delete(input.instrumentId);
    } else {
      this.positions.set(input.instrumentId, remainingPosition);
    }
    this.recordEquity(input.closedAt, true);

    const fill: PaperFillRecord = {
      fillId: input.fillId,
      instrumentId: input.instrumentId,
      side: position.direction === 'LONG' ? 'SELL' : 'BUY',
      timestamp: input.closedAt,
      quantityBaseUnits: closingQuantity,
      averagePrice: input.exitPrice,
      fee: input.exitFee,
      slippageBps: input.slippageBps,
      reduceOnly: true,
      strategyId: position.strategyId,
      timeframe: position.timeframe,
    };
    this.fills.push(fill);
    this.fillIds.add(fill.fillId);
    this.recordAuditEvent({
      eventId: `fill:${fill.fillId}`,
      type: 'FILL',
      timestamp: fill.timestamp,
      instrumentId: fill.instrumentId,
      details: {
        side: fill.side,
        quantityBaseUnits: fill.quantityBaseUnits,
        averagePrice: fill.averagePrice,
        reduceOnly: true,
      },
    });
    if (fill.fee > 0) {
      this.recordAuditEvent({
        eventId: `fee:${fill.fillId}`,
        type: 'FEE',
        timestamp: fill.timestamp,
        instrumentId: fill.instrumentId,
        details: { amount: fill.fee, stage: 'EXIT' },
      });
    }
    this.recordAuditEvent({
      eventId: `${fullyClosed ? 'position-close' : 'position-reduce'}:${trade.tradeId}:${input.closedAt}`,
      type: fullyClosed ? 'POSITION_CLOSE' : 'POSITION_REDUCE',
      timestamp: input.closedAt,
      instrumentId: input.instrumentId,
      details: {
        tradeId: trade.tradeId,
        exitPrice: trade.exitPrice,
        exitReason: trade.exitReason,
        netPnl: trade.netPnl,
        remainingQuantityBaseUnits: remainingPosition?.quantityBaseUnits ?? 0,
      },
    });
    return { applied: true, trade, remainingPosition };
  }

  public recordAuditEvent(event: PaperLedgerEvent): boolean {
    requireNonEmpty(event.eventId, 'eventId');
    requireNonEmpty(event.instrumentId, 'instrumentId');
    requireTimestamp(event.timestamp, 'timestamp');
    if (this.ledgerEventIds.has(event.eventId)) return false;
    this.ledgerEvents.push({ ...event, details: { ...event.details } });
    this.ledgerEventIds.add(event.eventId);
    return true;
  }

  public snapshot(timestamp = Date.now()): PaperAccountSnapshot {
    requireTimestamp(timestamp, 'timestamp');
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
      fills: this.fills.slice(),
      fundingEvents: this.fundingEvents.slice(),
      ledgerEvents: this.ledgerEvents.slice(),
      equityCurve: this.equityCurve.slice(),
      analytics,
      liveExecutionAllowed: false,
    };
  }

  public exportState(): PaperAccountPersistedState {
    return {
      schemaVersion: 1,
      startingEquity: this.startingEquity,
      cashBalance: this.cashBalance,
      peakEquity: this.peakEquity,
      openPositions: [...this.positions.values()].map((position) => ({
        ...position,
      })),
      trades: this.trades.map((trade) => ({ ...trade })),
      fills: this.fills.map((fill) => ({ ...fill })),
      fundingEvents: this.fundingEvents.map((event) => ({ ...event })),
      ledgerEvents: this.ledgerEvents.map((event) => ({
        ...event,
        details: { ...event.details },
      })),
      equityCurve: this.equityCurve.map((point) => ({ ...point })),
    };
  }

  public restoreState(
    state: PaperAccountPersistedState,
  ): PaperAccountRestoreResult {
    if (state.schemaVersion !== 1)
      throw new Error('unsupported paper account schema');
    requirePositiveFinite(state.startingEquity, 'persisted.startingEquity');
    requireFinite(state.cashBalance, 'persisted.cashBalance');
    requirePositiveFinite(state.peakEquity, 'persisted.peakEquity');

    const warnings: string[] = [];
    const uniqueTrades = uniqueBy(state.trades, (trade) => trade.tradeId);
    const uniqueFills = uniqueBy(state.fills, (fill) => fill.fillId);
    const uniqueFunding = uniqueBy(
      state.fundingEvents,
      (event) => event.fundingId,
    );
    const uniqueEvents = uniqueBy(state.ledgerEvents, (event) => event.eventId);
    const duplicateEvents =
      uniqueTrades.duplicates +
      uniqueFills.duplicates +
      uniqueFunding.duplicates +
      uniqueEvents.duplicates;
    if (duplicateEvents > 0) {
      warnings.push(
        `Removed ${duplicateEvents} duplicate persisted event records`,
      );
    }

    const positionIds = new Set<string>();
    const restoredPositions: PaperManagedPosition[] = [];
    for (const position of state.openPositions) {
      requireNonEmpty(position.instrumentId, 'persisted.position.instrumentId');
      if (positionIds.has(position.instrumentId)) {
        throw new Error(
          `duplicate persisted position for ${position.instrumentId}`,
        );
      }
      positionIds.add(position.instrumentId);
      requirePositiveFinite(
        position.entryPrice,
        'persisted.position.entryPrice',
      );
      requirePositiveFinite(
        position.quantityBaseUnits,
        'persisted.position.quantityBaseUnits',
      );
      requirePositiveFinite(
        position.currentPrice,
        'persisted.position.currentPrice',
      );
      requireTimestamp(position.openedAt, 'persisted.position.openedAt');
      const calculatedUnrealized = unrealized(
        position.direction,
        position.entryPrice,
        position.currentPrice,
        position.quantityBaseUnits,
      );
      if (!approximatelyEqual(calculatedUnrealized, position.unrealizedPnl)) {
        warnings.push(
          `Recalculated unrealized PnL for ${position.instrumentId} during recovery`,
        );
      }
      restoredPositions.push({
        ...position,
        unrealizedPnl: calculatedUnrealized,
      });
    }

    const restoredTrades = uniqueTrades.values.map((trade) => {
      const calculatedNet = trade.grossPnl - trade.fees + trade.fundingPnl;
      if (!approximatelyEqual(calculatedNet, trade.netPnl)) {
        warnings.push(`Recalculated net PnL for trade ${trade.tradeId}`);
      }
      return {
        ...trade,
        netPnl: calculatedNet,
        rMultiple:
          trade.riskAmount > 0 ? calculatedNet / trade.riskAmount : null,
      };
    });

    const curveByTimestamp = new Map<number, EquityPoint>();
    for (const point of state.equityCurve) {
      requireTimestamp(point.timestamp, 'persisted.equityCurve.timestamp');
      requireFinite(point.equity, 'persisted.equityCurve.equity');
      if (curveByTimestamp.has(point.timestamp)) {
        warnings.push(`Collapsed duplicate equity point at ${point.timestamp}`);
      }
      curveByTimestamp.set(point.timestamp, { ...point });
    }
    const restoredCurve = [...curveByTimestamp.values()].sort(
      (left, right) => left.timestamp - right.timestamp,
    );
    const restoredPeakEquity = restoredCurve.reduce(
      (peak, point) => Math.max(peak, point.equity),
      state.startingEquity,
    );
    const boundedRestoredCurve = boundEquityCurve(restoredCurve);
    if (boundedRestoredCurve.length < restoredCurve.length) {
      warnings.push(
        `Trimmed persisted equity curve from ${restoredCurve.length} to ${boundedRestoredCurve.length} points`,
      );
    }

    const derivedCash =
      state.startingEquity +
      restoredTrades.reduce((sum, trade) => sum + trade.netPnl, 0) +
      restoredPositions.reduce(
        (sum, position) => sum - position.entryFee + position.fundingPnl,
        0,
      );
    if (!approximatelyEqual(derivedCash, state.cashBalance)) {
      warnings.push(
        `Persisted cash ${state.cashBalance} disagreed with ledger-derived cash ${derivedCash}; ledger value used`,
      );
    }

    this.startingEquity = state.startingEquity;
    this.cashBalance = derivedCash;
    this.positions.clear();
    for (const position of restoredPositions) {
      this.positions.set(position.instrumentId, position);
    }
    this.trades.splice(0, this.trades.length, ...restoredTrades);
    this.fills.splice(
      0,
      this.fills.length,
      ...uniqueFills.values.map((fill) => ({ ...fill })),
    );
    this.fundingEvents.splice(
      0,
      this.fundingEvents.length,
      ...uniqueFunding.values.map((event) => ({ ...event })),
    );
    this.ledgerEvents.splice(
      0,
      this.ledgerEvents.length,
      ...uniqueEvents.values.map((event) => ({
        ...event,
        details: { ...event.details },
      })),
    );
    this.fillIds.clear();
    for (const fill of this.fills) this.fillIds.add(fill.fillId);
    this.fundingIds.clear();
    for (const event of this.fundingEvents)
      this.fundingIds.add(event.fundingId);
    this.ledgerEventIds.clear();
    for (const event of this.ledgerEvents)
      this.ledgerEventIds.add(event.eventId);
    this.equityCurve.splice(
      0,
      this.equityCurve.length,
      ...boundedRestoredCurve,
    );

    const currentUnrealized = restoredPositions.reduce(
      (sum, position) => sum + position.unrealizedPnl,
      0,
    );
    const currentEquity = this.cashBalance + currentUnrealized;
    this.peakEquity = Math.max(
      state.startingEquity,
      currentEquity,
      restoredPeakEquity,
    );
    if (!approximatelyEqual(this.peakEquity, state.peakEquity)) {
      warnings.push('Recalculated peak equity from persisted equity evidence');
    }
    if (this.equityCurve.length === 0) this.recordEquity(0, true);

    return {
      positionsRestored: restoredPositions.length,
      tradesRestored: restoredTrades.length,
      fillsRestored: this.fills.length,
      fundingEventsRestored: this.fundingEvents.length,
      duplicateEvents,
      warnings,
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

  public getOpenPosition(
    instrumentId: string,
  ): PaperManagedPosition | undefined {
    return this.positions.get(instrumentId);
  }

  public hasProcessedFill(fillId: string): boolean {
    return this.fillIds.has(fillId);
  }

  public hasProcessedFunding(fundingId: string): boolean {
    return this.fundingIds.has(fundingId);
  }

  private requirePosition(instrumentId: string): PaperManagedPosition {
    const position = this.positions.get(instrumentId);
    if (position === undefined) {
      throw new Error(`no open position for ${instrumentId}`);
    }
    return position;
  }

  private recordEquity(timestamp: number, force = false): void {
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
    if (
      !force &&
      last !== undefined &&
      timestamp > last.timestamp &&
      timestamp - last.timestamp < EQUITY_SAMPLE_INTERVAL_MS
    ) {
      return;
    }
    this.equityCurve.push({ timestamp, equity });
    if (this.equityCurve.length > MAXIMUM_EQUITY_CURVE_POINTS) {
      const excess = this.equityCurve.length - MAXIMUM_EQUITY_CURVE_POINTS;
      // Preserve the original starting point while retaining the most recent
      // bounded history needed by dashboard and performance analytics.
      this.equityCurve.splice(1, excess);
    }
  }
}
