import { describe, expect, it } from 'vitest';

import {
  compareStrategies,
  type StrategyComparisonTrade,
} from '../src/research/StrategyComparison';

const start = 1_700_000_000_000;

const trades = (
  strategy: 'BASELINE' | 'BETTER' | 'FRAGILE',
): readonly StrategyComparisonTrade[] =>
  Array.from({ length: 60 }, (_, index) => {
    const baselinePnl = index % 3 === 0 ? -2 : 1;
    const improvement =
      strategy === 'BETTER'
        ? 1
        : strategy === 'FRAGILE' && index < 30
          ? 2
          : strategy === 'FRAGILE'
            ? -2
            : 0;
    const netPnl = baselinePnl + improvement;
    return {
      id: `${strategy}-${index}`,
      episodeId: `episode-${index}`,
      regime: index < 30 ? 'TRENDING' : 'RANGE',
      openedAt: start + index * 60_000,
      closedAt: start + index * 60_000 + 30_000,
      grossPnl: netPnl,
      feeCost: 0,
      fundingPnl: 0,
      netPnl,
      initialRisk: 2,
    };
  });

describe('compareStrategies', () => {
  it('requires validation, significant paired improvement, and regime stability', () => {
    const report = compareStrategies({
      baselineStrategyId: 'original-whale',
      policy: {
        bootstrapIterations: 2_000,
        minimumPairedEpisodes: 50,
        minimumPositiveRegimeFraction: 1,
        seed: 7,
      },
      candidates: [
        {
          strategyId: 'original-whale',
          label: 'Original Whale Strategy',
          trades: trades('BASELINE'),
          validationStatus: 'UNVALIDATED',
        },
        {
          strategyId: 'derivatives-flow-v1',
          label: 'DerivativesFlowStrategy',
          trades: trades('BETTER'),
          validationStatus: 'VALIDATED_FOR_PAPER_RESEARCH',
        },
        {
          strategyId: 'fragile',
          label: 'Regime-fragile candidate',
          trades: trades('FRAGILE'),
          validationStatus: 'VALIDATED_FOR_PAPER_RESEARCH',
        },
      ],
    });

    const better = report.rows.find(
      (row) => row.strategyId === 'derivatives-flow-v1',
    );
    const fragile = report.rows.find((row) => row.strategyId === 'fragile');

    expect(better?.pairedImprovement).toMatchObject({
      pairedEpisodeCount: 60,
      statisticallySignificant: true,
    });
    expect(better?.pairedImprovement?.confidenceLower).toBeGreaterThan(0);
    expect(better?.positiveRegimeFraction).toBe(1);
    expect(better?.promotionStatus).toBe('ELIGIBLE_FOR_PAPER_COMPARISON');
    expect(fragile?.positiveRegimeFraction).toBeLessThan(1);
    expect(fragile?.promotionStatus).toBe('NOT_VALIDATED');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.rows.every((row) => !row.liveExecutionAllowed)).toBe(true);
  });

  it('does not claim significance with too few paired episodes', () => {
    const report = compareStrategies({
      baselineStrategyId: 'baseline',
      policy: { minimumPairedEpisodes: 50 },
      candidates: [
        {
          strategyId: 'baseline',
          label: 'Baseline',
          trades: trades('BASELINE').slice(0, 10),
          validationStatus: 'UNVALIDATED',
        },
        {
          strategyId: 'candidate',
          label: 'Candidate',
          trades: trades('BETTER').slice(0, 10),
          validationStatus: 'VALIDATED_FOR_PAPER_RESEARCH',
        },
      ],
    });

    const candidate = report.rows.find((row) => row.strategyId === 'candidate');
    expect(candidate?.pairedImprovement?.statisticallySignificant).toBe(false);
    expect(candidate?.pairedImprovement?.confidenceLower).toBeNull();
    expect(candidate?.promotionStatus).toBe('NO_SIGNIFICANT_IMPROVEMENT');
  });
});
