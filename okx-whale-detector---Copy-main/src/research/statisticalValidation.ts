import {
  hasObservedExcursionPath,
  type AlertOutcomeObservation,
} from './alertOutcomeObservation';
import {
  validateProfitabilityPolicy,
  type ProfitabilityPolicy,
} from './evidenceProfitability';
import { selectIndependentEvidenceAlertIds } from './evidenceIndependence';
import { prepareEvidenceRecords } from './evidenceIntegrity';
import type { QualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

export interface MeanConfidenceInterval {
  readonly confidenceLevel: number;
  readonly iterations: number;
  readonly blockSize: number;
  readonly mean: number;
  readonly lower: number;
  readonly upper: number;
}

export interface ChronologicalSplitSummary {
  readonly purgeMs: number;
  readonly trainCount: number;
  readonly validationCount: number;
  readonly testCount: number;
  readonly trainMeanNetReturnPercent: number;
  readonly validationMeanNetReturnPercent: number;
  readonly testMeanNetReturnPercent: number;
}

export interface MultipleTestingResult {
  readonly key: string;
  readonly rawPValue: number;
  readonly adjustedPValue: number;
  readonly rejected: boolean;
}

export interface HorizonStatisticalValidation {
  readonly horizonMinutes: number;
  readonly observations: number;
  readonly meanNetReturnPercent: number;
  readonly confidenceInterval: MeanConfidenceInterval;
  readonly significance: MultipleTestingResult;
}

export interface RegimeStatisticalValidation {
  readonly regime: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly basis: 'OUTCOME_PATH_VOLATILITY';
  readonly availableAtDecisionTime: false;
  readonly observations: number;
  readonly meanNetReturnPercent: number;
}

export interface FeeSensitivityPoint {
  readonly roundTripCostPercent: number;
  readonly meanNetReturnPercent: number;
  readonly positive: boolean;
}

export interface StatisticalValidationReport {
  readonly generatedAt: number;
  readonly evaluationId: string;
  readonly matchedObservations: number;
  readonly primaryHorizonMinutes: number;
  readonly primaryHorizonObservations: number;
  readonly independentAlerts: number;
  readonly dependentPrimaryHorizonAlerts: number;
  readonly unmatchedObservations: number;
  readonly malformedRecords: number;
  readonly sampleRequirement: number;
  readonly sampleRequirementMet: boolean;
  readonly overallConfidenceInterval: MeanConfidenceInterval;
  readonly chronologicalSplit: ChronologicalSplitSummary;
  readonly byHorizon: readonly HorizonStatisticalValidation[];
  readonly byRegime: readonly RegimeStatisticalValidation[];
  readonly pathExcursionObservations: number;
  readonly feeSensitivity: readonly FeeSensitivityPoint[];
  readonly readyForQualification: boolean;
  readonly reasons: readonly string[];
  readonly liveOrderExecutionAllowed: false;
  readonly orderExecutionAuthorized: false;
}

interface JoinedObservation {
  readonly alert: QualifiedAlertEvidenceRecord;
  readonly outcome: AlertOutcomeObservation;
  readonly netReturnPercent: number;
}

export interface StatisticalValidationOptions {
  readonly confidenceLevel?: number;
  readonly bootstrapIterations?: number;
  readonly bootstrapBlockSize?: number;
  readonly minimumSampleSize?: number;
  readonly purgeMs?: number;
  readonly trainRatio?: number;
  readonly validationRatio?: number;
  readonly falseDiscoveryRate?: number;
  readonly randomSeed?: number;
}

const round = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const average = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const quantile = (values: readonly number[], probability: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
};

const createRandom = (seed: number): (() => number) => {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const errorFunction = (value: number): number => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-x * x);
  return sign * y;
};

const twoSidedSignPValue = (values: readonly number[]): number => {
  const positives = values.filter((value) => value > 0).length;
  const negatives = values.filter((value) => value < 0).length;
  const trials = positives + negatives;
  if (trials === 0) return 1;

  const difference = Math.abs(positives - trials / 2);
  const continuityCorrected = Math.max(0, difference - 0.5);
  const z = continuityCorrected / Math.sqrt(trials / 4);
  const normalCdf = 0.5 * (1 + errorFunction(z / Math.sqrt(2)));
  return Math.max(0, Math.min(1, 2 * (1 - normalCdf)));
};

export const blockBootstrapMeanConfidenceInterval = (
  values: readonly number[],
  options: {
    readonly confidenceLevel?: number;
    readonly iterations?: number;
    readonly blockSize?: number;
    readonly random?: () => number;
  } = {},
): MeanConfidenceInterval => {
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  const iterations = options.iterations ?? 2_000;
  const requestedBlockSize =
    options.blockSize ?? Math.ceil(Math.sqrt(values.length || 1));

  if (
    !Number.isFinite(confidenceLevel) ||
    confidenceLevel <= 0 ||
    confidenceLevel >= 1
  ) {
    throw new Error('confidenceLevel must be between 0 and 1');
  }
  if (
    !Number.isSafeInteger(iterations) ||
    iterations <= 0 ||
    iterations > 1_000_000
  ) {
    throw new Error(
      'iterations must be a positive safe integer no greater than 1,000,000',
    );
  }
  if (!Number.isSafeInteger(requestedBlockSize) || requestedBlockSize <= 0) {
    throw new Error('blockSize must be a positive safe integer');
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('bootstrap values must all be finite');
  }

  const blockSize = Math.min(requestedBlockSize, Math.max(1, values.length));
  if (values.length === 0) {
    return Object.freeze({
      confidenceLevel,
      iterations,
      blockSize,
      mean: 0,
      lower: 0,
      upper: 0,
    });
  }

  const random = options.random ?? createRandom(0x5eed_1234);
  const bootstrapMeans: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample: number[] = [];
    while (sample.length < values.length) {
      const randomValue = random();
      if (
        !Number.isFinite(randomValue) ||
        randomValue < 0 ||
        randomValue >= 1
      ) {
        throw new Error('random must return a finite value in [0, 1)');
      }
      const start = Math.floor(randomValue * values.length);
      for (
        let offset = 0;
        offset < blockSize && sample.length < values.length;
        offset += 1
      ) {
        sample.push(values[(start + offset) % values.length] ?? 0);
      }
    }
    bootstrapMeans.push(average(sample));
  }

  const tailProbability = (1 - confidenceLevel) / 2;
  return Object.freeze({
    confidenceLevel,
    iterations,
    blockSize,
    mean: round(average(values)),
    lower: round(quantile(bootstrapMeans, tailProbability)),
    upper: round(quantile(bootstrapMeans, 1 - tailProbability)),
  });
};

export const applyBenjaminiHochberg = (
  values: readonly { key: string; pValue: number }[],
  falseDiscoveryRate = 0.05,
): readonly MultipleTestingResult[] => {
  if (
    !Number.isFinite(falseDiscoveryRate) ||
    falseDiscoveryRate <= 0 ||
    falseDiscoveryRate >= 1
  ) {
    throw new Error('falseDiscoveryRate must be between 0 and 1');
  }

  const keys = new Set<string>();
  for (const item of values) {
    if (
      item.key.trim().length === 0 ||
      keys.has(item.key) ||
      !Number.isFinite(item.pValue) ||
      item.pValue < 0 ||
      item.pValue > 1
    ) {
      throw new Error(
        'multiple-testing inputs require unique non-empty keys and p-values in [0, 1]',
      );
    }
    keys.add(item.key);
  }

  const sorted = [...values].sort(
    (left, right) => left.pValue - right.pValue || left.key.localeCompare(right.key),
  );
  const adjusted = new Map<string, number>();
  let runningMinimum = 1;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const item = sorted[index];
    if (item === undefined) continue;
    runningMinimum = Math.min(
      runningMinimum,
      (item.pValue * sorted.length) / (index + 1),
    );
    adjusted.set(item.key, Math.min(1, runningMinimum));
  }

  return Object.freeze(
    values.map((item) => {
      const adjustedPValue = adjusted.get(item.key) ?? 1;
      return Object.freeze({
        key: item.key,
        rawPValue: round(item.pValue),
        adjustedPValue: round(adjustedPValue),
        rejected: adjustedPValue <= falseDiscoveryRate,
      });
    }),
  );
};

const createChronologicalSplit = (
  observations: readonly JoinedObservation[],
  options: Required<
    Pick<
      StatisticalValidationOptions,
      'purgeMs' | 'trainRatio' | 'validationRatio'
    >
  >,
): ChronologicalSplitSummary => {
  if (observations.length === 0) {
    return Object.freeze({
      purgeMs: options.purgeMs,
      trainCount: 0,
      validationCount: 0,
      testCount: 0,
      trainMeanNetReturnPercent: 0,
      validationMeanNetReturnPercent: 0,
      testMeanNetReturnPercent: 0,
    });
  }

  const sorted = [...observations].sort(
    (left, right) =>
      left.alert.detectedAt - right.alert.detectedAt ||
      left.alert.alertId.localeCompare(right.alert.alertId),
  );
  const firstBoundaryIndex = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(sorted.length * options.trainRatio)),
  );
  const secondBoundaryIndex = Math.min(
    sorted.length - 1,
    Math.max(
      firstBoundaryIndex,
      Math.floor(
        sorted.length * (options.trainRatio + options.validationRatio),
      ),
    ),
  );
  const firstBoundary =
    sorted[firstBoundaryIndex]?.alert.detectedAt ?? Number.POSITIVE_INFINITY;
  const secondBoundary =
    sorted[secondBoundaryIndex]?.alert.detectedAt ?? Number.POSITIVE_INFINITY;
  const train = sorted.filter(
    (item) => item.outcome.observedAt < firstBoundary - options.purgeMs,
  );
  const validation = sorted.filter(
    (item) =>
      item.alert.detectedAt > firstBoundary + options.purgeMs &&
      item.outcome.observedAt < secondBoundary - options.purgeMs,
  );
  const test = sorted.filter(
    (item) => item.alert.detectedAt > secondBoundary + options.purgeMs,
  );

  return Object.freeze({
    purgeMs: options.purgeMs,
    trainCount: train.length,
    validationCount: validation.length,
    testCount: test.length,
    trainMeanNetReturnPercent: round(
      average(train.map((item) => item.netReturnPercent)),
    ),
    validationMeanNetReturnPercent: round(
      average(validation.map((item) => item.netReturnPercent)),
    ),
    testMeanNetReturnPercent: round(
      average(test.map((item) => item.netReturnPercent)),
    ),
  });
};

export const createStatisticalValidationReport = (input: {
  readonly generatedAt: number;
  readonly evaluationId: string;
  readonly alerts: readonly QualifiedAlertEvidenceRecord[];
  readonly outcomes: readonly AlertOutcomeObservation[];
  readonly policy: ProfitabilityPolicy;
  readonly malformedRecords?: number;
  readonly options?: StatisticalValidationOptions;
}): StatisticalValidationReport => {
  const options = input.options ?? {};
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  const bootstrapIterations = options.bootstrapIterations ?? 2_000;
  const minimumSampleSize = options.minimumSampleSize ?? 1_000;
  const purgeMs = options.purgeMs ?? 60 * 60_000;
  const trainRatio = options.trainRatio ?? 0.6;
  const validationRatio = options.validationRatio ?? 0.2;
  const falseDiscoveryRate = options.falseDiscoveryRate ?? 0.05;
  const randomSeed = options.randomSeed ?? 0x5eed_1234;
  const policy = validateProfitabilityPolicy(input.policy);

  if (
    !Number.isFinite(trainRatio) ||
    !Number.isFinite(validationRatio) ||
    trainRatio <= 0 ||
    validationRatio <= 0 ||
    trainRatio + validationRatio >= 1
  ) {
    throw new Error(
      'chronological split ratios must leave a positive test set',
    );
  }
  if (!Number.isSafeInteger(minimumSampleSize) || minimumSampleSize <= 0) {
    throw new Error('minimumSampleSize must be a positive integer');
  }
  if (!Number.isSafeInteger(purgeMs) || purgeMs < 0) {
    throw new Error('purgeMs must be a non-negative safe integer');
  }
  if (
    !Number.isSafeInteger(randomSeed) ||
    randomSeed < 0 ||
    randomSeed > 0xffff_ffff
  ) {
    throw new Error('randomSeed must be an unsigned 32-bit integer');
  }

  const integrity = prepareEvidenceRecords({
    evaluationId: input.evaluationId,
    alerts: input.alerts,
    outcomes: input.outcomes,
    malformedRecords: input.malformedRecords,
  });
  const joined: JoinedObservation[] = integrity.joined.map(
    ({ alert, outcome }) =>
      Object.freeze({
        alert,
        outcome,
        netReturnPercent:
          outcome.directionAdjustedReturnPercent - policy.roundTripCostPercent,
      }),
  );
  const sortedJoined = [...joined].sort(
    (left, right) =>
      left.alert.detectedAt - right.alert.detectedAt ||
      left.outcome.horizonMinutes - right.outcome.horizonMinutes ||
      left.alert.alertId.localeCompare(right.alert.alertId),
  );
  const primaryJoined = sortedJoined.filter(
    (item) => item.outcome.horizonMinutes === policy.primaryHorizonMinutes,
  );
  const independentIds = selectIndependentEvidenceAlertIds(
    primaryJoined.map((item) => item.alert),
    [policy.primaryHorizonMinutes],
  );
  const independentPrimaryJoined = primaryJoined.filter((item) =>
    independentIds.has(item.alert.alertId),
  );
  const independentNetReturns = independentPrimaryJoined.map(
    (item) => item.netReturnPercent,
  );
  const overallConfidenceInterval = blockBootstrapMeanConfidenceInterval(
    independentNetReturns,
    {
      confidenceLevel,
      iterations: bootstrapIterations,
      blockSize: options.bootstrapBlockSize,
      random: createRandom(randomSeed),
    },
  );
  const chronologicalSplit = createChronologicalSplit(independentPrimaryJoined, {
    purgeMs,
    trainRatio,
    validationRatio,
  });

  const horizonGroups = new Map<number, JoinedObservation[]>();
  for (const item of sortedJoined) {
    const group = horizonGroups.get(item.outcome.horizonMinutes) ?? [];
    group.push(item);
    horizonGroups.set(item.outcome.horizonMinutes, group);
  }
  const rawHorizonPValues = [...horizonGroups.entries()].map(
    ([horizonMinutes, group]) => ({
      key: String(horizonMinutes),
      pValue: twoSidedSignPValue(group.map((item) => item.netReturnPercent)),
    }),
  );
  const adjustedByHorizon = new Map(
    applyBenjaminiHochberg(rawHorizonPValues, falseDiscoveryRate).map(
      (item) => [item.key, item],
    ),
  );
  const byHorizon: HorizonStatisticalValidation[] = [...horizonGroups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([horizonMinutes, group], index) => {
      const returns = group.map((item) => item.netReturnPercent);
      return Object.freeze({
        horizonMinutes,
        observations: group.length,
        meanNetReturnPercent: round(average(returns)),
        confidenceInterval: blockBootstrapMeanConfidenceInterval(returns, {
          confidenceLevel,
          iterations: bootstrapIterations,
          blockSize: options.bootstrapBlockSize,
          random: createRandom((randomSeed + index + 1) >>> 0),
        }),
        significance: adjustedByHorizon.get(String(horizonMinutes)) ??
          Object.freeze({
            key: String(horizonMinutes),
            rawPValue: 1,
            adjustedPValue: 1,
            rejected: false,
          }),
      });
    });

  const pathJoined = independentPrimaryJoined.filter((item) =>
    hasObservedExcursionPath(item.outcome),
  );
  const volatility = pathJoined.map(
    (item) =>
      item.outcome.maximumFavorableExcursionPercent +
      item.outcome.maximumAdverseExcursionPercent,
  );
  const lowCutoff = quantile(volatility, 1 / 3);
  const highCutoff = quantile(volatility, 2 / 3);
  const regimeGroups: Record<'LOW' | 'MEDIUM' | 'HIGH', number[]> = {
    LOW: [],
    MEDIUM: [],
    HIGH: [],
  };
  for (const item of pathJoined) {
    const value =
      item.outcome.maximumFavorableExcursionPercent +
      item.outcome.maximumAdverseExcursionPercent;
    const regime =
      value <= lowCutoff ? 'LOW' : value <= highCutoff ? 'MEDIUM' : 'HIGH';
    regimeGroups[regime].push(item.netReturnPercent);
  }
  const byRegime = (['LOW', 'MEDIUM', 'HIGH'] as const).map((regime) =>
    Object.freeze({
      regime,
      basis: 'OUTCOME_PATH_VOLATILITY' as const,
      availableAtDecisionTime: false as const,
      observations: regimeGroups[regime].length,
      meanNetReturnPercent: round(average(regimeGroups[regime])),
    }),
  );

  const costs = [
    0,
    policy.roundTripCostPercent / 2,
    policy.roundTripCostPercent,
    policy.roundTripCostPercent * 1.5,
    policy.roundTripCostPercent * 2,
  ];
  const uniqueCosts = [...new Set(costs.map((value) => round(value)))].sort(
    (left, right) => left - right,
  );
  const grossReturns = independentPrimaryJoined.map(
    (item) => item.outcome.directionAdjustedReturnPercent,
  );
  const feeSensitivity = uniqueCosts.map((roundTripCostPercent) => {
    const meanNetReturnPercent = round(
      average(grossReturns.map((value) => value - roundTripCostPercent)),
    );
    return Object.freeze({
      roundTripCostPercent,
      meanNetReturnPercent,
      positive: meanNetReturnPercent > 0,
    });
  });

  const malformedRecords = integrity.malformedRecords;
  const unmatchedObservations = integrity.unmatchedObservations;
  const independentAlerts = independentPrimaryJoined.length;
  const dependentPrimaryHorizonAlerts =
    primaryJoined.length - independentPrimaryJoined.length;
  const sampleRequirementMet = independentAlerts >= minimumSampleSize;
  const missingPrimaryHorizonOutcomes = Math.max(
    0,
    integrity.alerts.length - primaryJoined.length,
  );
  const reasons: string[] = [];
  if (!sampleRequirementMet) {
    reasons.push(
      `Requires at least ${minimumSampleSize} independent alerts; found ${independentAlerts}`,
    );
  }
  if (missingPrimaryHorizonOutcomes > 0) {
    reasons.push(
      `${missingPrimaryHorizonOutcomes} alert(s) are missing the ${policy.primaryHorizonMinutes}m primary outcome`,
    );
  }
  if (overallConfidenceInterval.lower <= 0) {
    reasons.push('The lower block-bootstrap confidence bound is not positive');
  }
  if (chronologicalSplit.validationCount === 0) {
    reasons.push('The purged chronological validation set is empty');
  } else if (chronologicalSplit.validationMeanNetReturnPercent <= 0) {
    reasons.push(
      'The purged chronological validation-set mean is not positive',
    );
  }
  if (chronologicalSplit.testCount === 0) {
    reasons.push('The purged chronological test set is empty');
  } else if (chronologicalSplit.testMeanNetReturnPercent <= 0) {
    reasons.push('The purged chronological test-set mean is not positive');
  }
  if (unmatchedObservations > 0) {
    reasons.push(
      `${unmatchedObservations} outcomes could not be matched to alerts`,
    );
  }
  if (malformedRecords > 0) {
    reasons.push(
      `${malformedRecords} malformed evidence records were detected`,
    );
  }

  return Object.freeze({
    generatedAt: input.generatedAt,
    evaluationId: input.evaluationId,
    matchedObservations: joined.length,
    primaryHorizonMinutes: policy.primaryHorizonMinutes,
    primaryHorizonObservations: primaryJoined.length,
    independentAlerts,
    dependentPrimaryHorizonAlerts,
    unmatchedObservations,
    malformedRecords,
    sampleRequirement: minimumSampleSize,
    sampleRequirementMet,
    overallConfidenceInterval,
    chronologicalSplit,
    byHorizon: Object.freeze(byHorizon),
    byRegime: Object.freeze(byRegime),
    pathExcursionObservations: pathJoined.length,
    feeSensitivity: Object.freeze(feeSensitivity),
    readyForQualification: reasons.length === 0,
    reasons: Object.freeze(reasons),
    liveOrderExecutionAllowed: false,
    orderExecutionAuthorized: false,
  });
};
