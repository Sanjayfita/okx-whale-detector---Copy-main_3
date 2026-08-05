import type { TestnetHumanApprovalCheckpoint } from './testnetHumanApprovalCheckpoint';

export type TestnetOrderSide = 'BUY' | 'SELL';
export type TestnetOrderType = 'MARKET' | 'LIMIT';
export type TestnetOrderIntentStatus = 'REJECTED' | 'PREPARED_FOR_DRY_RUN';

export interface TestnetOrderIntentInput {
  approvalCheckpoint: TestnetHumanApprovalCheckpoint;
  environment: 'TESTNET' | 'PRODUCTION';
  instrumentId: string;
  side: TestnetOrderSide;
  orderType: TestnetOrderType;
  quantity: number;
  referencePrice: number;
  limitPrice?: number;
  maximumNotional: number;
  createdAt: number;
}

export interface TestnetOrderIntent {
  status: TestnetOrderIntentStatus;
  environment: 'TESTNET';
  instrumentId: string;
  side: TestnetOrderSide;
  orderType: TestnetOrderType;
  quantity: number;
  referencePrice: number;
  limitPrice: number | null;
  estimatedNotional: number;
  maximumNotional: number;
  createdAt: number;
  reasons: readonly string[];
  dryRunOnly: true;
  transportDispatchAllowed: false;
  testnetExecutionAuthorized: false;
  orderExecutionAuthorized: false;
}

const requirePositiveFinite = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return value;
};

export const prepareTestnetOrderIntent = (
  input: TestnetOrderIntentInput,
): TestnetOrderIntent => {
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('createdAt must be a non-negative safe integer');
  }

  const instrumentId = input.instrumentId.trim();
  if (instrumentId === '') throw new Error('instrumentId must not be empty');

  const quantity = requirePositiveFinite(input.quantity, 'quantity');
  const referencePrice = requirePositiveFinite(input.referencePrice, 'referencePrice');
  const maximumNotional = requirePositiveFinite(input.maximumNotional, 'maximumNotional');
  const limitPrice =
    input.orderType === 'LIMIT'
      ? requirePositiveFinite(input.limitPrice ?? Number.NaN, 'limitPrice')
      : null;
  const pricingBasis = limitPrice ?? referencePrice;
  const estimatedNotional = quantity * pricingBasis;
  if (!Number.isFinite(estimatedNotional)) {
    throw new Error('estimatedNotional must be finite');
  }

  const reasons: string[] = [];
  let status: TestnetOrderIntentStatus = 'PREPARED_FOR_DRY_RUN';

  if (input.environment !== 'TESTNET') {
    status = 'REJECTED';
    reasons.push('Only the testnet environment is accepted');
  }
  if (
    input.approvalCheckpoint.status !== 'ACKNOWLEDGED_FOR_TESTNET_PREPARATION' ||
    !input.approvalCheckpoint.testnetPreparationAcknowledged
  ) {
    status = 'REJECTED';
    reasons.push('Human approval checkpoint has not acknowledged testnet preparation');
  }
  if (estimatedNotional > maximumNotional) {
    status = 'REJECTED';
    reasons.push('Estimated notional exceeds the configured testnet limit');
  }

  if (status === 'PREPARED_FOR_DRY_RUN') {
    reasons.push('Intent is prepared for deterministic dry-run validation only');
  }
  reasons.push('Intent preparation never dispatches or authorizes an order');

  return Object.freeze({
    status,
    environment: 'TESTNET',
    instrumentId,
    side: input.side,
    orderType: input.orderType,
    quantity,
    referencePrice,
    limitPrice,
    estimatedNotional,
    maximumNotional,
    createdAt: input.createdAt,
    reasons: Object.freeze(reasons),
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};
