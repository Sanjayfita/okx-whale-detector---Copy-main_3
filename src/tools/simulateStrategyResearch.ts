import assert from 'node:assert/strict';

import { compareStrategyCandidates } from '../research/strategyCandidateComparison';
import { evaluateStrategyWalkForward } from '../research/strategyWalkForwardEvaluation';

export const runStrategyResearchSimulation = (): void => {
  const baselineCandidateId = 'strategy:baseline-v1';
  const candidateCandidateId = 'strategy:candidate-v2';

  const directComparison = compareStrategyCandidates({
    baselineCandidateId,
    candidateCandidateId,
    metrics: [
      {
        name: 'expectancy',
        direction: 'HIGHER_IS_BETTER',
        baseline: 0.12,
        candidate: 0.18,
        normalizationScale: 0.1,
        weight: 3,
      },
      {
        name: 'maximumDrawdown',
        direction: 'LOWER_IS_BETTER',
        baseline: 0.15,
        candidate: 0.11,
        normalizationScale: 0.1,
        weight: 2,
      },
      {
        name: 'coverage',
        direction: 'HIGHER_IS_BETTER',
        baseline: 0.8,
        candidate: 0.82,
        normalizationScale: 0.1,
      },
    ],
  });

  assert.equal(directComparison.verdict, 'BETTER');
  assert.equal(directComparison.improvedCount, 3);
  assert.equal(directComparison.degradedCount, 0);

  const walkForward = evaluateStrategyWalkForward({
    baselineCandidateId,
    candidateCandidateId,
    windows: [
      {
        windowId: 'window:2026-01',
        startedAt: 1_735_689_600_000,
        endedAt: 1_738_368_000_000,
        metrics: [
          {
            name: 'expectancy',
            direction: 'HIGHER_IS_BETTER',
            baseline: 0.1,
            candidate: 0.14,
            normalizationScale: 0.1,
            weight: 3,
          },
          {
            name: 'maximumDrawdown',
            direction: 'LOWER_IS_BETTER',
            baseline: 0.16,
            candidate: 0.13,
            normalizationScale: 0.1,
            weight: 2,
          },
        ],
      },
      {
        windowId: 'window:2026-02',
        startedAt: 1_738_368_000_000,
        endedAt: 1_740_787_200_000,
        metrics: [
          {
            name: 'expectancy',
            direction: 'HIGHER_IS_BETTER',
            baseline: 0.11,
            candidate: 0.16,
            normalizationScale: 0.1,
            weight: 3,
          },
          {
            name: 'maximumDrawdown',
            direction: 'LOWER_IS_BETTER',
            baseline: 0.14,
            candidate: 0.12,
            normalizationScale: 0.1,
            weight: 2,
          },
        ],
      },
      {
        windowId: 'window:2026-03',
        startedAt: 1_740_787_200_000,
        endedAt: 1_743_465_600_000,
        metrics: [
          {
            name: 'expectancy',
            direction: 'HIGHER_IS_BETTER',
            baseline: 0.09,
            candidate: 0.12,
            normalizationScale: 0.1,
            weight: 3,
          },
          {
            name: 'maximumDrawdown',
            direction: 'LOWER_IS_BETTER',
            baseline: 0.18,
            candidate: 0.15,
            normalizationScale: 0.1,
            weight: 2,
          },
        ],
      },
    ],
  });

  assert.equal(walkForward.verdict, 'ROBUSTLY_BETTER');
  assert.equal(walkForward.betterCount, 3);
  assert.equal(walkForward.worseCount, 0);
  assert.equal(walkForward.insufficientDataCount, 0);
  assert.deepEqual(
    walkForward.windows.map((window) => window.windowId),
    ['window:2026-01', 'window:2026-02', 'window:2026-03'],
  );

  console.log('STRATEGY RESEARCH SIMULATION');
  console.log(`Baseline candidate: ${baselineCandidateId}`);
  console.log(`Candidate: ${candidateCandidateId}`);
  console.log(`Direct comparison verdict: ${directComparison.verdict}`);
  console.log(`Walk-forward windows: ${walkForward.windows.length}`);
  console.log(`Walk-forward verdict: ${walkForward.verdict}`);
  console.log(
    `Cumulative weighted score: ${walkForward.cumulativeWeightedScore}`,
  );
  console.log('Deterministic controlled strategy research verified: true');
  console.log('Research analytics only. No orders were placed.');
};

if (require.main === module) {
  try {
    runStrategyResearchSimulation();
  } catch (error) {
    console.error(
      `Strategy research simulation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
