import { prepareTestnetOrderIntent } from '../safety/testnetOrderIntent';
import type { TestnetHumanApprovalCheckpoint } from '../safety/testnetHumanApprovalCheckpoint';

const approvedCheckpoint: TestnetHumanApprovalCheckpoint = Object.freeze({
  status: 'ACKNOWLEDGED_FOR_TESTNET_PREPARATION',
  reviewerName: 'Deterministic Reviewer',
  reviewedAt: 1_000,
  approved: true,
  acknowledgement:
    'I understand this approval only permits further testnet preparation and does not authorize order execution.',
  reasons: Object.freeze([
    'Human review acknowledged further testnet preparation only',
    'Human approval never authorizes testnet or real-order execution',
  ]),
  testnetPreparationAcknowledged: true,
  testnetExecutionAuthorized: false,
  orderExecutionAuthorized: false,
});

const unapprovedCheckpoint: TestnetHumanApprovalCheckpoint = Object.freeze({
  ...approvedCheckpoint,
  status: 'APPROVAL_REQUIRED',
  approved: false,
  testnetPreparationAcknowledged: false,
});

export interface TestnetOrderIntentSimulationResult {
  preparedStatus: 'PREPARED_FOR_DRY_RUN';
  productionStatus: 'REJECTED';
  approvalStatus: 'REJECTED';
  notionalStatus: 'REJECTED';
  deterministicRepeat: true;
  dryRunOnly: true;
  transportDispatchAllowed: false;
  testnetExecutionAuthorized: false;
  orderExecutionAuthorized: false;
}

export const simulateTestnetOrderIntent = (): TestnetOrderIntentSimulationResult => {
  const baseInput = {
    approvalCheckpoint: approvedCheckpoint,
    environment: 'TESTNET' as const,
    instrumentId: 'BTC-USDT',
    side: 'BUY' as const,
    orderType: 'LIMIT' as const,
    quantity: 0.01,
    referencePrice: 50_000,
    limitPrice: 49_500,
    maximumNotional: 1_000,
    createdAt: 2_000,
  };

  const prepared = prepareTestnetOrderIntent(baseInput);
  const repeated = prepareTestnetOrderIntent(baseInput);
  const production = prepareTestnetOrderIntent({
    ...baseInput,
    environment: 'PRODUCTION',
  });
  const missingApproval = prepareTestnetOrderIntent({
    ...baseInput,
    approvalCheckpoint: unapprovedCheckpoint,
  });
  const overLimit = prepareTestnetOrderIntent({
    ...baseInput,
    maximumNotional: 100,
  });

  if (prepared.status !== 'PREPARED_FOR_DRY_RUN') {
    throw new Error('Expected a prepared dry-run intent');
  }
  if (production.status !== 'REJECTED') {
    throw new Error('Production environment must be rejected');
  }
  if (missingApproval.status !== 'REJECTED') {
    throw new Error('Missing approval must be rejected');
  }
  if (overLimit.status !== 'REJECTED') {
    throw new Error('Over-limit notional must be rejected');
  }
  if (JSON.stringify(prepared) !== JSON.stringify(repeated)) {
    throw new Error('Repeated simulation output must be deterministic');
  }
  if (
    !prepared.dryRunOnly ||
    prepared.transportDispatchAllowed ||
    prepared.testnetExecutionAuthorized ||
    prepared.orderExecutionAuthorized
  ) {
    throw new Error('Testnet order intent safeguards changed unexpectedly');
  }

  return Object.freeze({
    preparedStatus: prepared.status,
    productionStatus: production.status,
    approvalStatus: missingApproval.status,
    notionalStatus: overLimit.status,
    deterministicRepeat: true,
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};

if (require.main === module) {
  const result = simulateTestnetOrderIntent();
  console.log('TESTNET ORDER INTENT SIMULATION');
  console.log(`Prepared scenario: ${result.preparedStatus}`);
  console.log(`Production scenario: ${result.productionStatus}`);
  console.log(`Approval scenario: ${result.approvalStatus}`);
  console.log(`Notional scenario: ${result.notionalStatus}`);
  console.log(`Deterministic repeat: ${result.deterministicRepeat}`);
  console.log(`Dry run only: ${result.dryRunOnly}`);
  console.log(`Transport dispatch allowed: ${result.transportDispatchAllowed}`);
  console.log(`Testnet execution authorized: ${result.testnetExecutionAuthorized}`);
  console.log(`Order execution authorized: ${result.orderExecutionAuthorized}`);
}
