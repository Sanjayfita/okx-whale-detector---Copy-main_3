import {
  simulateMarketOrder,
  type ExecutionOrderBook,
  type ExecutionSimulationPolicy,
  type MarketOrderSide,
} from '../backtest/ExecutionSimulator';

export interface PaperContractSpecification {
  readonly instrumentId: string;
  readonly tickSize: number;
  readonly lotSize: number;
  readonly minimumContracts: number;
  readonly maximumLeverage: number;
  readonly contractValue: number;
}

export interface PaperOrderIntent {
  readonly orderId: string;
  readonly instrumentId: string;
  readonly submittedAt: number;
  readonly side: MarketOrderSide;
  readonly orderType: 'MARKET' | 'LIMIT';
  readonly requestedContracts: number;
  readonly limitPrice: number | null;
  readonly reduceOnly: boolean;
}

export interface PaperOrderPolicy {
  readonly maximumRetries: number;
  readonly retryDelayMs: number;
  readonly rejectStaleBookAfterMs: number;
  readonly execution: ExecutionSimulationPolicy;
}

export interface PaperOrderResult {
  readonly orderId: string;
  readonly status:
    | 'FILLED'
    | 'PARTIALLY_FILLED'
    | 'REJECTED'
    | 'RETRY_EXHAUSTED';
  readonly normalizedContracts: number;
  readonly normalizedLimitPrice: number | null;
  readonly filledContracts: number;
  readonly averagePrice: number | null;
  readonly fee: number;
  readonly slippageBps: number | null;
  readonly attempts: number;
  readonly simulatedLatencyMs: number;
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

export interface PaperPosition {
  readonly instrumentId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly contracts: number;
  readonly averageEntryPrice: number;
  readonly leverage: number;
  readonly openedAt: number;
  readonly accumulatedFundingPnl: number;
}

export interface PaperClosedTrade {
  readonly tradeId: string;
  readonly instrumentId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly openedAt: number;
  readonly closedAt: number;
  readonly contracts: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly grossPnl: number;
  readonly fees: number;
  readonly fundingPnl: number;
  readonly netPnl: number;
}

export interface PaperDailyReport {
  readonly day: string;
  readonly submittedOrders: number;
  readonly filledOrders: number;
  readonly partiallyFilledOrders: number;
  readonly rejectedOrders: number;
  readonly retryExhaustedOrders: number;
  readonly closedTrades: number;
  readonly grossPnl: number;
  readonly fees: number;
  readonly fundingPnl: number;
  readonly netPnl: number;
  readonly openPositions: number;
  readonly liveExecutionAllowed: false;
}

export const DEFAULT_PAPER_ORDER_POLICY: PaperOrderPolicy = {
  maximumRetries: 3,
  retryDelayMs: 250,
  rejectStaleBookAfterMs: 2_000,
  execution: {
    takerFeeBps: 5,
    maxLevelParticipationRate: 0.25,
    latencyMs: 150,
    adverseLatencyBpsPerSecond: 1,
    minimumFillRatio: 0.95,
  },
};

const requirePositive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
};

const requireTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const decimalPlaces = (value: number): number => {
  const text = value.toString().toLowerCase();
  if (text.includes('e-')) {
    return Number(text.split('e-')[1] ?? 0);
  }
  return text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0;
};

const floorToIncrement = (value: number, increment: number): number => {
  const precision = Math.min(15, decimalPlaces(increment));
  const units = Math.floor((value + Number.EPSILON) / increment);
  return Number((units * increment).toFixed(precision));
};

const roundPriceForSide = (
  price: number,
  tickSize: number,
  side: MarketOrderSide,
): number => {
  const precision = Math.min(15, decimalPlaces(tickSize));
  const rawUnits = price / tickSize;
  const units = side === 'BUY' ? Math.floor(rawUnits) : Math.ceil(rawUnits);
  return Number((units * tickSize).toFixed(precision));
};

const validateSpecification = (specification: PaperContractSpecification): void => {
  if (specification.instrumentId.trim().length === 0) {
    throw new Error('instrumentId must not be empty');
  }
  requirePositive(specification.tickSize, 'tickSize');
  requirePositive(specification.lotSize, 'lotSize');
  requirePositive(specification.minimumContracts, 'minimumContracts');
  requirePositive(specification.maximumLeverage, 'maximumLeverage');
  requirePositive(specification.contractValue, 'contractValue');
};

const validatePolicy = (policy: PaperOrderPolicy): void => {
  if (!Number.isSafeInteger(policy.maximumRetries) || policy.maximumRetries < 0) {
    throw new Error('maximumRetries must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(policy.retryDelayMs) || policy.retryDelayMs < 0) {
    throw new Error('retryDelayMs must be a non-negative safe integer');
  }
  if (
    !Number.isSafeInteger(policy.rejectStaleBookAfterMs) ||
    policy.rejectStaleBookAfterMs < 0
  ) {
    throw new Error('rejectStaleBookAfterMs must be a non-negative safe integer');
  }
};

const isMarketableLimit = (input: {
  readonly side: MarketOrderSide;
  readonly limitPrice: number;
  readonly book: ExecutionOrderBook;
}): boolean => {
  const bestAsk = input.book.asks
    .filter((level) => level.price > 0 && level.quantity > 0)
    .sort((left, right) => left.price - right.price)[0]?.price;
  const bestBid = input.book.bids
    .filter((level) => level.price > 0 && level.quantity > 0)
    .sort((left, right) => right.price - left.price)[0]?.price;
  return input.side === 'BUY'
    ? bestAsk !== undefined && input.limitPrice >= bestAsk
    : bestBid !== undefined && input.limitPrice <= bestBid;
};

const dayKey = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);

export class PaperTradingEngine {
  private readonly orders: PaperOrderResult[] = [];
  private readonly orderTimes = new Map<string, number>();
  private readonly positions = new Map<string, PaperPosition>();
  private readonly closedTrades: PaperClosedTrade[] = [];

  public constructor(private readonly policy: PaperOrderPolicy = DEFAULT_PAPER_ORDER_POLICY) {
    validatePolicy(policy);
  }

  public submitOrder(input: {
    readonly intent: PaperOrderIntent;
    readonly specification: PaperContractSpecification;
    readonly book: ExecutionOrderBook;
    readonly now: number;
    readonly transientFailuresBeforeAcceptance?: number;
  }): PaperOrderResult {
    validateSpecification(input.specification);
    requireTimestamp(input.intent.submittedAt, 'intent.submittedAt');
    requireTimestamp(input.book.observedAt, 'book.observedAt');
    requireTimestamp(input.now, 'now');
    if (input.intent.orderId.trim().length === 0) {
      throw new Error('orderId must not be empty');
    }
    if (this.orderTimes.has(input.intent.orderId)) {
      throw new Error(`duplicate orderId ${input.intent.orderId}`);
    }
    if (input.intent.instrumentId !== input.specification.instrumentId) {
      return this.recordOrder(input.intent, {
        orderId: input.intent.orderId,
        status: 'REJECTED',
        normalizedContracts: 0,
        normalizedLimitPrice: null,
        filledContracts: 0,
        averagePrice: null,
        fee: 0,
        slippageBps: null,
        attempts: 1,
        simulatedLatencyMs: 0,
        rejectionReasons: ['INSTRUMENT_SPECIFICATION_MISMATCH'],
        liveExecutionAllowed: false,
      });
    }

    const normalizedContracts = floorToIncrement(
      input.intent.requestedContracts,
      input.specification.lotSize,
    );
    const normalizedLimitPrice =
      input.intent.limitPrice === null
        ? null
        : roundPriceForSide(
            input.intent.limitPrice,
            input.specification.tickSize,
            input.intent.side,
          );
    const validationReasons: string[] = [];
    if (
      !Number.isFinite(input.intent.requestedContracts) ||
      normalizedContracts < input.specification.minimumContracts
    ) {
      validationReasons.push('BELOW_MINIMUM_CONTRACTS');
    }
    if (input.now - input.book.observedAt > this.policy.rejectStaleBookAfterMs) {
      validationReasons.push('STALE_ORDER_BOOK');
    }
    if (input.intent.orderType === 'LIMIT') {
      if (normalizedLimitPrice === null || normalizedLimitPrice <= 0) {
        validationReasons.push('INVALID_LIMIT_PRICE');
      } else if (
        !isMarketableLimit({
          side: input.intent.side,
          limitPrice: normalizedLimitPrice,
          book: input.book,
        })
      ) {
        validationReasons.push('NON_MARKETABLE_LIMIT_NOT_SIMULATED');
      }
    }
    if (validationReasons.length > 0) {
      return this.recordOrder(input.intent, {
        orderId: input.intent.orderId,
        status: 'REJECTED',
        normalizedContracts,
        normalizedLimitPrice,
        filledContracts: 0,
        averagePrice: null,
        fee: 0,
        slippageBps: null,
        attempts: 1,
        simulatedLatencyMs: 0,
        rejectionReasons: validationReasons,
        liveExecutionAllowed: false,
      });
    }

    const transientFailures = Math.max(
      0,
      Math.floor(input.transientFailuresBeforeAcceptance ?? 0),
    );
    const maximumAttempts = this.policy.maximumRetries + 1;
    const attempts = Math.min(maximumAttempts, transientFailures + 1);
    if (transientFailures >= maximumAttempts) {
      return this.recordOrder(input.intent, {
        orderId: input.intent.orderId,
        status: 'RETRY_EXHAUSTED',
        normalizedContracts,
        normalizedLimitPrice,
        filledContracts: 0,
        averagePrice: null,
        fee: 0,
        slippageBps: null,
        attempts: maximumAttempts,
        simulatedLatencyMs:
          this.policy.execution.latencyMs +
          this.policy.retryDelayMs * this.policy.maximumRetries,
        rejectionReasons: ['TRANSIENT_API_FAILURES_EXHAUSTED'],
        liveExecutionAllowed: false,
      });
    }

    const fill = simulateMarketOrder({
      side: input.intent.side,
      quantity: normalizedContracts,
      book: input.book,
      policy: {
        ...this.policy.execution,
        latencyMs:
          this.policy.execution.latencyMs +
          this.policy.retryDelayMs * transientFailures,
      },
    });
    return this.recordOrder(input.intent, {
      orderId: input.intent.orderId,
      status: fill.status,
      normalizedContracts,
      normalizedLimitPrice,
      filledContracts: fill.filledQuantity,
      averagePrice: fill.averagePrice,
      fee: fill.fee,
      slippageBps: fill.slippageBps,
      attempts,
      simulatedLatencyMs:
        this.policy.execution.latencyMs +
        this.policy.retryDelayMs * transientFailures,
      rejectionReasons: fill.rejectionReasons,
      liveExecutionAllowed: false,
    });
  }

  public openPosition(input: {
    readonly order: PaperOrderResult;
    readonly instrumentId: string;
    readonly direction: 'LONG' | 'SHORT';
    readonly leverage: number;
    readonly openedAt: number;
  }): PaperPosition {
    if (
      input.order.status === 'REJECTED' ||
      input.order.status === 'RETRY_EXHAUSTED' ||
      input.order.averagePrice === null ||
      input.order.filledContracts <= 0
    ) {
      throw new Error('Only filled paper orders can open positions');
    }
    requirePositive(input.leverage, 'leverage');
    requireTimestamp(input.openedAt, 'openedAt');
    if (this.positions.has(input.instrumentId)) {
      throw new Error(`position already exists for ${input.instrumentId}`);
    }
    const position: PaperPosition = {
      instrumentId: input.instrumentId,
      direction: input.direction,
      contracts: input.order.filledContracts,
      averageEntryPrice: input.order.averagePrice,
      leverage: input.leverage,
      openedAt: input.openedAt,
      accumulatedFundingPnl: 0,
    };
    this.positions.set(input.instrumentId, position);
    return position;
  }

  public applyFunding(input: {
    readonly instrumentId: string;
    readonly fundingRatePercent: number;
  }): PaperPosition {
    const position = this.positions.get(input.instrumentId);
    if (position === undefined) {
      throw new Error(`no open position for ${input.instrumentId}`);
    }
    if (!Number.isFinite(input.fundingRatePercent)) {
      throw new Error('fundingRatePercent must be finite');
    }
    const notional =
      position.averageEntryPrice * position.contracts;
    const fundingPnl =
      notional *
      (input.fundingRatePercent / 100) *
      (position.direction === 'LONG' ? -1 : 1);
    const updated = {
      ...position,
      accumulatedFundingPnl: position.accumulatedFundingPnl + fundingPnl,
    };
    this.positions.set(input.instrumentId, updated);
    return updated;
  }

  public closePosition(input: {
    readonly instrumentId: string;
    readonly order: PaperOrderResult;
    readonly closedAt: number;
    readonly entryFee: number;
  }): PaperClosedTrade {
    const position = this.positions.get(input.instrumentId);
    if (position === undefined) {
      throw new Error(`no open position for ${input.instrumentId}`);
    }
    requireTimestamp(input.closedAt, 'closedAt');
    if (
      input.order.averagePrice === null ||
      input.order.filledContracts <= 0 ||
      input.order.status === 'REJECTED' ||
      input.order.status === 'RETRY_EXHAUSTED'
    ) {
      throw new Error('A filled closing order is required');
    }
    const contracts = Math.min(position.contracts, input.order.filledContracts);
    const grossPnlPerContract =
      position.direction === 'LONG'
        ? input.order.averagePrice - position.averageEntryPrice
        : position.averageEntryPrice - input.order.averagePrice;
    const grossPnl = grossPnlPerContract * contracts;
    const fees = input.entryFee + input.order.fee;
    const trade: PaperClosedTrade = {
      tradeId: `${input.instrumentId}:${position.openedAt}:${input.closedAt}`,
      instrumentId: input.instrumentId,
      direction: position.direction,
      openedAt: position.openedAt,
      closedAt: input.closedAt,
      contracts,
      entryPrice: position.averageEntryPrice,
      exitPrice: input.order.averagePrice,
      grossPnl,
      fees,
      fundingPnl: position.accumulatedFundingPnl,
      netPnl: grossPnl - fees + position.accumulatedFundingPnl,
    };
    this.closedTrades.push(trade);
    if (contracts >= position.contracts - Number.EPSILON) {
      this.positions.delete(input.instrumentId);
    } else {
      this.positions.set(input.instrumentId, {
        ...position,
        contracts: position.contracts - contracts,
      });
    }
    return trade;
  }

  public generateDailyReport(timestamp: number): PaperDailyReport {
    requireTimestamp(timestamp, 'timestamp');
    const day = dayKey(timestamp);
    const orders = this.orders.filter(
      (order) => dayKey(this.orderTimes.get(order.orderId) ?? 0) === day,
    );
    const trades = this.closedTrades.filter(
      (trade) => dayKey(trade.closedAt) === day,
    );
    return {
      day,
      submittedOrders: orders.length,
      filledOrders: orders.filter((order) => order.status === 'FILLED').length,
      partiallyFilledOrders: orders.filter(
        (order) => order.status === 'PARTIALLY_FILLED',
      ).length,
      rejectedOrders: orders.filter((order) => order.status === 'REJECTED').length,
      retryExhaustedOrders: orders.filter(
        (order) => order.status === 'RETRY_EXHAUSTED',
      ).length,
      closedTrades: trades.length,
      grossPnl: trades.reduce((sum, trade) => sum + trade.grossPnl, 0),
      fees: trades.reduce((sum, trade) => sum + trade.fees, 0),
      fundingPnl: trades.reduce((sum, trade) => sum + trade.fundingPnl, 0),
      netPnl: trades.reduce((sum, trade) => sum + trade.netPnl, 0),
      openPositions: this.positions.size,
      liveExecutionAllowed: false,
    };
  }

  public getOpenPositions(): readonly PaperPosition[] {
    return [...this.positions.values()].sort((left, right) =>
      left.instrumentId.localeCompare(right.instrumentId),
    );
  }

  public getClosedTrades(): readonly PaperClosedTrade[] {
    return this.closedTrades.slice();
  }

  private recordOrder(
    intent: PaperOrderIntent,
    result: PaperOrderResult,
  ): PaperOrderResult {
    this.orders.push(result);
    this.orderTimes.set(intent.orderId, intent.submittedAt);
    return result;
  }
}
