import {
  prepareEvidenceRecords,
  type JoinedEvidenceObservation,
} from './evidenceIntegrity';
import {
  hasObservedExcursionPath,
  isAlertOutcomeHorizonMinutes,
  type AlertOutcomeHorizonMinutes,
  type AlertOutcomeObservation,
} from './alertOutcomeObservation';
import { EVIDENCE_PRIMARY_HORIZON_MINUTES } from './evidenceEvaluationDefinition';
import { selectIndependentEvidenceAlertIds } from './evidenceIndependence';
import type { QualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

export interface ProfitabilityPolicy {
  startingCapital: number;
  positionNotional: number;
  roundTripCostPercent: number;
  primaryHorizonMinutes: AlertOutcomeHorizonMinutes;
}

export interface ProfitabilityGroup {
  key: string;
  observations: number;
  wins: number;
  losses: number;
  flat: number;
  winRatePercent: number;
  averageGrossReturnPercent: number;
  medianGrossReturnPercent: number;
  averageNetReturnPercent: number;
  grossExpectancyUsdt: number;
  netExpectancyUsdt: number;
  hypotheticalNetPnlUsdt: number;
  excursionSampleSize: number;
  averageMfePercent: number | null;
  averageMaePercent: number | null;
}

export interface EvidenceProfitabilityReport {
  generatedAt: number;
  evaluationId: string;
  policy: ProfitabilityPolicy;
  qualifiedAlerts: number;
  completedObservations: number;
  primaryHorizonCompleteAlerts: number;
  independentPrimaryHorizonAlerts: number;
  dependentPrimaryHorizonAlerts: number;
  unmatchedObservations: number;
  malformedRecords: number;
  overall: ProfitabilityGroup;
  byHorizon: readonly ProfitabilityGroup[];
  byInstrument: readonly ProfitabilityGroup[];
  byDirection: readonly ProfitabilityGroup[];
  insufficientData: boolean;
  liveOrderExecutionAllowed: false;
  orderExecutionAuthorized: false;
}

const round = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const average = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const nullableAverage = (values: readonly number[]): number | null =>
  values.length === 0 ? null : round(average(values));

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
};

export const validateProfitabilityPolicy = (
  policy: ProfitabilityPolicy,
): ProfitabilityPolicy => {
  if (!Number.isFinite(policy.startingCapital) || policy.startingCapital <= 0) {
    throw new Error('startingCapital must be a positive finite number');
  }
  if (
    !Number.isFinite(policy.positionNotional) ||
    policy.positionNotional <= 0
  ) {
    throw new Error('positionNotional must be a positive finite number');
  }
  if (
    !Number.isFinite(policy.roundTripCostPercent) ||
    policy.roundTripCostPercent < 0
  ) {
    throw new Error(
      'roundTripCostPercent must be a non-negative finite number',
    );
  }
  if (!isAlertOutcomeHorizonMinutes(policy.primaryHorizonMinutes)) {
    throw new Error('primaryHorizonMinutes is not a supported outcome horizon');
  }
  return Object.freeze({ ...policy });
};

const summarize = (
  key: string,
  observations: readonly JoinedEvidenceObservation[],
  policy: ProfitabilityPolicy,
): ProfitabilityGroup => {
  const grossReturns = observations.map(
    ({ outcome }) => outcome.directionAdjustedReturnPercent,
  );
  const netReturns = grossReturns.map(
    (value) => value - policy.roundTripCostPercent,
  );
  const wins = netReturns.filter((value) => value > 0).length;
  const losses = netReturns.filter((value) => value < 0).length;
  const flat = netReturns.length - wins - losses;
  const notionalMultiplier = policy.positionNotional / 100;
  const pathObservations = observations.filter(({ outcome }) =>
    hasObservedExcursionPath(outcome),
  );

  return Object.freeze({
    key,
    observations: observations.length,
    wins,
    losses,
    flat,
    winRatePercent: round(
      observations.length === 0 ? 0 : (wins / observations.length) * 100,
    ),
    averageGrossReturnPercent: round(average(grossReturns)),
    medianGrossReturnPercent: round(median(grossReturns)),
    averageNetReturnPercent: round(average(netReturns)),
    grossExpectancyUsdt: round(average(grossReturns) * notionalMultiplier),
    netExpectancyUsdt: round(average(netReturns) * notionalMultiplier),
    hypotheticalNetPnlUsdt: round(
      netReturns.reduce((sum, value) => sum + value * notionalMultiplier, 0),
    ),
    excursionSampleSize: pathObservations.length,
    averageMfePercent: nullableAverage(
      pathObservations.map(
        ({ outcome }) => outcome.maximumFavorableExcursionPercent,
      ),
    ),
    averageMaePercent: nullableAverage(
      pathObservations.map(
        ({ outcome }) => outcome.maximumAdverseExcursionPercent,
      ),
    ),
  });
};

const groupBy = (
  observations: readonly JoinedEvidenceObservation[],
  keyOf: (item: JoinedEvidenceObservation) => string,
  policy: ProfitabilityPolicy,
): readonly ProfitabilityGroup[] => {
  const groups = new Map<string, JoinedEvidenceObservation[]>();
  for (const item of observations) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return Object.freeze(
    [...groups.entries()]
      .sort(([left], [right]) =>
        left.localeCompare(right, undefined, { numeric: true }),
      )
      .map(([key, values]) => summarize(key, values, policy)),
  );
};

export const createEvidenceProfitabilityReport = (input: {
  generatedAt: number;
  evaluationId: string;
  alerts: readonly QualifiedAlertEvidenceRecord[];
  outcomes: readonly AlertOutcomeObservation[];
  malformedRecords?: number;
  policy?: Partial<ProfitabilityPolicy>;
}): EvidenceProfitabilityReport => {
  const policy = validateProfitabilityPolicy({
    startingCapital: input.policy?.startingCapital ?? 10_000,
    positionNotional: input.policy?.positionNotional ?? 100,
    roundTripCostPercent: input.policy?.roundTripCostPercent ?? 0.2,
    primaryHorizonMinutes:
      input.policy?.primaryHorizonMinutes ?? EVIDENCE_PRIMARY_HORIZON_MINUTES,
  });
  const integrity = prepareEvidenceRecords({
    evaluationId: input.evaluationId,
    alerts: input.alerts,
    outcomes: input.outcomes,
    malformedRecords: input.malformedRecords,
  });
  const joined = integrity.joined;
  const primaryJoined = joined.filter(
    ({ outcome }) =>
      outcome.horizonMinutes === policy.primaryHorizonMinutes,
  );
  const independentIds = selectIndependentEvidenceAlertIds(
    primaryJoined.map(({ alert }) => alert),
    [policy.primaryHorizonMinutes],
  );
  const independentPrimaryJoined = primaryJoined.filter(({ alert }) =>
    independentIds.has(alert.alertId),
  );

  return Object.freeze({
    generatedAt: input.generatedAt,
    evaluationId: input.evaluationId,
    policy,
    qualifiedAlerts: integrity.alerts.length,
    completedObservations: integrity.outcomes.length,
    primaryHorizonCompleteAlerts: primaryJoined.length,
    independentPrimaryHorizonAlerts: independentPrimaryJoined.length,
    dependentPrimaryHorizonAlerts:
      primaryJoined.length - independentPrimaryJoined.length,
    unmatchedObservations: integrity.unmatchedObservations,
    malformedRecords: integrity.malformedRecords,
    overall: summarize(
      `INDEPENDENT_PRIMARY_${policy.primaryHorizonMinutes}m`,
      independentPrimaryJoined,
      policy,
    ),
    byHorizon: groupBy(
      joined,
      ({ outcome }) => `${outcome.horizonMinutes}m`,
      policy,
    ),
    byInstrument: groupBy(
      independentPrimaryJoined,
      ({ alert }) => alert.instrumentId,
      policy,
    ),
    byDirection: groupBy(
      independentPrimaryJoined,
      ({ alert }) => alert.direction,
      policy,
    ),
    insufficientData: independentPrimaryJoined.length < 100,
    liveOrderExecutionAllowed: false,
    orderExecutionAuthorized: false,
  });
};
