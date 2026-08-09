import { describe, expect, it } from 'vitest';

import {
  buildAlertQualityUnifiedTrend,
  generateAlertQualityUnifiedReport,
  type AlertQualityUnifiedReport,
} from '../src/evaluation';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const createReports = (): AlertQualityUnifiedReport[] => {
  const fixture = createTargetStopFixture();
  const input = {
    terminalReturnRecords: [fixture.terminalReturn],
    pathOutcomeRecords: [fixture.pathOutcome],
    targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
    groupingDimensions: ['HORIZON_MS', 'SOURCE'] as const,
  };
  return [0, 1, 2].map((index) =>
    JSON.parse(
      JSON.stringify(
        generateAlertQualityUnifiedReport({
          ...input,
          reportRunId: `alert-quality-report:trend-${index}`,
          generatedAt: 1_700_000_000_000 + index * 1_000,
        }),
      ),
    ),
  ) as AlertQualityUnifiedReport[];
};

describe('alert-quality unified trend history', () => {
  it('orders reports and compares every adjacent pair', () => {
    const reports = createReports();
    const trend = buildAlertQualityUnifiedTrend([reports[2]!, reports[0]!, reports[1]!]);

    expect(trend.reports.map((report) => report.reportRunId)).toEqual([
      'alert-quality-report:trend-0',
      'alert-quality-report:trend-1',
      'alert-quality-report:trend-2',
    ]);
    expect(trend.transitions).toHaveLength(2);
    expect(trend.transitions[0]!.baselineReportRunId).toBe('alert-quality-report:trend-0');
    expect(trend.transitions[1]!.candidateReportRunId).toBe('alert-quality-report:trend-2');
  });

  it('aggregates improved and degraded changes across transitions', () => {
    const reports = createReports();
    const group = reports[1]!.terminalReturn.groups.find(
      (entry) => entry.coverage.eligibleRate !== null,
    )!;
    const thirdGroup = reports[2]!.terminalReturn.groups.find(
      (entry) => entry.groupKey === group.groupKey,
    )!;

    group.coverage.eligibleRate = group.coverage.eligibleRate! - 0.1;
    thirdGroup.coverage.eligibleRate = group.coverage.eligibleRate! + 0.2;

    const trend = buildAlertQualityUnifiedTrend(reports);
    const metric = trend.metrics.find(
      (entry) =>
        entry.groupKey === group.groupKey && entry.metric === 'coverage.eligibleRate',
    )!;

    expect(metric.degradedCount).toBe(1);
    expect(metric.improvedCount).toBe(1);
    expect(metric.observedTransitionCount).toBe(2);
    expect(metric.overallChange).toBe('IMPROVED');
    expect(trend.totalImprovedMetricCount).toBeGreaterThan(0);
    expect(trend.totalDegradedMetricCount).toBeGreaterThan(0);
  });

  it('keeps unavailable observations explicit', () => {
    const reports = createReports();
    reports[1]!.terminalReturn.groups[0]!.returns.okxDirectionalReturnPercent.mean = null;

    const trend = buildAlertQualityUnifiedTrend(reports);
    expect(trend.totalUnavailableMetricCount).toBeGreaterThan(0);
    expect(trend.metrics.some((metric) => metric.unavailableCount > 0)).toBe(true);
  });

  it('rejects histories with fewer than two reports', () => {
    const reports = createReports();
    expect(() => buildAlertQualityUnifiedTrend([reports[0]!])).toThrow(
      'requires at least two reports',
    );
  });

  it('rejects duplicate report identities', () => {
    const reports = createReports();
    expect(() => buildAlertQualityUnifiedTrend([reports[0]!, reports[0]!])).toThrow(
      'identities must be unique',
    );
  });

  it('propagates compatibility rejection from adjacent comparisons', () => {
    const reports = createReports();
    reports[2]!.terminalReturn.policyFingerprints = ['incompatible-policy'];

    expect(() => buildAlertQualityUnifiedTrend(reports)).toThrow(
      'terminal-return policy fingerprints are incompatible',
    );
  });
});
