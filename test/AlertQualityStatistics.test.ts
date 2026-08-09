import { describe, expect, it } from 'vitest';

import {
  createCoverageStatistics,
  createTargetStopStatistics,
  nullableRate,
  summarizeNumericValues,
  summarizeReturnValues,
} from '../src/evaluation';

describe('alert-quality nullable rates', () => {
  it('returns null for a zero denominator', () => {
    expect(nullableRate(0, 0)).toBeNull();
  });

  it('calculates a deterministic rate', () => {
    expect(nullableRate(2, 4)).toBe(0.5);
  });

  it('rejects impossible counts', () => {
    expect(() => nullableRate(2, 1)).toThrow(
      'numerator cannot exceed denominator',
    );
    expect(() => nullableRate(-1, 1)).toThrow(
      'numerator must be a non-negative integer',
    );
  });
});

describe('alert-quality numeric statistics', () => {
  it('returns nullable metrics for empty input', () => {
    expect(summarizeNumericValues([])).toEqual({
      observationCount: 0,
      sum: 0,
      mean: null,
      minimum: null,
      maximum: null,
    });
  });

  it('calculates count, sum, mean, minimum, and maximum', () => {
    expect(summarizeNumericValues([2, -1, 5])).toEqual({
      observationCount: 3,
      sum: 6,
      mean: 2,
      minimum: -1,
      maximum: 5,
    });
  });

  it('rejects non-finite values', () => {
    expect(() => summarizeNumericValues([1, Number.NaN])).toThrow(
      'values[1] must be finite',
    );
    expect(() => summarizeNumericValues([Number.POSITIVE_INFINITY])).toThrow(
      'values[0] must be finite',
    );
  });
});

describe('alert-quality return statistics', () => {
  it('keeps positive, negative, and zero observations separate', () => {
    expect(summarizeReturnValues([2, -1, 0, 3])).toEqual({
      observationCount: 4,
      sum: 4,
      mean: 1,
      minimum: -1,
      maximum: 3,
      positiveCount: 2,
      negativeCount: 1,
      zeroCount: 1,
      positiveRate: 0.5,
    });
  });

  it('does not report a zero positive rate for empty input', () => {
    expect(summarizeReturnValues([]).positiveRate).toBeNull();
  });
});

describe('alert-quality coverage statistics', () => {
  it('keeps missing and ambiguous cells visible', () => {
    expect(
      createCoverageStatistics({
        totalCellCount: 10,
        eligibleCellCount: 4,
        ineligibleCellCount: 2,
        ambiguousCellCount: 1,
        missingCellCount: 2,
        partialCellCount: 1,
        invalidCellCount: 0,
      }),
    ).toEqual({
      totalCellCount: 10,
      eligibleCellCount: 4,
      ineligibleCellCount: 2,
      ambiguousCellCount: 1,
      missingCellCount: 2,
      partialCellCount: 1,
      invalidCellCount: 0,
      eligibleRate: 0.4,
      ineligibleRate: 0.2,
      ambiguityRate: 0.1,
      missingRate: 0.2,
      partialRate: 0.1,
      invalidRate: 0,
    });
  });

  it('uses null rates when there are no cells', () => {
    expect(
      createCoverageStatistics({
        totalCellCount: 0,
        eligibleCellCount: 0,
        ineligibleCellCount: 0,
        ambiguousCellCount: 0,
        missingCellCount: 0,
        partialCellCount: 0,
        invalidCellCount: 0,
      }).eligibleRate,
    ).toBeNull();
  });
});

describe('alert-quality target/stop statistics', () => {
  it('uses only resolved outcomes for first-hit rates', () => {
    expect(
      createTargetStopStatistics({
        eligibleCount: 8,
        ineligibleCount: 2,
        ambiguousCount: 2,
        targetFirstCount: 3,
        stopFirstCount: 2,
        neitherCount: 1,
        tieCount: 0,
        candleAmbiguityCount: 2,
      }),
    ).toEqual({
      eligibleCount: 8,
      ineligibleCount: 2,
      ambiguousCount: 2,
      targetFirstCount: 3,
      stopFirstCount: 2,
      neitherCount: 1,
      tieCount: 0,
      candleAmbiguityCount: 2,
      resolvedCount: 6,
      targetFirstRateAmongResolved: 0.5,
      stopFirstRateAmongResolved: 2 / 6,
      neitherRateAmongResolved: 1 / 6,
      tieRateAmongResolved: 0,
      ambiguityRateAmongEligible: 0.25,
    });
  });

  it('does not treat ambiguous outcomes as losses', () => {
    const result = createTargetStopStatistics({
      eligibleCount: 2,
      ineligibleCount: 0,
      ambiguousCount: 2,
      targetFirstCount: 0,
      stopFirstCount: 0,
      neitherCount: 0,
      tieCount: 0,
      candleAmbiguityCount: 2,
    });

    expect(result.resolvedCount).toBe(0);
    expect(result.targetFirstRateAmongResolved).toBeNull();
    expect(result.stopFirstRateAmongResolved).toBeNull();
    expect(result.ambiguityRateAmongEligible).toBe(1);
  });

  it('rejects inconsistent target/stop counts', () => {
    expect(() =>
      createTargetStopStatistics({
        eligibleCount: 1,
        ineligibleCount: 0,
        ambiguousCount: 0,
        targetFirstCount: 1,
        stopFirstCount: 1,
        neitherCount: 0,
        tieCount: 0,
        candleAmbiguityCount: 0,
      }),
    ).toThrow('resolvedCount cannot exceed eligibleCount');
  });
});
