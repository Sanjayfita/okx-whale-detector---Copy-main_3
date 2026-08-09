import type { AlertQualityTerminalReturnGroup } from './alertQualityTerminalReturnAggregator';
import type { AlertQualityUnifiedReport } from './alertQualityUnifiedReport';

export type AlertQualityThresholdStatus = 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA';

export type AlertQualityThresholdReason =
  | 'MINIMUM_SAMPLE_COUNT'
  | 'MINIMUM_ELIGIBLE_RATE'
  | 'MINIMUM_WIN_RATE'
  | 'MINIMUM_EXPECTANCY'
  | 'MAXIMUM_AMBIGUITY_RATE'
  | 'UNAVAILABLE_REQUIRED_METRIC';

export interface AlertQualityThresholdPolicy {
  minimumSampleCount: number;
  minimumEligibleRate: number;
  minimumWinRate: number;
  minimumExpectancyPercent: number;
  maximumAmbiguityRate: number;
}

export interface AlertQualityThresholdObservation {
  sampleCount: number;
  eligibleRate: number | null;
  winRate: number | null;
  expectancyPercent: number | null;
  ambiguityRate: number | null;
}

export interface AlertQualityThresholdEvaluation {
  groupKey: string;
  dimension: AlertQualityTerminalReturnGroup['dimension'];
  value: AlertQualityTerminalReturnGroup['value'];
  status: AlertQualityThresholdStatus;
  reasons: readonly AlertQualityThresholdReason[];
  observation: Readonly<AlertQualityThresholdObservation>;
}

export interface AlertQualityThresholdReport {
  reportRunId: string;
  generatedAt: number;
  policy: Readonly<AlertQualityThresholdPolicy>;
  evaluations: readonly AlertQualityThresholdEvaluation[];
  passedCount: number;
  failedCount: number;
  insufficientDataCount: number;
}

const assertRate = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number between 0 and 1`);
  }
};

export const createAlertQualityThresholdPolicy = (
  overrides: Partial<AlertQualityThresholdPolicy> = {},
): Readonly<AlertQualityThresholdPolicy> => {
  const policy: AlertQualityThresholdPolicy = {
    minimumSampleCount: overrides.minimumSampleCount ?? 30,
    minimumEligibleRate: overrides.minimumEligibleRate ?? 0.8,
    minimumWinRate: overrides.minimumWinRate ?? 0.5,
    minimumExpectancyPercent: overrides.minimumExpectancyPercent ?? 0,
    maximumAmbiguityRate: overrides.maximumAmbiguityRate ?? 0.1,
  };
  if (!Number.isSafeInteger(policy.minimumSampleCount) || policy.minimumSampleCount < 1) {
    throw new Error('minimumSampleCount must be a positive safe integer');
  }
  assertRate('minimumEligibleRate', policy.minimumEligibleRate);
  assertRate('minimumWinRate', policy.minimumWinRate);
  assertRate('maximumAmbiguityRate', policy.maximumAmbiguityRate);
  if (!Number.isFinite(policy.minimumExpectancyPercent)) {
    throw new Error('minimumExpectancyPercent must be finite');
  }
  return Object.freeze(policy);
};

const evaluateGroup = (
  group: AlertQualityTerminalReturnGroup,
  policy: AlertQualityThresholdPolicy,
): AlertQualityThresholdEvaluation => {
  const statistics = group.returns.okxExecutableDirectionalReturnPercent;
  const observation: AlertQualityThresholdObservation = {
    sampleCount: statistics.observationCount,
    eligibleRate: group.coverage.eligibleRate,
    winRate: statistics.positiveRate,
    expectancyPercent: statistics.mean,
    ambiguityRate: group.coverage.ambiguityRate,
  };
  const reasons: AlertQualityThresholdReason[] = [];

  if (observation.sampleCount < policy.minimumSampleCount) {
    reasons.push('MINIMUM_SAMPLE_COUNT');
  }
  const required = [
    observation.eligibleRate,
    observation.winRate,
    observation.expectancyPercent,
    observation.ambiguityRate,
  ];
  if (required.some((value) => value === null)) {
    reasons.push('UNAVAILABLE_REQUIRED_METRIC');
  }
  if (observation.eligibleRate !== null && observation.eligibleRate < policy.minimumEligibleRate) {
    reasons.push('MINIMUM_ELIGIBLE_RATE');
  }
  if (observation.winRate !== null && observation.winRate < policy.minimumWinRate) {
    reasons.push('MINIMUM_WIN_RATE');
  }
  if (
    observation.expectancyPercent !== null &&
    observation.expectancyPercent < policy.minimumExpectancyPercent
  ) {
    reasons.push('MINIMUM_EXPECTANCY');
  }
  if (
    observation.ambiguityRate !== null &&
    observation.ambiguityRate > policy.maximumAmbiguityRate
  ) {
    reasons.push('MAXIMUM_AMBIGUITY_RATE');
  }

  const insufficient = reasons.includes('MINIMUM_SAMPLE_COUNT') ||
    reasons.includes('UNAVAILABLE_REQUIRED_METRIC');
  const status: AlertQualityThresholdStatus =
    reasons.length === 0 ? 'PASS' : insufficient ? 'INSUFFICIENT_DATA' : 'FAIL';

  return Object.freeze({
    groupKey: group.groupKey,
    dimension: group.dimension,
    value: group.value,
    status,
    reasons: Object.freeze(reasons),
    observation: Object.freeze(observation),
  });
};

export const evaluateAlertQualityThresholds = (input: {
  report: AlertQualityUnifiedReport;
  policy?: AlertQualityThresholdPolicy;
}): AlertQualityThresholdReport => {
  const policy = createAlertQualityThresholdPolicy(input.policy);
  const evaluations = input.report.terminalReturn.groups
    .map((group) => evaluateGroup(group, policy))
    .sort((left, right) => left.groupKey.localeCompare(right.groupKey));
  const count = (status: AlertQualityThresholdStatus): number =>
    evaluations.filter((evaluation) => evaluation.status === status).length;

  return Object.freeze({
    reportRunId: input.report.reportRunId,
    generatedAt: input.report.generatedAt,
    policy,
    evaluations: Object.freeze(evaluations),
    passedCount: count('PASS'),
    failedCount: count('FAIL'),
    insufficientDataCount: count('INSUFFICIENT_DATA'),
  });
};
