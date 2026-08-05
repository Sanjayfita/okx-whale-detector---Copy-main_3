import type { TestnetOrderIntentDocument } from './testnetOrderIntentPersistence';

export type TestnetOrderIntentComparisonOutcome =
  | 'IMPROVED'
  | 'UNCHANGED'
  | 'WORSENED';

export interface TestnetOrderIntentComparison {
  baselineGeneratedAt: number;
  candidateGeneratedAt: number;
  outcome: TestnetOrderIntentComparisonOutcome;
  baselineStatus: TestnetOrderIntentDocument['intent']['status'];
  candidateStatus: TestnetOrderIntentDocument['intent']['status'];
  estimatedNotionalDelta: number;
  maximumNotionalDelta: number;
  quantityDelta: number;
  referencePriceDelta: number;
  reasons: readonly string[];
  dryRunOnly: true;
  transportDispatchAllowed: false;
  testnetExecutionAuthorized: false;
  orderExecutionAuthorized: false;
}

export const compareTestnetOrderIntentDocuments = (input: {
  baseline: TestnetOrderIntentDocument;
  candidate: TestnetOrderIntentDocument;
}): TestnetOrderIntentComparison => {
  const { baseline, candidate } = input;

  if (candidate.generatedAt < baseline.generatedAt) {
    throw new Error('Candidate testnet order intent document cannot be older than baseline');
  }

  const before = baseline.intent;
  const after = candidate.intent;

  if (
    before.instrumentId !== after.instrumentId ||
    before.side !== after.side ||
    before.orderType !== after.orderType
  ) {
    throw new Error('Testnet order intents must describe the same instrument, side, and order type');
  }

  const estimatedNotionalDelta = after.estimatedNotional - before.estimatedNotional;
  const maximumNotionalDelta = after.maximumNotional - before.maximumNotional;
  const quantityDelta = after.quantity - before.quantity;
  const referencePriceDelta = after.referencePrice - before.referencePrice;
  const becameMorePermissive =
    before.status === 'REJECTED' && after.status === 'PREPARED_FOR_DRY_RUN';
  const becameMoreRestrictive =
    before.status === 'PREPARED_FOR_DRY_RUN' && after.status === 'REJECTED';
  const reasons: string[] = [];
  let outcome: TestnetOrderIntentComparisonOutcome;

  if (becameMorePermissive || estimatedNotionalDelta > 0 || maximumNotionalDelta > 0) {
    outcome = 'WORSENED';
    reasons.push('Candidate intent increases permissiveness or notional exposure');
  } else if (
    becameMoreRestrictive ||
    estimatedNotionalDelta < 0 ||
    maximumNotionalDelta < 0
  ) {
    outcome = 'IMPROVED';
    reasons.push('Candidate intent reduces permissiveness or notional exposure');
  } else {
    outcome = 'UNCHANGED';
    reasons.push('Candidate intent does not change safety exposure');
  }

  reasons.push('Intent comparison remains dry-run only and cannot dispatch an order');

  return Object.freeze({
    baselineGeneratedAt: baseline.generatedAt,
    candidateGeneratedAt: candidate.generatedAt,
    outcome,
    baselineStatus: before.status,
    candidateStatus: after.status,
    estimatedNotionalDelta,
    maximumNotionalDelta,
    quantityDelta,
    referencePriceDelta,
    reasons: Object.freeze(reasons),
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};
