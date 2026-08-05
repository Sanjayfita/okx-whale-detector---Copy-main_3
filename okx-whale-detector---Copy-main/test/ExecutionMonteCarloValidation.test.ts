import { describe, expect, it } from 'vitest';

import {
  runExecutionMonteCarlo,
  type ExecutionMonteCarloPolicy,
  type MonteCarloTrade,
} from '../src/research/ExecutionMonteCarloValidation';

const trade = (
  tradeId: string,
  episodeId: string,
  grossPnl: number,
): MonteCarloTrade => ({
  tradeId,
  episodeId,
  grossPnl,
  feeCost: 1,
  fundingPnl: -0.5,
  slippageCost: 1,
  notional: 1_000,
  latencyMs: 100,
});

const deterministicPolicy = (
  overrides: Partial<ExecutionMonteCarloPolicy> = {},
): ExecutionMonteCarloPolicy => ({
  iterations: 500,
  seed: 42,
  initialEquity: 10_000,
  ruinEquityFraction: 0.5,
  feeMultiplierRange: [1, 1.5],
  fundingMultiplierRange: [1, 2],
  slippageMultiplierRange: [1, 2],
  latencyMultiplierRange: [1, 2],
  latencyImpactBpsPerSecond: 0.25,
  missedFillProbability: 0.1,
  partialFillFractionRange: [0.5, 1],
  confidenceLevel: 0.95,
  ...overrides,
});

describe('runExecutionMonteCarlo', () => {
  it('is reproducible and reports execution-stressed distributions', () => {
    const trades = [
      trade('a', 'episode-1', 20),
      trade('b', 'episode-1', -10),
      trade('c', 'episode-2', 15),
      trade('d', 'episode-3', -5),
    ];
    const first = runExecutionMonteCarlo({
      trades,
      policy: deterministicPolicy(),
    });
    const second = runExecutionMonteCarlo({
      trades,
      policy: deterministicPolicy(),
    });

    expect(first).toEqual(second);
    expect(first.independentEpisodeCount).toBe(3);
    expect(first.endingEquity.p05).toBeLessThanOrEqual(
      first.endingEquity.p95,
    );
    expect(first.maximumDrawdownFraction.p95).toBeGreaterThanOrEqual(0);
    expect(first.averageMissedFills).toBeGreaterThan(0);
    expect(first.averagePartialFills).toBeGreaterThan(0);
    expect(first.expectedReturnConfidenceInterval.level).toBe(0.95);
    expect(first.liveExecutionAllowed).toBe(false);
  });

  it('detects ruin under persistently losing paths', () => {
    const trades = Array.from({ length: 10 }, (_, index) => ({
      ...trade(`loss-${index}`, `episode-${index}`, -120),
      feeCost: 0,
      fundingPnl: 0,
      slippageCost: 0,
      latencyMs: 0,
    }));
    const report = runExecutionMonteCarlo({
      trades,
      policy: deterministicPolicy({
        iterations: 100,
        initialEquity: 1_000,
        ruinEquityFraction: 0.5,
        feeMultiplierRange: [1, 1],
        fundingMultiplierRange: [1, 1],
        slippageMultiplierRange: [1, 1],
        latencyMultiplierRange: [1, 1],
        latencyImpactBpsPerSecond: 0,
        missedFillProbability: 0,
        partialFillFractionRange: [1, 1],
      }),
    });

    expect(report.probabilityOfRuin).toBe(1);
    expect(report.probabilityOfPositiveReturn).toBe(0);
    expect(report.netReturnFraction.p50).toBeLessThan(0);
  });
});
