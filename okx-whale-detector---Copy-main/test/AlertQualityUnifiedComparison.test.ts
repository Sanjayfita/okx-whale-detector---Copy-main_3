import { describe, expect, it } from 'vitest';

import {
  compareAlertQualityUnifiedReports,
  generateAlertQualityUnifiedReport,
  type AlertQualityUnifiedReport,
} from '../src/evaluation';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const createReports = (): {
  baseline: AlertQualityUnifiedReport;
  candidate: AlertQualityUnifiedReport;
} => {
  const fixture = createTargetStopFixture();
  const input = {
    terminalReturnRecords: [fixture.terminalReturn],
    pathOutcomeRecords: [fixture.pathOutcome],
    targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
    groupingDimensions: ['HORIZON_MS', 'SOURCE'] as const,
  };
  const baseline = generateAlertQualityUnifiedReport({
    ...input,
    reportRunId: 'alert-quality-report:baseline',
    generatedAt: 1_700_000_000_000,
  });
  const candidate = JSON.parse(
    JSON.stringify(
      generateAlertQualityUnifiedReport({
        ...input,
        reportRunId: 'alert-quality-report:candidate',
        generatedAt: 1_700_000_100_000,
      }),
    ),
  ) as AlertQualityUnifiedReport;
  return { baseline, candidate };
};

describe('alert-quality unified comparison', () => {
  it('compares every matched group deterministically', () => {
    const { baseline, candidate } = createReports();
    const comparison = compareAlertQualityUnifiedReports(baseline, candidate);

    expect(comparison.baselineReportRunId).toBe('alert-quality-report:baseline');
    expect(comparison.candidateReportRunId).toBe('alert-quality-report:candidate');
    expect(comparison.matchedGroupCounts).toEqual({
      terminalReturn: baseline.terminalReturn.groups.length,
      pathOutcome: baseline.pathOutcome.groups.length,
      targetStop: baseline.targetStop.groups.length,
    });
    expect(comparison.addedGroupKeys).toEqual([]);
    expect(comparison.removedGroupKeys).toEqual([]);
    expect(comparison.metrics.length).toBeGreaterThan(0);
    expect(comparison.metrics.every((entry) => entry.change !== 'IMPROVED')).toBe(true);
    expect(comparison.metrics.every((entry) => entry.change !== 'DEGRADED')).toBe(true);
  });

  it('classifies higher and lower metrics using their declared direction', () => {
    const { baseline, candidate } = createReports();
    const terminal = candidate.terminalReturn.groups[0]!;
    const path = candidate.pathOutcome.groups[0]!;
    const target = candidate.targetStop.groups.find(
      (group) => group.statistics.stopFirstRateAmongResolved !== null,
    )!;

    terminal.coverage.eligibleRate = (terminal.coverage.eligibleRate ?? 0) + 0.1;
    path.metrics.executableOkx.adverseExcursionPercent.mean =
      (path.metrics.executableOkx.adverseExcursionPercent.mean ?? 1) - 0.1;
    target.statistics.stopFirstRateAmongResolved =
      target.statistics.stopFirstRateAmongResolved! + 0.1;

    const comparison = compareAlertQualityUnifiedReports(baseline, candidate);
    expect(
      comparison.metrics.find(
        (entry) =>
          entry.section === 'TERMINAL_RETURN' &&
          entry.groupKey === terminal.groupKey &&
          entry.metric === 'coverage.eligibleRate',
      )?.change,
    ).toBe('IMPROVED');
    expect(
      comparison.metrics.find(
        (entry) =>
          entry.section === 'PATH_OUTCOME' &&
          entry.groupKey === path.groupKey &&
          entry.metric === 'executableOkx.mae.mean',
      )?.change,
    ).toBe('IMPROVED');
    expect(
      comparison.metrics.find(
        (entry) =>
          entry.section === 'TARGET_STOP' &&
          entry.groupKey === target.groupKey &&
          entry.metric === 'stopFirstRateAmongResolved',
      )?.change,
    ).toBe('DEGRADED');
  });

  it('marks metrics unavailable when either observation is absent', () => {
    const { baseline, candidate } = createReports();
    candidate.terminalReturn.groups[0]!.returns.okxDirectionalReturnPercent.mean = null;

    const comparison = compareAlertQualityUnifiedReports(baseline, candidate);
    expect(comparison.unavailableMetricCount).toBeGreaterThan(0);
  });

  it('reports added and removed groups without inventing metric deltas', () => {
    const { baseline, candidate } = createReports();
    const removed = baseline.terminalReturn.groups[0]!;
    const added = {
      ...candidate.terminalReturn.groups[0]!,
      groupKey: 'candidate-only-group',
    };
    candidate.terminalReturn.groups = [
      ...candidate.terminalReturn.groups.slice(1),
      added,
    ];

    const comparison = compareAlertQualityUnifiedReports(baseline, candidate);
    expect(comparison.removedGroupKeys).toContain(`TERMINAL_RETURN:${removed.groupKey}`);
    expect(comparison.addedGroupKeys).toContain('TERMINAL_RETURN:candidate-only-group');
  });

  it('rejects incompatible policies and grouping dimensions', () => {
    const { baseline, candidate } = createReports();
    candidate.terminalReturn.policyFingerprints = ['different-policy'];
    expect(() => compareAlertQualityUnifiedReports(baseline, candidate)).toThrow(
      'terminal-return policy fingerprints are incompatible',
    );

    const second = createReports();
    second.candidate.groupingDimensions = ['SOURCE'];
    expect(() => compareAlertQualityUnifiedReports(second.baseline, second.candidate)).toThrow(
      'grouping dimensions are incompatible',
    );
  });

  it('rejects comparing the same report identity', () => {
    const { baseline } = createReports();
    expect(() => compareAlertQualityUnifiedReports(baseline, baseline)).toThrow(
      'Baseline and candidate reports must have different identities',
    );
  });
});
