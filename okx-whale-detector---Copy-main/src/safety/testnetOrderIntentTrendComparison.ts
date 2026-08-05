import type { TestnetOrderIntentTrendDocument } from './testnetOrderIntentTrendPersistence';

export type TestnetOrderIntentTrendComparisonOutcome =
  | 'IMPROVED'
  | 'UNCHANGED'
  | 'WORSENED';

export interface TestnetOrderIntentTrendComparison {
  baselineGeneratedAt: number;
  candidateGeneratedAt: number;
  outcome: TestnetOrderIntentTrendComparisonOutcome;
  baselineDirection: TestnetOrderIntentTrendDocument['trend']['direction'];
  candidateDirection: TestnetOrderIntentTrendDocument['trend']['direction'];
  estimatedNotionalChangeDelta: number;
  maximumNotionalChangeDelta: number;
  riskIncreasesDelta: number;
  riskReductionsDelta: number;
  highestEstimatedNotionalDelta: number;
  lowestEstimatedNotionalDelta: number;
  reasons: readonly string[];
  dryRunOnly: true;
  transportDispatchAllowed: false;
  testnetExecutionAuthorized: false;
  orderExecutionAuthorized: false;
}

const directionScore = (
  direction: TestnetOrderIntentTrendDocument['trend']['direction'],
): number => {
  switch (direction) {
    case 'DECREASING_RISK':
      return 0;
    case 'STABLE':
      return 1;
    case 'INCREASING_RISK':
      return 2;
  }
};

export const compareTestnetOrderIntentTrendDocuments = (input: {
  baseline: TestnetOrderIntentTrendDocument;
  candidate: TestnetOrderIntentTrendDocument;
}): TestnetOrderIntentTrendComparison => {
  const { baseline, candidate } = input;

  if (candidate.generatedAt < baseline.generatedAt) {
    throw new Error(
      'Candidate testnet order intent trend document cannot be older than baseline',
    );
  }

  const before = baseline.trend;
  const after = candidate.trend;

  if (
    before.instrumentId !== after.instrumentId ||
    before.side !== after.side ||
    before.orderType !== after.orderType
  ) {
    throw new Error(
      'Testnet order intent trends must describe the same instrument, side, and order type',
    );
  }

  const estimatedNotionalChangeDelta =
    after.estimatedNotionalChange - before.estimatedNotionalChange;
  const maximumNotionalChangeDelta =
    after.maximumNotionalChange - before.maximumNotionalChange;
  const riskIncreasesDelta = after.riskIncreases - before.riskIncreases;
  const riskReductionsDelta = after.riskReductions - before.riskReductions;
  const highestEstimatedNotionalDelta =
    after.highestEstimatedNotional - before.highestEstimatedNotional;
  const lowestEstimatedNotionalDelta =
    after.lowestEstimatedNotional - before.lowestEstimatedNotional;
  const directionDelta = directionScore(after.direction) - directionScore(before.direction);
  const reasons: string[] = [];

  const worsened =
    directionDelta > 0 ||
    riskIncreasesDelta > 0 ||
    estimatedNotionalChangeDelta > 0 ||
    maximumNotionalChangeDelta > 0 ||
    highestEstimatedNotionalDelta > 0;
  const improved =
    directionDelta < 0 ||
    riskReductionsDelta > 0 ||
    estimatedNotionalChangeDelta < 0 ||
    maximumNotionalChangeDelta < 0 ||
    highestEstimatedNotionalDelta < 0;

  let outcome: TestnetOrderIntentTrendComparisonOutcome;

  if (worsened) {
    outcome = 'WORSENED';
    reasons.push(
      'Candidate trend increases risk direction, exposure, or adverse transitions',
    );
  } else if (improved) {
    outcome = 'IMPROVED';
    reasons.push(
      'Candidate trend reduces risk direction, exposure, or adverse transitions',
    );
  } else {
    outcome = 'UNCHANGED';
    reasons.push('Candidate trend does not change dry-run safety exposure');
  }

  reasons.push('Trend comparison cannot dispatch or authorize any order');

  return Object.freeze({
    baselineGeneratedAt: baseline.generatedAt,
    candidateGeneratedAt: candidate.generatedAt,
    outcome,
    baselineDirection: before.direction,
    candidateDirection: after.direction,
    estimatedNotionalChangeDelta,
    maximumNotionalChangeDelta,
    riskIncreasesDelta,
    riskReductionsDelta,
    highestEstimatedNotionalDelta,
    lowestEstimatedNotionalDelta,
    reasons: Object.freeze(reasons),
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};
