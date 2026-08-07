import type {
  PaperContractSpecification,
  PaperOrderIntent,
  PaperPosition,
} from './PaperTradingEngine';
import type {
  EmaTrendEntryDecision,
  EmaTrendExitDecision,
  EmaTrendOpenPositionSummary,
} from '../strategy/EmaTrendStrategy';

const requirePositiveFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
};

/**
 * Converts existing paper positions into the minimal exposure view consumed by
 * the strategy. This makes the "one position per direction" rule explicit at
 * the strategy boundary without changing PaperTradingEngine's execution model.
 */
export const summarizePaperPositions = (
  positions: readonly PaperPosition[],
): readonly EmaTrendOpenPositionSummary[] =>
  positions.map((position) => ({
    instrumentId: position.instrumentId,
    direction: position.direction,
  }));

/**
 * Converts a validated entry plan into the existing paper-order contract. No
 * live endpoint is called here; the returned intent must still pass the paper
 * execution simulator, contract rounding, depth, fee, slippage, and portfolio
 * checks already present in the repository.
 */
export const createEmaTrendPaperEntryIntent = (input: {
  readonly decision: EmaTrendEntryDecision;
  readonly specification: PaperContractSpecification;
  readonly orderId: string;
  readonly submittedAt: number;
}): PaperOrderIntent => {
  const plan = input.decision.tradePlan;
  if (
    input.decision.status !== 'SIGNAL' ||
    input.decision.instrumentId === null ||
    input.decision.direction === null ||
    plan === null
  ) {
    throw new Error('EMA trend entry intent requires a SIGNAL decision');
  }
  if (input.decision.instrumentId !== input.specification.instrumentId) {
    throw new Error('Strategy decision instrument does not match paper specification');
  }
  if (input.orderId.trim().length === 0) {
    throw new Error('orderId must not be empty');
  }
  if (!Number.isSafeInteger(input.submittedAt) || input.submittedAt < 0) {
    throw new Error('submittedAt must be a non-negative safe integer');
  }
  requirePositiveFinite(input.specification.contractValue, 'contractValue');

  const requestedContracts = plan.baseQuantity / input.specification.contractValue;
  requirePositiveFinite(requestedContracts, 'requestedContracts');

  return Object.freeze({
    orderId: input.orderId,
    instrumentId: input.decision.instrumentId,
    submittedAt: input.submittedAt,
    side: input.decision.direction === 'LONG' ? 'BUY' : 'SELL',
    orderType: 'MARKET' as const,
    requestedContracts,
    limitPrice: null,
    reduceOnly: false,
  });
};

/**
 * Exit intents are always reduce-only. The strategy decides *why* to exit;
 * PaperTradingEngine remains responsible for realistic simulated execution.
 */
export const createEmaTrendPaperExitIntent = (input: {
  readonly exit: EmaTrendExitDecision;
  readonly position: PaperPosition;
  readonly orderId: string;
  readonly submittedAt: number;
}): PaperOrderIntent => {
  if (input.exit.status !== 'EXIT' || input.exit.exitPrice === null) {
    throw new Error('EMA trend exit intent requires an EXIT decision');
  }
  if (input.exit.position.instrumentId !== input.position.instrumentId) {
    throw new Error('Strategy exit instrument does not match paper position');
  }
  if (input.orderId.trim().length === 0) {
    throw new Error('orderId must not be empty');
  }
  if (!Number.isSafeInteger(input.submittedAt) || input.submittedAt < 0) {
    throw new Error('submittedAt must be a non-negative safe integer');
  }

  return Object.freeze({
    orderId: input.orderId,
    instrumentId: input.position.instrumentId,
    submittedAt: input.submittedAt,
    side: input.position.direction === 'LONG' ? 'SELL' : 'BUY',
    orderType: 'MARKET' as const,
    requestedContracts: input.position.contracts,
    limitPrice: null,
    reduceOnly: true,
  });
};
