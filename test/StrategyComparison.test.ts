import { describe, expect, it } from 'vitest';

import {
  compareStrategies,
  type StrategyComparisonTrade,
} from '../src/research/StrategyComparison';

const start = 1_700_000_000_000;
const universe = Array.from({ length: 60 }, (_, index) => `episode-${index}`);

const trade = (input: {
  readonly strategyId: string;
  readonly episodeIndex: number;
  readonly netPnl: number;
  readonly regime?: string;
}): StrategyComparisonTrade => ({
  id: `${input.strategyId}-${input.episodeIndex}`,
  episodeId: `episode-${input.episodeIndex}`,
  regime: input.regime ?? (input.episodeIndex < 30 ? 'TRENDING' : 'RANGE'),
  openedAt: start + input.episodeIndex * 60_000,
  closedAt: start + input.episodeIndex * 60_000 + 30_000,
  grossPnl: input.netPnl,
  feeCost: 0,
  fundingPnl: 0,
  netPnl: input.netPnl,
  initialRisk: 2,
});

const baselineTrades = (): readonly StrategyComparisonTrade[] =>
  universe.map((_, index) =>
    trade({ strategyId: 'baseline', episodeIndex: index, netPnl: -1 }),
  );

const sparseBetterTrades = (): readonly StrategyComparisonTrade[] =>
  universe.flatMap((_, index) =>
    index % 2 === 0
      ? [trade({ strategyId: 'better', episodeIndex: index, netPnl: 1 })]
      : [],
  );

describe('compareStrategies', () => {
  it('includes no-trade episodes in the complete paired universe', () => {
    const report = compareStrategies({
      baselineStrategyId: 'baseline',
      policy: {
        bootstrapIterations: 2_000,
        randomizationIterations: 2_000,
        minimumPositiveRegimeFraction: 0,
        seed: 7,
      },
      candidates: [
        {
          strategyId: 'baseline',
          label: 'Baseline',
          trades: baselineTrades(),
          evaluatedEpisodeIds: universe,
          validationStatus: 'UNVALIDATED',
        },
        {
          strategyId: 'better',
          label: 'Sparse better candidate',
          trades: sparseBetterTrades(),
          evaluatedEpisodeIds: universe,
          validationStatus: 'VALIDATED_FOR_PAPER_RESEARCH',
        },
      ],
    });

    const better = report.rows.find((row) => row.strategyId === 'better');
    expect(better?.pairedImprovement).toMatchObject({
      evaluationUniverseComplete: true,
      evaluationEpisodeCount: 60,
      pairedEpisodeCount: 60,
      candidateTradeEpisodeCount: 30,
      statisticallySignificant: true,
    });
    expect(better?.promotionStatus).toBe('ELIGIBLE_FOR_PAPER_COMPARISON');
    expect(report.multiplicityMethod).toBe('HOLM_BONFERRONI');
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('fails closed when strategies do not declare the same frozen universe', () => {
    const report = compareStrategies({
      baselineStrategyId: 'baseline',
      policy: {
        bootstrapIterations: 2_000,
        randomizationIterations: 2_000,
        minimumPositiveRegimeFraction: 0,
      },
      candidates: [
        {
          strategyId: 'baseline',
          label: 'Baseline',
          trades: baselineTrades(),
          validationStatus: 'UNVALIDATED',
        },
        {
          strategyId: 'candidate',
          label: 'Candidate',
          trades: sparseBetterTrades(),
          validationStatus: 'VALIDATED_FOR_PAPER_RESEARCH',
        },
      ],
    });

    const candidate = report.rows.find((row) => row.strategyId === 'candidate');
    expect(candidate?.pairedImprovement?.evaluationUniverseComplete).toBe(false);
    expect(candidate?.promotionStatus).toBe(
      'INCOMPLETE_EVALUATION_UNIVERSE',
    );
  });

  it('applies familywise adjustment across every candidate hypothesis', () => {
    const report = compareStrategies({
      baselineStrategyId: 'baseline',
      policy: {
        bootstrapIterations: 2_000,
        randomizationIterations: 2_000,
        minimumPositiveRegimeFraction: 0,
        seed: 11,
      },
      candidates: [
        {
          strategyId: 'baseline',
          label: 'Baseline',
          trades: baselineTrades(),
          evaluatedEpisodeIds: universe,
          validationStatus: 'UNVALIDATED',
        },
        {
          strategyId: 'strong',
          label: 'Strong',
          trades: universe.map((_, index) =>
            trade({ strategyId: 'strong', episodeIndex: index, netPnl: 1 }),
          ),
          evaluatedEpisodeIds: universe,
          validationStatus: 'VALIDATED_FOR_PAPER_RESEARCH',
        },
        {
          strategyId: 'weak',
          label: 'Weak',
          trades: universe.map((_, index) =>
            trade({
              strategyId: 'weak',
              episodeIndex: index,
              netPnl: index % 2 === 0 ? 0.1 : -1.9,
            }),
          ),
          evaluatedEpisodeIds: universe,
          validationStatus: 'VALIDATED_FOR_PAPER_RESEARCH',
        },
      ],
    });

    expect(report.hypothesisFamilySize).toBe(2);
    for (const row of report.rows.filter((item) => item.pairedImprovement !== null)) {
      const evidence = row.pairedImprovement;
      expect(evidence?.adjustedPValue ?? 0).toBeGreaterThanOrEqual(
        evidence?.rawPValue ?? 0,
      );
    }
  });
});
