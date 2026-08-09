import type {
  CoverageStatistics,
  NumericStatistics,
  ReturnStatistics,
  TargetStopStatistics,
} from './alertQualityReport';

const assertNonNegativeInteger = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
};

const assertFiniteValues = (values: readonly number[]): void => {
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      throw new Error(`values[${index}] must be finite`);
    }
  });
};

export const nullableRate = (
  numerator: number,
  denominator: number,
): number | null => {
  assertNonNegativeInteger('numerator', numerator);
  assertNonNegativeInteger('denominator', denominator);
  if (numerator > denominator) {
    throw new Error('numerator cannot exceed denominator');
  }
  return denominator === 0 ? null : numerator / denominator;
};

export const summarizeNumericValues = (
  values: readonly number[],
): NumericStatistics => {
  assertFiniteValues(values);
  if (values.length === 0) {
    return {
      observationCount: 0,
      sum: 0,
      mean: null,
      minimum: null,
      maximum: null,
    };
  }

  let sum = 0;
  let minimum = values[0]!;
  let maximum = values[0]!;
  for (const value of values) {
    sum += value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  return {
    observationCount: values.length,
    sum,
    mean: sum / values.length,
    minimum,
    maximum,
  };
};

export const summarizeReturnValues = (
  values: readonly number[],
): ReturnStatistics => {
  const numeric = summarizeNumericValues(values);
  let positiveCount = 0;
  let negativeCount = 0;
  let zeroCount = 0;

  for (const value of values) {
    if (value > 0) {
      positiveCount += 1;
    } else if (value < 0) {
      negativeCount += 1;
    } else {
      zeroCount += 1;
    }
  }

  return {
    ...numeric,
    positiveCount,
    negativeCount,
    zeroCount,
    positiveRate: nullableRate(positiveCount, values.length),
  };
};

export interface CoverageCountInput {
  totalCellCount: number;
  eligibleCellCount: number;
  ineligibleCellCount: number;
  ambiguousCellCount: number;
  missingCellCount: number;
  partialCellCount: number;
  invalidCellCount: number;
}

export const createCoverageStatistics = (
  input: CoverageCountInput,
): CoverageStatistics => {
  for (const [name, value] of Object.entries(input)) {
    assertNonNegativeInteger(name, value);
    if (name !== 'totalCellCount' && value > input.totalCellCount) {
      throw new Error(`${name} cannot exceed totalCellCount`);
    }
  }

  return {
    ...input,
    eligibleRate: nullableRate(input.eligibleCellCount, input.totalCellCount),
    ineligibleRate: nullableRate(input.ineligibleCellCount, input.totalCellCount),
    ambiguityRate: nullableRate(input.ambiguousCellCount, input.totalCellCount),
    missingRate: nullableRate(input.missingCellCount, input.totalCellCount),
    partialRate: nullableRate(input.partialCellCount, input.totalCellCount),
    invalidRate: nullableRate(input.invalidCellCount, input.totalCellCount),
  };
};

export interface TargetStopCountInput {
  eligibleCount: number;
  ineligibleCount: number;
  ambiguousCount: number;
  targetFirstCount: number;
  stopFirstCount: number;
  neitherCount: number;
  tieCount: number;
  candleAmbiguityCount: number;
}

export const createTargetStopStatistics = (
  input: TargetStopCountInput,
): TargetStopStatistics => {
  for (const [name, value] of Object.entries(input)) {
    assertNonNegativeInteger(name, value);
  }

  const resolvedCount =
    input.targetFirstCount +
    input.stopFirstCount +
    input.neitherCount +
    input.tieCount;

  if (resolvedCount > input.eligibleCount) {
    throw new Error('resolvedCount cannot exceed eligibleCount');
  }
  if (input.ambiguousCount > input.eligibleCount) {
    throw new Error('ambiguousCount cannot exceed eligibleCount');
  }
  if (input.candleAmbiguityCount > input.ambiguousCount) {
    throw new Error('candleAmbiguityCount cannot exceed ambiguousCount');
  }

  return {
    ...input,
    resolvedCount,
    targetFirstRateAmongResolved: nullableRate(
      input.targetFirstCount,
      resolvedCount,
    ),
    stopFirstRateAmongResolved: nullableRate(input.stopFirstCount, resolvedCount),
    neitherRateAmongResolved: nullableRate(input.neitherCount, resolvedCount),
    tieRateAmongResolved: nullableRate(input.tieCount, resolvedCount),
    ambiguityRateAmongEligible: nullableRate(
      input.ambiguousCount,
      input.eligibleCount,
    ),
  };
};
