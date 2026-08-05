export type MarketOrderSide = 'BUY' | 'SELL';
export type TradeDirection = 'LONG' | 'SHORT';

export interface ExecutionBookLevel {
  readonly price: number;
  readonly quantity: number;
}

export interface ExecutionOrderBook {
  readonly observedAt: number;
  readonly bids: readonly ExecutionBookLevel[];
  readonly asks: readonly ExecutionBookLevel[];
}

export interface ExecutionSimulationPolicy {
  readonly takerFeeBps: number;
  readonly maxLevelParticipationRate: number;
  readonly latencyMs: number;
  readonly adverseLatencyBpsPerSecond: number;
  readonly minimumFillRatio: number;
}

export const DEFAULT_EXECUTION_SIMULATION_POLICY: ExecutionSimulationPolicy = {
  takerFeeBps: 5,
  maxLevelParticipationRate: 0.25,
  latencyMs: 150,
  adverseLatencyBpsPerSecond: 1,
  minimumFillRatio: 0.95,
};

export interface MarketFillResult {
  readonly status: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED';
  readonly side: MarketOrderSide;
  readonly requestedQuantity: number;
  readonly filledQuantity: number;
  readonly unfilledQuantity: number;
  readonly fillRatio: number;
  readonly averagePrice: number | null;
  readonly grossNotional: number;
  readonly fee: number;
  readonly midpointPrice: number | null;
  readonly slippageBps: number | null;
  readonly consumedLevels: number;
  readonly rejectionReasons: readonly string[];
}

const isPositiveFinite = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

const validatePolicy = (policy: ExecutionSimulationPolicy): void => {
  if (!Number.isFinite(policy.takerFeeBps) || policy.takerFeeBps < 0) {
    throw new Error('takerFeeBps must be finite and non-negative');
  }
  if (
    !Number.isFinite(policy.maxLevelParticipationRate) ||
    policy.maxLevelParticipationRate <= 0 ||
    policy.maxLevelParticipationRate > 1
  ) {
    throw new Error('maxLevelParticipationRate must be in (0, 1]');
  }
  if (!Number.isFinite(policy.latencyMs) || policy.latencyMs < 0) {
    throw new Error('latencyMs must be finite and non-negative');
  }
  if (
    !Number.isFinite(policy.adverseLatencyBpsPerSecond) ||
    policy.adverseLatencyBpsPerSecond < 0
  ) {
    throw new Error(
      'adverseLatencyBpsPerSecond must be finite and non-negative',
    );
  }
  if (
    !Number.isFinite(policy.minimumFillRatio) ||
    policy.minimumFillRatio <= 0 ||
    policy.minimumFillRatio > 1
  ) {
    throw new Error('minimumFillRatio must be in (0, 1]');
  }
};

const normalizeBook = (
  book: ExecutionOrderBook,
): {
  readonly bids: readonly ExecutionBookLevel[];
  readonly asks: readonly ExecutionBookLevel[];
  readonly midpointPrice: number | null;
} => {
  const bids = book.bids
    .filter(
      (level) => isPositiveFinite(level.price) && isPositiveFinite(level.quantity),
    )
    .slice()
    .sort((left, right) => right.price - left.price);
  const asks = book.asks
    .filter(
      (level) => isPositiveFinite(level.price) && isPositiveFinite(level.quantity),
    )
    .slice()
    .sort((left, right) => left.price - right.price);

  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;
  const midpointPrice =
    bestBid !== undefined && bestAsk !== undefined && bestAsk > bestBid
      ? (bestBid + bestAsk) / 2
      : null;

  return { bids, asks, midpointPrice };
};

const latencyAdjustedPrice = (
  price: number,
  side: MarketOrderSide,
  policy: ExecutionSimulationPolicy,
): number => {
  const adverseBps =
    policy.adverseLatencyBpsPerSecond * (policy.latencyMs / 1_000);
  const multiplier = 1 + (side === 'BUY' ? adverseBps : -adverseBps) / 10_000;
  return price * multiplier;
};

export const simulateMarketOrder = (input: {
  readonly side: MarketOrderSide;
  readonly quantity: number;
  readonly book: ExecutionOrderBook;
  readonly policy?: ExecutionSimulationPolicy;
}): MarketFillResult => {
  const policy = input.policy ?? DEFAULT_EXECUTION_SIMULATION_POLICY;
  validatePolicy(policy);

  if (!isPositiveFinite(input.quantity)) {
    return {
      status: 'REJECTED',
      side: input.side,
      requestedQuantity: input.quantity,
      filledQuantity: 0,
      unfilledQuantity: input.quantity,
      fillRatio: 0,
      averagePrice: null,
      grossNotional: 0,
      fee: 0,
      midpointPrice: null,
      slippageBps: null,
      consumedLevels: 0,
      rejectionReasons: ['INVALID_QUANTITY'],
    };
  }

  const normalized = normalizeBook(input.book);
  const levels = input.side === 'BUY' ? normalized.asks : normalized.bids;
  if (normalized.midpointPrice === null || levels.length === 0) {
    return {
      status: 'REJECTED',
      side: input.side,
      requestedQuantity: input.quantity,
      filledQuantity: 0,
      unfilledQuantity: input.quantity,
      fillRatio: 0,
      averagePrice: null,
      grossNotional: 0,
      fee: 0,
      midpointPrice: normalized.midpointPrice,
      slippageBps: null,
      consumedLevels: 0,
      rejectionReasons: ['INVALID_OR_EMPTY_BOOK'],
    };
  }

  let remaining = input.quantity;
  let filledQuantity = 0;
  let grossNotional = 0;
  let consumedLevels = 0;

  for (const level of levels) {
    if (remaining <= 0) {
      break;
    }
    const available = level.quantity * policy.maxLevelParticipationRate;
    const fillQuantity = Math.min(remaining, available);
    if (fillQuantity <= 0) {
      continue;
    }

    const executionPrice = latencyAdjustedPrice(level.price, input.side, policy);
    filledQuantity += fillQuantity;
    grossNotional += fillQuantity * executionPrice;
    remaining -= fillQuantity;
    consumedLevels += 1;
  }

  const fillRatio = filledQuantity / input.quantity;
  const averagePrice =
    filledQuantity > 0 ? grossNotional / filledQuantity : null;
  const fee = grossNotional * (policy.takerFeeBps / 10_000);
  const slippageBps =
    averagePrice === null
      ? null
      : ((averagePrice - normalized.midpointPrice) /
          normalized.midpointPrice) *
        10_000 *
        (input.side === 'BUY' ? 1 : -1);

  return {
    status:
      fillRatio >= 1 - Number.EPSILON
        ? 'FILLED'
        : fillRatio >= policy.minimumFillRatio
          ? 'PARTIALLY_FILLED'
          : 'REJECTED',
    side: input.side,
    requestedQuantity: input.quantity,
    filledQuantity,
    unfilledQuantity: Math.max(0, input.quantity - filledQuantity),
    fillRatio,
    averagePrice,
    grossNotional,
    fee,
    midpointPrice: normalized.midpointPrice,
    slippageBps,
    consumedLevels,
    rejectionReasons:
      fillRatio >= policy.minimumFillRatio ? [] : ['INSUFFICIENT_EXECUTABLE_DEPTH'],
  };
};

export interface LeveragedTradeSimulationResult {
  readonly status: 'COMPLETED' | 'PARTIALLY_EXITED' | 'LIQUIDATED' | 'REJECTED';
  readonly direction: TradeDirection;
  readonly entry: MarketFillResult;
  readonly exit: MarketFillResult | null;
  readonly matchedQuantity: number;
  readonly leverage: number;
  readonly initialMargin: number;
  readonly estimatedLiquidationPrice: number | null;
  readonly grossPnl: number;
  readonly feeCost: number;
  readonly fundingPnl: number;
  readonly netPnl: number;
  readonly holdingTimeMs: number;
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

export const estimateLinearLiquidationPrice = (input: {
  readonly direction: TradeDirection;
  readonly entryPrice: number;
  readonly leverage: number;
  readonly maintenanceMarginRate: number;
}): number => {
  if (!isPositiveFinite(input.entryPrice)) {
    throw new Error('entryPrice must be positive');
  }
  if (!Number.isFinite(input.leverage) || input.leverage <= 1) {
    throw new Error('leverage must be greater than 1');
  }
  if (
    !Number.isFinite(input.maintenanceMarginRate) ||
    input.maintenanceMarginRate < 0 ||
    input.maintenanceMarginRate >= 1 / input.leverage
  ) {
    throw new Error(
      'maintenanceMarginRate must be non-negative and below initial margin rate',
    );
  }

  return input.direction === 'LONG'
    ? input.entryPrice *
        (1 - 1 / input.leverage + input.maintenanceMarginRate)
    : input.entryPrice *
        (1 + 1 / input.leverage - input.maintenanceMarginRate);
};

export const simulateLeveragedTrade = (input: {
  readonly direction: TradeDirection;
  readonly quantity: number;
  readonly entryBook: ExecutionOrderBook;
  readonly exitBook: ExecutionOrderBook;
  readonly leverage: number;
  readonly maintenanceMarginRate: number;
  readonly fundingRatePercentPerInterval: number;
  readonly fundingIntervalHours: number;
  readonly pathLow: number | null;
  readonly pathHigh: number | null;
  readonly policy?: ExecutionSimulationPolicy;
}): LeveragedTradeSimulationResult => {
  const entrySide: MarketOrderSide = input.direction === 'LONG' ? 'BUY' : 'SELL';
  const exitSide: MarketOrderSide = input.direction === 'LONG' ? 'SELL' : 'BUY';
  const entry = simulateMarketOrder({
    side: entrySide,
    quantity: input.quantity,
    book: input.entryBook,
    policy: input.policy,
  });

  const baseRejected: LeveragedTradeSimulationResult = {
    status: 'REJECTED',
    direction: input.direction,
    entry,
    exit: null,
    matchedQuantity: 0,
    leverage: input.leverage,
    initialMargin: 0,
    estimatedLiquidationPrice: null,
    grossPnl: 0,
    feeCost: entry.fee,
    fundingPnl: 0,
    netPnl: -entry.fee,
    holdingTimeMs: Math.max(0, input.exitBook.observedAt - input.entryBook.observedAt),
    rejectionReasons: entry.rejectionReasons,
    liveExecutionAllowed: false,
  };

  if (entry.status === 'REJECTED' || entry.averagePrice === null) {
    return baseRejected;
  }
  if (!Number.isFinite(input.fundingRatePercentPerInterval)) {
    return { ...baseRejected, rejectionReasons: ['INVALID_FUNDING_RATE'] };
  }
  if (!isPositiveFinite(input.fundingIntervalHours)) {
    return { ...baseRejected, rejectionReasons: ['INVALID_FUNDING_INTERVAL'] };
  }

  let liquidationPrice: number;
  try {
    liquidationPrice = estimateLinearLiquidationPrice({
      direction: input.direction,
      entryPrice: entry.averagePrice,
      leverage: input.leverage,
      maintenanceMarginRate: input.maintenanceMarginRate,
    });
  } catch {
    return { ...baseRejected, rejectionReasons: ['INVALID_MARGIN_CONFIGURATION'] };
  }

  const entryNotional = entry.averagePrice * entry.filledQuantity;
  const initialMargin = entryNotional / input.leverage;
  const holdingTimeMs = Math.max(
    0,
    input.exitBook.observedAt - input.entryBook.observedAt,
  );
  const holdingHours = holdingTimeMs / 3_600_000;
  const fundingIntervals = Math.max(
    0,
    Math.floor(holdingHours / input.fundingIntervalHours),
  );
  const fundingPnl =
    entryNotional *
    (input.fundingRatePercentPerInterval / 100) *
    fundingIntervals *
    (input.direction === 'LONG' ? -1 : 1);

  const liquidated =
    input.direction === 'LONG'
      ? input.pathLow !== null && input.pathLow <= liquidationPrice
      : input.pathHigh !== null && input.pathHigh >= liquidationPrice;

  if (liquidated) {
    return {
      status: 'LIQUIDATED',
      direction: input.direction,
      entry,
      exit: null,
      matchedQuantity: entry.filledQuantity,
      leverage: input.leverage,
      initialMargin,
      estimatedLiquidationPrice: liquidationPrice,
      grossPnl: -initialMargin,
      feeCost: entry.fee,
      fundingPnl,
      netPnl: -initialMargin - entry.fee + fundingPnl,
      holdingTimeMs,
      rejectionReasons: [],
      liveExecutionAllowed: false,
    };
  }

  const exit = simulateMarketOrder({
    side: exitSide,
    quantity: entry.filledQuantity,
    book: input.exitBook,
    policy: input.policy,
  });
  if (exit.averagePrice === null || exit.filledQuantity <= 0) {
    return {
      ...baseRejected,
      initialMargin,
      estimatedLiquidationPrice: liquidationPrice,
      fundingPnl,
      netPnl: -entry.fee + fundingPnl,
      holdingTimeMs,
      rejectionReasons: exit.rejectionReasons,
    };
  }

  const matchedQuantity = Math.min(
    entry.filledQuantity,
    exit.filledQuantity,
  );
  const grossPnlPerUnit =
    input.direction === 'LONG'
      ? exit.averagePrice - entry.averagePrice
      : entry.averagePrice - exit.averagePrice;
  const grossPnl = grossPnlPerUnit * matchedQuantity;
  const matchedEntryFee =
    entry.averagePrice * matchedQuantity *
    ((input.policy ?? DEFAULT_EXECUTION_SIMULATION_POLICY).takerFeeBps / 10_000);
  const matchedExitFee =
    exit.averagePrice * matchedQuantity *
    ((input.policy ?? DEFAULT_EXECUTION_SIMULATION_POLICY).takerFeeBps / 10_000);
  const feeCost = matchedEntryFee + matchedExitFee;

  return {
    status:
      matchedQuantity >= entry.filledQuantity - Number.EPSILON
        ? 'COMPLETED'
        : 'PARTIALLY_EXITED',
    direction: input.direction,
    entry,
    exit,
    matchedQuantity,
    leverage: input.leverage,
    initialMargin,
    estimatedLiquidationPrice: liquidationPrice,
    grossPnl,
    feeCost,
    fundingPnl,
    netPnl: grossPnl - feeCost + fundingPnl,
    holdingTimeMs,
    rejectionReasons: [],
    liveExecutionAllowed: false,
  };
};
