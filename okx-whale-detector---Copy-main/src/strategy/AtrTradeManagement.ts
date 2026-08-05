import type { TradeDirection } from './DerivativesFlowStrategy';

export interface AtrTradeManagementPolicy {
  readonly initialStopAtrMultiple: number;
  readonly trailingStopAtrMultiple: number;
  readonly breakEvenTriggerR: number;
  readonly partialTakeProfitR: number;
  readonly breakEvenCostBufferPercent: number;
  readonly flowReversalThreshold: number;
  readonly minimumRBeforeFlowExit: number;
}

export interface OpenTradeManagementState {
  readonly direction: TradeDirection;
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly atr: number;
  readonly highestPriceSinceEntry: number;
  readonly lowestPriceSinceEntry: number;
  readonly currentStopPrice: number | null;
  readonly structureInvalidationPrice: number | null;
  readonly partialTakeProfitCompleted: boolean;
  readonly marketStructureInvalidated: boolean;
  readonly aggressiveDeltaNormalized: number;
  readonly cvdSlopeNormalized: number;
}

export type TradeManagementAction =
  | 'HOLD'
  | 'TAKE_PARTIAL_PROFIT'
  | 'EXIT_FULL';

export type TradeManagementReason =
  | 'INITIAL_STOP'
  | 'BREAK_EVEN_ACTIVATED'
  | 'ATR_TRAIL_TIGHTENED'
  | 'STRUCTURE_STOP_TIGHTENED'
  | 'STOP_REACHED'
  | 'PARTIAL_TARGET_REACHED'
  | 'MARKET_STRUCTURE_INVALIDATED'
  | 'FLOW_REVERSAL';

export interface AtrTradeManagementDecision {
  readonly action: TradeManagementAction;
  readonly stopPrice: number;
  readonly initialStopPrice: number;
  readonly partialTakeProfitPrice: number;
  readonly currentRMultiple: number;
  readonly reasons: readonly TradeManagementReason[];
  readonly liveExecutionAllowed: false;
}

export const DEFAULT_ATR_TRADE_MANAGEMENT_POLICY: AtrTradeManagementPolicy =
  Object.freeze({
    initialStopAtrMultiple: 1.5,
    trailingStopAtrMultiple: 2,
    breakEvenTriggerR: 1,
    partialTakeProfitR: 1.25,
    breakEvenCostBufferPercent: 0.12,
    flowReversalThreshold: 0.2,
    minimumRBeforeFlowExit: 0.5,
  });

const requirePositive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
};

const requireSignedUnit = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new Error(`${name} must be between -1 and 1`);
  }
};

const validatePolicy = (policy: AtrTradeManagementPolicy): void => {
  requirePositive(policy.initialStopAtrMultiple, 'initialStopAtrMultiple');
  requirePositive(policy.trailingStopAtrMultiple, 'trailingStopAtrMultiple');
  requirePositive(policy.breakEvenTriggerR, 'breakEvenTriggerR');
  requirePositive(policy.partialTakeProfitR, 'partialTakeProfitR');
  if (
    !Number.isFinite(policy.breakEvenCostBufferPercent) ||
    policy.breakEvenCostBufferPercent < 0
  ) {
    throw new Error(
      'breakEvenCostBufferPercent must be a non-negative finite number',
    );
  }
  requirePositive(policy.flowReversalThreshold, 'flowReversalThreshold');
  if (policy.flowReversalThreshold > 1) {
    throw new Error('flowReversalThreshold must be at most 1');
  }
  if (
    !Number.isFinite(policy.minimumRBeforeFlowExit) ||
    policy.minimumRBeforeFlowExit < 0
  ) {
    throw new Error(
      'minimumRBeforeFlowExit must be a non-negative finite number',
    );
  }
};

const validateState = (state: OpenTradeManagementState): void => {
  requirePositive(state.entryPrice, 'entryPrice');
  requirePositive(state.currentPrice, 'currentPrice');
  requirePositive(state.atr, 'atr');
  requirePositive(state.highestPriceSinceEntry, 'highestPriceSinceEntry');
  requirePositive(state.lowestPriceSinceEntry, 'lowestPriceSinceEntry');
  if (state.highestPriceSinceEntry < state.lowestPriceSinceEntry) {
    throw new Error(
      'highestPriceSinceEntry cannot be below lowestPriceSinceEntry',
    );
  }
  if (
    state.currentPrice > state.highestPriceSinceEntry ||
    state.currentPrice < state.lowestPriceSinceEntry
  ) {
    throw new Error('currentPrice must be inside the observed trade range');
  }
  if (state.currentStopPrice !== null) {
    requirePositive(state.currentStopPrice, 'currentStopPrice');
  }
  if (state.structureInvalidationPrice !== null) {
    requirePositive(
      state.structureInvalidationPrice,
      'structureInvalidationPrice',
    );
  }
  requireSignedUnit(
    state.aggressiveDeltaNormalized,
    'aggressiveDeltaNormalized',
  );
  requireSignedUnit(state.cvdSlopeNormalized, 'cvdSlopeNormalized');
};

const maximum = (values: readonly number[]): number => Math.max(...values);
const minimum = (values: readonly number[]): number => Math.min(...values);

export const evaluateAtrTradeManagement = (input: {
  readonly state: OpenTradeManagementState;
  readonly policy?: AtrTradeManagementPolicy;
}): AtrTradeManagementDecision => {
  const policy = input.policy ?? DEFAULT_ATR_TRADE_MANAGEMENT_POLICY;
  validatePolicy(policy);
  validateState(input.state);

  const state = input.state;
  const sign = state.direction === 'LONG' ? 1 : -1;
  const initialRiskDistance = state.atr * policy.initialStopAtrMultiple;
  const initialStopPrice =
    state.entryPrice - sign * initialRiskDistance;
  const partialTakeProfitPrice =
    state.entryPrice +
    sign * initialRiskDistance * policy.partialTakeProfitR;
  const favorableMove = sign * (state.currentPrice - state.entryPrice);
  const currentRMultiple = favorableMove / initialRiskDistance;
  const reasons: TradeManagementReason[] = [];

  let stopPrice = state.currentStopPrice ?? initialStopPrice;
  if (state.currentStopPrice === null) {
    reasons.push('INITIAL_STOP');
  }

  if (currentRMultiple >= policy.breakEvenTriggerR) {
    const breakEvenBuffer =
      state.entryPrice * (policy.breakEvenCostBufferPercent / 100);
    const breakEvenStop = state.entryPrice + sign * breakEvenBuffer;
    const tightened =
      state.direction === 'LONG'
        ? maximum([stopPrice, breakEvenStop])
        : minimum([stopPrice, breakEvenStop]);
    if (tightened !== stopPrice) {
      stopPrice = tightened;
      reasons.push('BREAK_EVEN_ACTIVATED');
    }
  }

  const atrTrail =
    state.direction === 'LONG'
      ? state.highestPriceSinceEntry -
        state.atr * policy.trailingStopAtrMultiple
      : state.lowestPriceSinceEntry +
        state.atr * policy.trailingStopAtrMultiple;
  const trailedStop =
    state.direction === 'LONG'
      ? maximum([stopPrice, atrTrail])
      : minimum([stopPrice, atrTrail]);
  if (trailedStop !== stopPrice) {
    stopPrice = trailedStop;
    reasons.push('ATR_TRAIL_TIGHTENED');
  }

  if (state.structureInvalidationPrice !== null) {
    const structureStop = state.structureInvalidationPrice;
    const tightened =
      state.direction === 'LONG'
        ? maximum([stopPrice, structureStop])
        : minimum([stopPrice, structureStop]);
    if (tightened !== stopPrice) {
      stopPrice = tightened;
      reasons.push('STRUCTURE_STOP_TIGHTENED');
    }
  }

  if (state.marketStructureInvalidated) {
    reasons.push('MARKET_STRUCTURE_INVALIDATED');
    return {
      action: 'EXIT_FULL',
      stopPrice,
      initialStopPrice,
      partialTakeProfitPrice,
      currentRMultiple,
      reasons,
      liveExecutionAllowed: false,
    };
  }

  const directionalDelta = sign * state.aggressiveDeltaNormalized;
  const directionalCvd = sign * state.cvdSlopeNormalized;
  if (
    currentRMultiple >= policy.minimumRBeforeFlowExit &&
    directionalDelta <= -policy.flowReversalThreshold &&
    directionalCvd <= -policy.flowReversalThreshold
  ) {
    reasons.push('FLOW_REVERSAL');
    return {
      action: 'EXIT_FULL',
      stopPrice,
      initialStopPrice,
      partialTakeProfitPrice,
      currentRMultiple,
      reasons,
      liveExecutionAllowed: false,
    };
  }

  const stopReached =
    state.direction === 'LONG'
      ? state.currentPrice <= stopPrice
      : state.currentPrice >= stopPrice;
  if (stopReached) {
    reasons.push('STOP_REACHED');
    return {
      action: 'EXIT_FULL',
      stopPrice,
      initialStopPrice,
      partialTakeProfitPrice,
      currentRMultiple,
      reasons,
      liveExecutionAllowed: false,
    };
  }

  const partialTargetReached =
    !state.partialTakeProfitCompleted &&
    (state.direction === 'LONG'
      ? state.currentPrice >= partialTakeProfitPrice
      : state.currentPrice <= partialTakeProfitPrice);
  if (partialTargetReached) {
    reasons.push('PARTIAL_TARGET_REACHED');
    return {
      action: 'TAKE_PARTIAL_PROFIT',
      stopPrice,
      initialStopPrice,
      partialTakeProfitPrice,
      currentRMultiple,
      reasons,
      liveExecutionAllowed: false,
    };
  }

  return {
    action: 'HOLD',
    stopPrice,
    initialStopPrice,
    partialTakeProfitPrice,
    currentRMultiple,
    reasons,
    liveExecutionAllowed: false,
  };
};
