import {
  hasObservedExcursionPath,
  isAlertOutcomeHorizonMinutes,
  type AlertOutcomeHorizonMinutes,
  type AlertOutcomeObservation,
} from './alertOutcomeObservation';

export interface StrategyReturnMetrics {
  readonly sampleSize: number;
  readonly winCount: number;
  readonly lossCount: number;
  readonly flatCount: number;
  readonly winRate: number | null;
  readonly expectancyPercent: number | null;
  readonly cumulativeReturnPercent: number;
  readonly grossProfitPercent: number;
  readonly grossLossPercent: number;
  readonly profitFactor: number | null;
  readonly eventSharpe: number | null;
  readonly eventSortino: number | null;
  readonly maximumDrawdownPercent: number;
  readonly recoveryFactor: number | null;
}

export interface TradeManagementPolicy {
  readonly horizonMinutes: AlertOutcomeHorizonMinutes;
  readonly targetPercent: number;
  readonly stopPercent: number;
  readonly roundTripCostPercent: number;
}

export type TradeManagementResolution =
  | 'TARGET_REACHED'
  | 'STOP_REACHED'
  | 'TERMINAL_EXIT'
  | 'AMBIGUOUS_BARRIER_ORDER';

export interface TradeManagementObservationResult {
  readonly alertId: string;
  readonly instrumentId: string;
  readonly detectedAt: number;
  readonly resolution: TradeManagementResolution;
  readonly lowerBoundNetReturnPercent: number;
  readonly upperBoundNetReturnPercent: number;
}

export interface TradeManagementResearchReport {
  readonly policy: TradeManagementPolicy;
  readonly inputObservationCount: number;
  readonly ignoredOtherHorizonCount: number;
  readonly unavailablePathCount: number;
  readonly observedPathSampleSize: number;
  readonly ambiguousBarrierOrderCount: number;
  readonly ambiguousBarrierOrderFraction: number | null;
  readonly targetReachedCount: number;
  readonly stopReachedCount: number;
  readonly terminalExitCount: number;
  readonly lowerBoundMetrics: StrategyReturnMetrics;
  readonly upperBoundMetrics: StrategyReturnMetrics;
  readonly unambiguousMetrics: StrategyReturnMetrics;
  readonly observations: readonly TradeManagementObservationResult[];
  readonly liveOrderExecutionAllowed: false;
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleStandardDeviation = (values: readonly number[]): number | null => {
  if (values.length < 2) return null;
  const average = mean(values);
  if (average === null) return null;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      (values.length - 1),
  );
};

export const calculateStrategyReturnMetrics = (
  returns: readonly number[],
): StrategyReturnMetrics => {
  if (returns.some((value) => !Number.isFinite(value))) {
    throw new Error('Strategy returns must be finite');
  }
  const winCount = returns.filter((value) => value > 0).length;
  const lossCount = returns.filter((value) => value < 0).length;
  const flatCount = returns.length - winCount - lossCount;
  const grossProfitPercent = returns
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  const grossLossPercent = returns
    .filter((value) => value < 0)
    .reduce((sum, value) => sum + value, 0);
  const cumulativeReturnPercent = returns.reduce(
    (sum, value) => sum + value,
    0,
  );
  let runningReturn = 0;
  let runningPeak = 0;
  let maximumDrawdownPercent = 0;
  for (const value of returns) {
    runningReturn += value;
    runningPeak = Math.max(runningPeak, runningReturn);
    maximumDrawdownPercent = Math.max(
      maximumDrawdownPercent,
      runningPeak - runningReturn,
    );
  }
  const expectancyPercent = mean(returns);
  const standardDeviation = sampleStandardDeviation(returns);
  const downsideDeviation =
    returns.length === 0
      ? null
      : Math.sqrt(
          returns.reduce(
            (sum, value) => sum + Math.min(0, value) ** 2,
            0,
          ) / returns.length,
        );
  return Object.freeze({
    sampleSize: returns.length,
    winCount,
    lossCount,
    flatCount,
    winRate: returns.length === 0 ? null : winCount / returns.length,
    expectancyPercent,
    cumulativeReturnPercent,
    grossProfitPercent,
    grossLossPercent,
    profitFactor:
      grossLossPercent === 0
        ? null
        : grossProfitPercent / Math.abs(grossLossPercent),
    eventSharpe:
      expectancyPercent === null ||
      standardDeviation === null ||
      standardDeviation === 0
        ? null
        : expectancyPercent / standardDeviation,
    eventSortino:
      expectancyPercent === null ||
      downsideDeviation === null ||
      downsideDeviation === 0
        ? null
        : expectancyPercent / downsideDeviation,
    maximumDrawdownPercent,
    recoveryFactor:
      maximumDrawdownPercent === 0
        ? null
        : cumulativeReturnPercent / maximumDrawdownPercent,
  });
};

const validatePolicy = (policy: TradeManagementPolicy): void => {
  if (!isAlertOutcomeHorizonMinutes(policy.horizonMinutes)) {
    throw new Error('Trade-management horizon is unsupported');
  }
  if (!Number.isFinite(policy.targetPercent) || policy.targetPercent <= 0) {
    throw new Error('targetPercent must be a positive finite number');
  }
  if (!Number.isFinite(policy.stopPercent) || policy.stopPercent <= 0) {
    throw new Error('stopPercent must be a positive finite number');
  }
  if (
    !Number.isFinite(policy.roundTripCostPercent) ||
    policy.roundTripCostPercent < 0
  ) {
    throw new Error('roundTripCostPercent must be non-negative and finite');
  }
};

const resolveObservation = (
  observation: AlertOutcomeObservation,
  policy: TradeManagementPolicy,
): TradeManagementObservationResult => {
  const targetReached =
    observation.maximumFavorableExcursionPercent >= policy.targetPercent;
  const stopReached =
    observation.maximumAdverseExcursionPercent >= policy.stopPercent;
  let resolution: TradeManagementResolution;
  let lowerGrossReturnPercent: number;
  let upperGrossReturnPercent: number;
  if (targetReached && stopReached) {
    resolution = 'AMBIGUOUS_BARRIER_ORDER';
    lowerGrossReturnPercent = -policy.stopPercent;
    upperGrossReturnPercent = policy.targetPercent;
  } else if (targetReached) {
    resolution = 'TARGET_REACHED';
    lowerGrossReturnPercent = policy.targetPercent;
    upperGrossReturnPercent = policy.targetPercent;
  } else if (stopReached) {
    resolution = 'STOP_REACHED';
    lowerGrossReturnPercent = -policy.stopPercent;
    upperGrossReturnPercent = -policy.stopPercent;
  } else {
    resolution = 'TERMINAL_EXIT';
    lowerGrossReturnPercent = observation.directionAdjustedReturnPercent;
    upperGrossReturnPercent = observation.directionAdjustedReturnPercent;
  }
  return Object.freeze({
    alertId: observation.alertId,
    instrumentId: observation.instrumentId,
    detectedAt: observation.detectedAt,
    resolution,
    lowerBoundNetReturnPercent:
      lowerGrossReturnPercent - policy.roundTripCostPercent,
    upperBoundNetReturnPercent:
      upperGrossReturnPercent - policy.roundTripCostPercent,
  });
};

export const evaluateTradeManagementPolicy = (input: {
  readonly observations: readonly AlertOutcomeObservation[];
  readonly policy: TradeManagementPolicy;
}): TradeManagementResearchReport => {
  validatePolicy(input.policy);
  const matchingHorizon = input.observations.filter(
    (observation) => observation.horizonMinutes === input.policy.horizonMinutes,
  );
  const identifiers = new Set<string>();
  for (const observation of matchingHorizon) {
    const identifier = `${observation.evaluationId}:${observation.alertId}`;
    if (identifiers.has(identifier)) {
      throw new Error(
        `Duplicate trade-management observation for ${observation.alertId}`,
      );
    }
    identifiers.add(identifier);
  }
  const pathObservations = matchingHorizon
    .filter(hasObservedExcursionPath)
    .sort(
      (left, right) =>
        left.detectedAt - right.detectedAt ||
        left.alertId.localeCompare(right.alertId),
    );
  const observations = Object.freeze(
    pathObservations.map((observation) =>
      resolveObservation(observation, input.policy),
    ),
  );
  const lowerReturns = observations.map(
    (observation) => observation.lowerBoundNetReturnPercent,
  );
  const upperReturns = observations.map(
    (observation) => observation.upperBoundNetReturnPercent,
  );
  const unambiguousReturns = observations
    .filter(
      (observation) =>
        observation.resolution !== 'AMBIGUOUS_BARRIER_ORDER',
    )
    .map((observation) => observation.lowerBoundNetReturnPercent);
  const ambiguousBarrierOrderCount = observations.filter(
    (observation) => observation.resolution === 'AMBIGUOUS_BARRIER_ORDER',
  ).length;
  return Object.freeze({
    policy: Object.freeze({ ...input.policy }),
    inputObservationCount: input.observations.length,
    ignoredOtherHorizonCount:
      input.observations.length - matchingHorizon.length,
    unavailablePathCount: matchingHorizon.length - pathObservations.length,
    observedPathSampleSize: pathObservations.length,
    ambiguousBarrierOrderCount,
    ambiguousBarrierOrderFraction:
      observations.length === 0
        ? null
        : ambiguousBarrierOrderCount / observations.length,
    targetReachedCount: observations.filter(
      (observation) => observation.resolution === 'TARGET_REACHED',
    ).length,
    stopReachedCount: observations.filter(
      (observation) => observation.resolution === 'STOP_REACHED',
    ).length,
    terminalExitCount: observations.filter(
      (observation) => observation.resolution === 'TERMINAL_EXIT',
    ).length,
    lowerBoundMetrics: calculateStrategyReturnMetrics(lowerReturns),
    upperBoundMetrics: calculateStrategyReturnMetrics(upperReturns),
    unambiguousMetrics: calculateStrategyReturnMetrics(unambiguousReturns),
    observations,
    liveOrderExecutionAllowed: false,
  });
};
