import {
  ALERT_OUTCOME_HORIZONS_MINUTES,
  hasObservedExcursionPath,
  type AlertOutcomeHorizonMinutes,
} from './alertOutcomeObservation';
import {
  validateQualifiedAlertOutcomeBundle,
  type QualifiedAlertOutcomeBundle,
} from './qualifiedAlertOutcomeBundle';

export const AGGREGATE_ALERT_OUTCOME_STATISTICS_SCHEMA_VERSION = 1 as const;

export interface AlertOutcomeHorizonStatistics {
  horizonMinutes: AlertOutcomeHorizonMinutes;
  sampleSize: number;
  wins: number;
  losses: number;
  flats: number;
  winRatePercent: number;
  averageDirectionAdjustedReturnPercent: number;
  excursionSampleSize: number;
  averageMaximumFavorableExcursionPercent: number | null;
  averageMaximumAdverseExcursionPercent: number | null;
}

export interface AggregateAlertOutcomeStatistics {
  schemaVersion: typeof AGGREGATE_ALERT_OUTCOME_STATISTICS_SCHEMA_VERSION;
  evaluationId: string;
  bundleCount: number;
  horizonStatistics: readonly AlertOutcomeHorizonStatistics[];
  complete: true;
  liveOrderExecutionAllowed: false;
}

const average = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

export const aggregateAlertOutcomeStatistics = (
  bundles: readonly QualifiedAlertOutcomeBundle[],
): AggregateAlertOutcomeStatistics => {
  if (bundles.length === 0) {
    throw new Error('At least one qualified alert outcome bundle is required');
  }

  const evaluationId = bundles[0]!.evidence.evaluationId;

  for (const bundle of bundles) {
    validateQualifiedAlertOutcomeBundle(bundle);
    if (bundle.evidence.evaluationId !== evaluationId) {
      throw new Error('All bundles must belong to the same evaluation');
    }
  }

  const horizonStatistics = ALERT_OUTCOME_HORIZONS_MINUTES.map(
    (horizonMinutes): AlertOutcomeHorizonStatistics => {
      const observations = bundles.map((bundle) => {
        const observation = bundle.observations.find(
          (candidate) => candidate.horizonMinutes === horizonMinutes,
        );

        if (observation === undefined) {
          throw new Error(
            `Bundle is missing the ${horizonMinutes}-minute observation`,
          );
        }

        return observation;
      });

      const returns = observations.map(
        (observation) => observation.directionAdjustedReturnPercent,
      );
      const wins = returns.filter((value) => value > 0).length;
      const losses = returns.filter((value) => value < 0).length;
      const flats = returns.length - wins - losses;
      const pathObservations = observations.filter(hasObservedExcursionPath);

      return Object.freeze({
        horizonMinutes,
        sampleSize: observations.length,
        wins,
        losses,
        flats,
        winRatePercent: (wins / observations.length) * 100,
        averageDirectionAdjustedReturnPercent: average(returns),
        excursionSampleSize: pathObservations.length,
        averageMaximumFavorableExcursionPercent:
          pathObservations.length === 0
            ? null
            : average(
                pathObservations.map(
                  (observation) => observation.maximumFavorableExcursionPercent,
                ),
              ),
        averageMaximumAdverseExcursionPercent:
          pathObservations.length === 0
            ? null
            : average(
                pathObservations.map(
                  (observation) => observation.maximumAdverseExcursionPercent,
                ),
              ),
      });
    },
  );

  return Object.freeze({
    schemaVersion: AGGREGATE_ALERT_OUTCOME_STATISTICS_SCHEMA_VERSION,
    evaluationId,
    bundleCount: bundles.length,
    horizonStatistics: Object.freeze(horizonStatistics),
    complete: true,
    liveOrderExecutionAllowed: false,
  });
};
