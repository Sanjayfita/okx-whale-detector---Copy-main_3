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
  fundingPnl = -0.5,
): MonteCarloTrade => ({
  tradeId,
  episodeId,
  grossPnl,
  feeCost: 1,
  fundingPnl,
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
  positiveFundingReceiptHaircutRange: [0, 0.5],
  slippageMultiplierRange: [1, 2],
  latencyMultiplierRange: [1, 2],
  systemicShockWeight: 0.7,
  latencyImpactBpsPerSecond: 0.25,
  missedFillProbability: 0.1,
  favorableTradeMissedFillMultiplier: 2,
  partialFillFractionRange: [0.5, 1],
  confidenceLevel: 0.95,
  tailConfidenceLevel: 0.95,
  maximumDrawdownThresholdFraction: 0.1,
  minimumIndependentEpisodes: 3,
  ...overrides,
});

describe('runExecutionMonteCarlo', () => {
  it('is reproducible and reports systemic execution-tail risk', () => {
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
    expect(first.expectedShortfallReturnFraction).toBeLessThanOrEqual(
      first.netReturnFraction.p05,
    );
    expect(first.averageFavorableMissedFills).toBeGreaterThan(
      first.averageUnfavorableMissedFills,
    );
    expect(first.averageSystemicCostMultiplier).toBeGreaterThan(1);
    expect(first.probabilityDrawdownExceedsThreshold).toBeGreaterThanOrEqual(0);
    expect(first.liveExecutionAllowed).toBe(false);
  });

  it('haircuts positive funding receipts instead of amplifying them', () => {
    const report = runExecutionMonteCarlo({
      trades: [
        trade('a', 'episode-1', 0, 10),
        trade('b', 'episode-2', 0, 10),
        trade('c', 'episode-3', 0, 10),
      ],
      policy: deterministicPolicy({
        iterations: 50,
        feeMultiplierRange: [0, 0],
        fundingMultiplierRange: [10, 10],
        positiveFundingReceiptHaircutRange: [0.5, 0.5],
        slippageMultiplierRange: [0, 0],
        latencyMultiplierRange: [1, 1],
        latencyImpactBpsPerSecond: 0,
        missedFillProbability: 0,
        partialFillFractionRange: [1, 1],
      }),
    });

    expect(report.endingEquity.p50).toBeCloseTo(10_015, 8);
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
        minimumIndependentEpisodes: 10,
        feeMultiplierRange: [1, 1],
        fundingMultiplierRange: [1, 1],
        positiveFundingReceiptHaircutRange: [0, 0],
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

  it('counts temporary ruin even when the path later recovers', () => {
    const report = runExecutionMonteCarlo({
      trades: [
        {
          ...trade('loss', 'episode-1', -600, 0),
          feeCost: 0,
          slippageCost: 0,
          latencyMs: 0,
        },
        {
          ...trade('recovery', 'episode-1', 700, 0),
          feeCost: 0,
          slippageCost: 0,
          latencyMs: 0,
        },
      ],
      policy: deterministicPolicy({
        iterations: 20,
        initialEquity: 1_000,
        ruinEquityFraction: 0.5,
        minimumIndependentEpisodes: 1,
        feeMultiplierRange: [0, 0],
        fundingMultiplierRange: [0, 0],
        positiveFundingReceiptHaircutRange: [0, 0],
        slippageMultiplierRange: [0, 0],
        latencyMultiplierRange: [1, 1],
        latencyImpactBpsPerSecond: 0,
        missedFillProbability: 0,
        partialFillFractionRange: [1, 1],
      }),
    });

    expect(report.endingEquity.p50).toBe(1_100);
    expect(report.probabilityOfPositiveReturn).toBe(1);
    expect(report.probabilityOfRuin).toBe(1);
  });

  it('rejects underpowered episode samples', () => {
    expect(() =>
      runExecutionMonteCarlo({
        trades: [trade('a', 'episode-1', 1)],
        policy: deterministicPolicy({ minimumIndependentEpisodes: 3 }),
      }),
    ).toThrow('independent episodes');
  });
});
