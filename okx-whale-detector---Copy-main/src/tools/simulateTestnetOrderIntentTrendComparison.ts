import { compareTestnetOrderIntentTrendDocuments } from '../safety/testnetOrderIntentTrendComparison';
import type { TestnetOrderIntentTrendDocument } from '../safety/testnetOrderIntentTrendPersistence';

const document = (input: {
  generatedAt: number;
  direction: 'DECREASING_RISK' | 'STABLE' | 'INCREASING_RISK';
  estimatedNotionalChange: number;
  maximumNotionalChange: number;
  riskIncreases: number;
  riskReductions: number;
  highestEstimatedNotional: number;
  lowestEstimatedNotional: number;
}): TestnetOrderIntentTrendDocument => ({
  schemaVersion: 1,
  generatorVersion: 'testnet-order-intent-trend-v1',
  generatedAt: input.generatedAt,
  trend: {
    instrumentId: 'BTC-USDT',
    side: 'BUY',
    orderType: 'MARKET',
    direction: input.direction,
    points: [
      { generatedAt: input.generatedAt - 2, status: 'PREPARED_FOR_DRY_RUN', estimatedNotional: 100, maximumNotional: 200, quantity: 1, referencePrice: 100 },
      { generatedAt: input.generatedAt - 1, status: 'PREPARED_FOR_DRY_RUN', estimatedNotional: 100 + input.estimatedNotionalChange, maximumNotional: 200 + input.maximumNotionalChange, quantity: 1, referencePrice: 100 },
    ],
    estimatedNotionalChange: input.estimatedNotionalChange,
    maximumNotionalChange: input.maximumNotionalChange,
    riskIncreases: input.riskIncreases,
    riskReductions: input.riskReductions,
    highestEstimatedNotional: input.highestEstimatedNotional,
    lowestEstimatedNotional: input.lowestEstimatedNotional,
    reasons: ['deterministic simulation'],
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  },
});

export const runTestnetOrderIntentTrendComparisonSimulation = (): number => {
  const baseline = document({ generatedAt: 1_000, direction: 'STABLE', estimatedNotionalChange: 0, maximumNotionalChange: 0, riskIncreases: 0, riskReductions: 0, highestEstimatedNotional: 100, lowestEstimatedNotional: 100 });
  const scenarios = [
    ['IMPROVED', document({ generatedAt: 2_000, direction: 'DECREASING_RISK', estimatedNotionalChange: -25, maximumNotionalChange: -25, riskIncreases: 0, riskReductions: 1, highestEstimatedNotional: 75, lowestEstimatedNotional: 75 })],
    ['UNCHANGED', document({ generatedAt: 2_000, direction: 'STABLE', estimatedNotionalChange: 0, maximumNotionalChange: 0, riskIncreases: 0, riskReductions: 0, highestEstimatedNotional: 100, lowestEstimatedNotional: 100 })],
    ['WORSENED', document({ generatedAt: 2_000, direction: 'INCREASING_RISK', estimatedNotionalChange: 25, maximumNotionalChange: 25, riskIncreases: 1, riskReductions: 0, highestEstimatedNotional: 125, lowestEstimatedNotional: 100 })],
  ] as const;

  console.log('TESTNET ORDER INTENT TREND COMPARISON SIMULATION');
  for (const [expected, candidate] of scenarios) {
    const result = compareTestnetOrderIntentTrendDocuments({ baseline, candidate });
    console.log(`${expected} | ${result.outcome}`);
    if (result.outcome !== expected || result.dryRunOnly !== true || result.transportDispatchAllowed !== false || result.testnetExecutionAuthorized !== false || result.orderExecutionAuthorized !== false) return 1;
  }
  console.log('SIMULATION PASSED');
  return 0;
};

if (require.main === module) process.exitCode = runTestnetOrderIntentTrendComparisonSimulation();
