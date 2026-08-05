import { describe, expect, it } from 'vitest';

import {
  createAlertQualityThresholdPolicy,
  evaluateAlertQualityThresholds,
  type AlertQualityTerminalReturnGroup,
  type AlertQualityUnifiedReport,
} from '../src/evaluation';

const supplied = <T>(object: object, key: PropertyKey, fallback: T, value: T | undefined): T =>
  Object.prototype.hasOwnProperty.call(object, key) ? (value as T) : fallback;

const group = (overrides: {
  groupKey?: string;
  sampleCount?: number;
  eligibleRate?: number | null;
  winRate?: number | null;
  expectancy?: number | null;
  ambiguityRate?: number | null;
} = {}): AlertQualityTerminalReturnGroup =>
  ({
    groupKey: overrides.groupKey ?? 'overall',
    dimension: 'OVERALL',
    value: null,
    evaluatorVersion: 'terminal-return-evaluator-v1',
    policyFingerprint: 'policy',
    coverage: {
      totalCellCount: 100,
      eligibleCellCount: 90,
      ineligibleCellCount: 5,
      ambiguousCellCount: 5,
      missingCellCount: 0,
      partialCellCount: 0,
      invalidCellCount: 0,
      eligibleRate: supplied(overrides, 'eligibleRate', 0.9, overrides.eligibleRate),
      ineligibleRate: 0.05,
      ambiguityRate: supplied(overrides, 'ambiguityRate', 0.05, overrides.ambiguityRate),
      missingRate: 0,
      partialRate: 0,
      invalidRate: 0,
    },
    returns: {
      rawReturnPercent: statistics(),
      okxDirectionalReturnPercent: statistics(),
      externalDirectionalReturnPercent: statistics(),
      okxExecutableDirectionalReturnPercent: statistics({
        observationCount: overrides.sampleCount ?? 50,
        positiveRate: supplied(overrides, 'winRate', 0.6, overrides.winRate),
        mean: supplied(overrides, 'expectancy', 0.2, overrides.expectancy),
      }),
      externalExecutableDirectionalReturnPercent: statistics(),
    },
  }) as AlertQualityTerminalReturnGroup;

const statistics = (
  overrides: { observationCount?: number; positiveRate?: number | null; mean?: number | null } = {},
) => ({
  observationCount: overrides.observationCount ?? 50,
  sum: 10,
  mean: supplied(overrides, 'mean', 0.2, overrides.mean),
  minimum: -1,
  maximum: 1,
  positiveCount: 30,
  negativeCount: 20,
  zeroCount: 0,
  positiveRate: supplied(overrides, 'positiveRate', 0.6, overrides.positiveRate),
});

const report = (groups: AlertQualityTerminalReturnGroup[]): AlertQualityUnifiedReport =>
  ({
    reportRunId: 'alert-quality-report:threshold-test',
    generatedAt: 1_700_000_000_000,
    terminalReturn: { groups },
  }) as AlertQualityUnifiedReport;

describe('alert quality threshold policy', () => {
  it('passes groups that satisfy every configured threshold', () => {
    const result = evaluateAlertQualityThresholds({ report: report([group()]) });

    expect(result.passedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.insufficientDataCount).toBe(0);
    expect(result.evaluations[0]).toMatchObject({ status: 'PASS', reasons: [] });
  });

  it('fails sufficiently sampled groups that violate quality thresholds', () => {
    const result = evaluateAlertQualityThresholds({
      report: report([
        group({ eligibleRate: 0.7, winRate: 0.4, expectancy: -0.1, ambiguityRate: 0.2 }),
      ]),
    });

    expect(result.failedCount).toBe(1);
    expect(result.evaluations[0]!.reasons).toEqual([
      'MINIMUM_ELIGIBLE_RATE',
      'MINIMUM_WIN_RATE',
      'MINIMUM_EXPECTANCY',
      'MAXIMUM_AMBIGUITY_RATE',
    ]);
  });

  it('classifies low samples or unavailable required metrics as insufficient data', () => {
    const result = evaluateAlertQualityThresholds({
      report: report([group({ sampleCount: 5, winRate: null })]),
    });

    expect(result.insufficientDataCount).toBe(1);
    expect(result.evaluations[0]).toMatchObject({ status: 'INSUFFICIENT_DATA' });
    expect(result.evaluations[0]!.reasons).toContain('MINIMUM_SAMPLE_COUNT');
    expect(result.evaluations[0]!.reasons).toContain('UNAVAILABLE_REQUIRED_METRIC');
  });

  it('supports explicit policies and deterministic group ordering', () => {
    const policy = createAlertQualityThresholdPolicy({
      minimumSampleCount: 10,
      minimumEligibleRate: 0.5,
      minimumWinRate: 0.4,
      minimumExpectancyPercent: -0.2,
      maximumAmbiguityRate: 0.3,
    });
    const result = evaluateAlertQualityThresholds({
      report: report([group({ groupKey: 'z' }), group({ groupKey: 'a' })]),
      policy,
    });

    expect(result.evaluations.map((evaluation) => evaluation.groupKey)).toEqual(['a', 'z']);
    expect(result.passedCount).toBe(2);
  });

  it('rejects invalid policy values', () => {
    expect(() => createAlertQualityThresholdPolicy({ minimumSampleCount: 0 })).toThrow(
      'minimumSampleCount',
    );
    expect(() => createAlertQualityThresholdPolicy({ minimumEligibleRate: 1.1 })).toThrow(
      'minimumEligibleRate',
    );
    expect(() => createAlertQualityThresholdPolicy({ maximumAmbiguityRate: -0.1 })).toThrow(
      'maximumAmbiguityRate',
    );
    expect(() =>
      createAlertQualityThresholdPolicy({ minimumExpectancyPercent: Number.NaN }),
    ).toThrow('minimumExpectancyPercent');
  });
});
