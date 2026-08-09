import { describe, expect, it } from 'vitest';

import {
  compareAlertOutcomeStatisticsToBaseline,
  type BaselineComparisonOutcome,
} from '../src/research/compareAlertOutcomeStatisticsToBaseline';
import type { AggregateAlertOutcomeStatistics } from '../src/research/aggregateAlertOutcomeStatistics';

const aggregate = (
  evaluationId: string,
  adjustedReturn: number,
  winRate: number,
  favorableExcursion: number,
  adverseExcursion: number,
): AggregateAlertOutcomeStatistics => ({
  schemaVersion: 1,
  evaluationId,
  bundleCount: 100,
  horizonStatistics: [1, 5, 15, 30, 60].map((horizonMinutes) => ({
    horizonMinutes: horizonMinutes as 1 | 5 | 15 | 30 | 60,
    sampleSize: 100,
    excursionSampleSize: 100,
    wins: winRate,
    losses: 100 - winRate,
    flats: 0,
    winRatePercent: winRate,
    averageDirectionAdjustedReturnPercent: adjustedReturn,
    averageMaximumFavorableExcursionPercent: favorableExcursion,
    averageMaximumAdverseExcursionPercent: adverseExcursion,
  })),
  complete: true,
  liveOrderExecutionAllowed: false,
});

const outcomes = (
  comparison: ReturnType<typeof compareAlertOutcomeStatisticsToBaseline>,
): BaselineComparisonOutcome[] =>
  comparison.horizonComparisons.map((result) => result.outcome);

describe('compareAlertOutcomeStatisticsToBaseline', () => {
  it('marks every horizon as outperformed when detector statistics are better', () => {
    const result = compareAlertOutcomeStatisticsToBaseline({
      detector: aggregate('detector', 0.6, 60, 1.2, 0.4),
      baseline: aggregate('baseline', 0.1, 50, 0.8, 0.7),
    });

    expect(outcomes(result)).toEqual([
      'OUTPERFORMED',
      'OUTPERFORMED',
      'OUTPERFORMED',
      'OUTPERFORMED',
      'OUTPERFORMED',
    ]);
    expect(result.outperformedHorizons).toBe(5);
    expect(result.underperformedHorizons).toBe(0);
    expect(result.complete).toBe(true);
    expect(result.liveOrderExecutionAllowed).toBe(false);
  });

  it('marks identical statistics as matched', () => {
    const detector = aggregate('detector', 0.2, 55, 0.9, 0.5);
    const baseline = aggregate('baseline', 0.2, 55, 0.9, 0.5);

    const result = compareAlertOutcomeStatisticsToBaseline({
      detector,
      baseline,
    });

    expect(result.matchedHorizons).toBe(5);
    expect(outcomes(result).every((outcome) => outcome === 'MATCHED')).toBe(
      true,
    );
  });

  it('marks worse statistics as underperformed', () => {
    const result = compareAlertOutcomeStatisticsToBaseline({
      detector: aggregate('detector', -0.2, 40, 0.5, 1.1),
      baseline: aggregate('baseline', 0.1, 50, 0.8, 0.7),
    });

    expect(result.underperformedHorizons).toBe(5);
  });

  it('rejects mismatched horizon sets', () => {
    const detector = aggregate('detector', 0.2, 55, 0.9, 0.5);
    const completeBaseline = aggregate('baseline', 0.2, 55, 0.9, 0.5);
    const baseline: AggregateAlertOutcomeStatistics = {
      ...completeBaseline,
      horizonStatistics: completeBaseline.horizonStatistics.slice(0, 4),
    };

    expect(() =>
      compareAlertOutcomeStatisticsToBaseline({ detector, baseline }),
    ).toThrow('Detector and baseline must contain the same horizons');
  });
});
