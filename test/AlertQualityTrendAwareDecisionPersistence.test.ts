import { describe, expect, it } from 'vitest';

import {
  createPersistedAlertQualityTrendAwareDecision,
  readAlertQualityTrendAwareDecisionsFromText,
  serializeAlertQualityTrendAwareDecisions,
  validatePersistedAlertQualityTrendAwareDecision,
  type AlertQualityTrendAwareDecisionReport,
  type AlertQualityUnifiedTrend,
} from '../src/evaluation';

const decisionReport = (
  overrides: Partial<AlertQualityTrendAwareDecisionReport> = {},
): AlertQualityTrendAwareDecisionReport => ({
  decision: 'QUALIFIED',
  reasons: ['ALL_GROUPS_PASS', 'TREND_IMPROVING'],
  sourceReportRunId: 'alert-quality-report:persistence',
  sourceReportGeneratedAt: 1_700_000_000_000,
  thresholdCounts: { passed: 2, failed: 0, insufficientData: 0 },
  trendCounts: { improved: 3, degraded: 1, unchanged: 4, unavailable: 2 },
  comparisonCounts: null,
  ...overrides,
});

const trend = (): AlertQualityUnifiedTrend =>
  ({
    schemaVersion: 1,
    generatorVersion: 'alert-quality-unified-trend-generator-v1',
    groupingDimensions: ['HORIZON_MS'],
    reports: [
      {
        reportRunId: 'alert-quality-report:trend-0',
        generatedAt: 1_700_000_000_000,
        inputRecordCounts: { terminalReturn: 1, pathOutcome: 1, targetStop: 1 },
      },
      {
        reportRunId: 'alert-quality-report:trend-1',
        generatedAt: 1_700_000_000_001,
        inputRecordCounts: { terminalReturn: 1, pathOutcome: 1, targetStop: 1 },
      },
    ],
    transitions: [],
    metrics: [],
    totalImprovedMetricCount: 3,
    totalDegradedMetricCount: 1,
    totalUnchangedMetricCount: 4,
    totalUnavailableMetricCount: 2,
  }) as AlertQualityUnifiedTrend;

const persisted = (runId = 'decision-run:1', generatedAt = 1_700_000_000_010) =>
  createPersistedAlertQualityTrendAwareDecision({
    decisionReport: decisionReport(),
    trend: trend(),
    decisionRunId: runId,
    generatedAt,
  });

describe('trend-aware alert-quality decision persistence', () => {
  it('creates a versioned decision with source provenance', () => {
    const value = persisted();

    expect(value).toMatchObject({
      schemaVersion: 1,
      engineVersion: 'alert-quality-trend-aware-decision-v1',
      decisionRunId: 'decision-run:1',
      sourceReportRunId: 'alert-quality-report:persistence',
      sourceTrendFirstReportRunId: 'alert-quality-report:trend-0',
      sourceTrendLastReportRunId: 'alert-quality-report:trend-1',
      usedTrendComparison: false,
      decision: 'QUALIFIED',
    });
    expect(validatePersistedAlertQualityTrendAwareDecision(value)).toBe(true);
  });

  it('preserves comparison provenance and counts', () => {
    const value = createPersistedAlertQualityTrendAwareDecision({
      decisionReport: decisionReport({
        decision: 'QUALIFIED_BUT_DECELERATING',
        reasons: ['ALL_GROUPS_PASS', 'TREND_DECELERATING'],
        comparisonCounts: {
          accelerating: 0,
          decelerating: 2,
          steady: 3,
          reversing: 0,
          unavailable: 1,
        },
      }),
      trend: trend(),
      decisionRunId: 'decision-run:comparison',
      generatedAt: 1_700_000_000_011,
    });

    expect(value.usedTrendComparison).toBe(true);
    expect(value.comparisonCounts?.decelerating).toBe(2);
  });

  it('serializes deterministically and sorts by durable identity', () => {
    const later = persisted('decision-run:z', 20);
    const earlier = persisted('decision-run:a', 10);

    const first = serializeAlertQualityTrendAwareDecisions([later, earlier]);
    const second = serializeAlertQualityTrendAwareDecisions([earlier, later]);

    expect(first).toBe(second);
    expect(first.indexOf('decision-run:a')).toBeLessThan(first.indexOf('decision-run:z'));
  });

  it('detects exact duplicates and reports malformed or unsupported input', () => {
    const material = serializeAlertQualityTrendAwareDecisions([persisted()]).trim();
    const result = readAlertQualityTrendAwareDecisionsFromText(
      `${material}\n${material}\nnot-json\n{"schemaVersion":99}\n`,
    );

    expect(result.decisions).toHaveLength(1);
    expect(result.exactDuplicateCount).toBe(1);
    expect(result.issues.map((issue) => issue.reason)).toEqual([
      'MALFORMED_JSON',
      'UNSUPPORTED_SCHEMA_VERSION',
    ]);
  });

  it('rejects conflicting duplicate identities and inconsistent comparison state', () => {
    const original = persisted();
    const conflicting = { ...original, decision: 'WATCH' as const };

    expect(() =>
      serializeAlertQualityTrendAwareDecisions([original, conflicting]),
    ).toThrow('Conflicting duplicate trend-aware decision');
    expect(() =>
      validatePersistedAlertQualityTrendAwareDecision({
        ...original,
        usedTrendComparison: true,
        comparisonCounts: null,
      }),
    ).toThrow('comparisonCounts must be present');
  });
});
