import type {
  AggregateAlertOutcomeStatistics,
  AlertOutcomeHorizonStatistics,
} from './aggregateAlertOutcomeStatistics';

export const ALERT_OUTCOME_BASELINE_COMPARISON_SCHEMA_VERSION = 1 as const;

export type BaselineComparisonOutcome =
  'OUTPERFORMED' | 'MATCHED' | 'UNDERPERFORMED';

export interface AlertOutcomeBaselineHorizonComparison {
  horizonMinutes: number;
  detectorSampleSize: number;
  baselineSampleSize: number;
  winRateDeltaPercent: number;
  averageDirectionAdjustedReturnDeltaPercent: number;
  averageMaximumFavorableExcursionDeltaPercent: number | null;
  averageMaximumAdverseExcursionDeltaPercent: number | null;
  outcome: BaselineComparisonOutcome;
}

export interface AlertOutcomeBaselineComparison {
  schemaVersion: typeof ALERT_OUTCOME_BASELINE_COMPARISON_SCHEMA_VERSION;
  detectorEvaluationId: string;
  baselineEvaluationId: string;
  horizonComparisons: readonly AlertOutcomeBaselineHorizonComparison[];
  outperformedHorizons: number;
  matchedHorizons: number;
  underperformedHorizons: number;
  complete: true;
  liveOrderExecutionAllowed: false;
}

const findHorizon = (
  statistics: AggregateAlertOutcomeStatistics,
  horizonMinutes: number,
): AlertOutcomeHorizonStatistics => {
  const result = statistics.horizonStatistics.find(
    (candidate) => candidate.horizonMinutes === horizonMinutes,
  );

  if (result === undefined) {
    throw new Error(`Missing ${horizonMinutes}-minute aggregate statistics`);
  }

  return result;
};

const difference = (
  left: number | null,
  right: number | null,
): number | null => (left === null || right === null ? null : left - right);

export const compareAlertOutcomeStatisticsToBaseline = (input: {
  detector: AggregateAlertOutcomeStatistics;
  baseline: AggregateAlertOutcomeStatistics;
}): AlertOutcomeBaselineComparison => {
  const { detector, baseline } = input;

  if (!detector.complete || !baseline.complete) {
    throw new Error(
      'Detector and baseline aggregate statistics must be complete',
    );
  }

  const detectorHorizons = detector.horizonStatistics.map(
    (statistics) => statistics.horizonMinutes,
  );
  const baselineHorizons = baseline.horizonStatistics.map(
    (statistics) => statistics.horizonMinutes,
  );

  if (
    detectorHorizons.length !== baselineHorizons.length ||
    detectorHorizons.some((horizon) => !baselineHorizons.includes(horizon))
  ) {
    throw new Error('Detector and baseline must contain the same horizons');
  }

  const horizonComparisons = detectorHorizons
    .slice()
    .sort((left, right) => left - right)
    .map((horizonMinutes): AlertOutcomeBaselineHorizonComparison => {
      const detectorStatistics = findHorizon(detector, horizonMinutes);
      const baselineStatistics = findHorizon(baseline, horizonMinutes);
      const winRateDeltaPercent =
        detectorStatistics.winRatePercent - baselineStatistics.winRatePercent;
      const averageDirectionAdjustedReturnDeltaPercent =
        detectorStatistics.averageDirectionAdjustedReturnPercent -
        baselineStatistics.averageDirectionAdjustedReturnPercent;
      const averageMaximumFavorableExcursionDeltaPercent = difference(
        detectorStatistics.averageMaximumFavorableExcursionPercent,
        baselineStatistics.averageMaximumFavorableExcursionPercent,
      );
      const averageMaximumAdverseExcursionDeltaPercent = difference(
        detectorStatistics.averageMaximumAdverseExcursionPercent,
        baselineStatistics.averageMaximumAdverseExcursionPercent,
      );

      const positive =
        winRateDeltaPercent > 0 ||
        averageDirectionAdjustedReturnDeltaPercent > 0 ||
        (averageMaximumFavorableExcursionDeltaPercent !== null &&
          averageMaximumFavorableExcursionDeltaPercent > 0) ||
        (averageMaximumAdverseExcursionDeltaPercent !== null &&
          averageMaximumAdverseExcursionDeltaPercent < 0);
      const negative =
        winRateDeltaPercent < 0 ||
        averageDirectionAdjustedReturnDeltaPercent < 0 ||
        (averageMaximumFavorableExcursionDeltaPercent !== null &&
          averageMaximumFavorableExcursionDeltaPercent < 0) ||
        (averageMaximumAdverseExcursionDeltaPercent !== null &&
          averageMaximumAdverseExcursionDeltaPercent > 0);

      const outcome: BaselineComparisonOutcome = positive
        ? negative
          ? averageDirectionAdjustedReturnDeltaPercent >= 0
            ? 'OUTPERFORMED'
            : 'UNDERPERFORMED'
          : 'OUTPERFORMED'
        : negative
          ? 'UNDERPERFORMED'
          : 'MATCHED';

      return Object.freeze({
        horizonMinutes,
        detectorSampleSize: detectorStatistics.sampleSize,
        baselineSampleSize: baselineStatistics.sampleSize,
        winRateDeltaPercent,
        averageDirectionAdjustedReturnDeltaPercent,
        averageMaximumFavorableExcursionDeltaPercent,
        averageMaximumAdverseExcursionDeltaPercent,
        outcome,
      });
    });

  return Object.freeze({
    schemaVersion: ALERT_OUTCOME_BASELINE_COMPARISON_SCHEMA_VERSION,
    detectorEvaluationId: detector.evaluationId,
    baselineEvaluationId: baseline.evaluationId,
    horizonComparisons: Object.freeze(horizonComparisons),
    outperformedHorizons: horizonComparisons.filter(
      (comparison) => comparison.outcome === 'OUTPERFORMED',
    ).length,
    matchedHorizons: horizonComparisons.filter(
      (comparison) => comparison.outcome === 'MATCHED',
    ).length,
    underperformedHorizons: horizonComparisons.filter(
      (comparison) => comparison.outcome === 'UNDERPERFORMED',
    ).length,
    complete: true,
    liveOrderExecutionAllowed: false,
  });
};
