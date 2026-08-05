import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readPolicy, readTrends, compareTrends, evaluateDecision } = vi.hoisted(() => ({
  readPolicy: vi.fn(),
  readTrends: vi.fn(),
  compareTrends: vi.fn(),
  evaluateDecision: vi.fn(),
}));

vi.mock('../src/evaluation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/evaluation')>();
  return {
    ...actual,
    readAlertQualityThresholdEvaluations: readPolicy,
    readAlertQualityUnifiedTrends: readTrends,
    compareAlertQualityUnifiedTrends: compareTrends,
    evaluateAlertQualityTrendAwareDecision: evaluateDecision,
  };
});

import { runAlertQualityTrendAwareDecisionCli } from '../src/tools/evaluateAlertQualityTrendAwareDecision';

const persistedEvaluation = {
  sourceReportRunId: 'alert-quality-report:decision-cli',
  sourceReportGeneratedAt: 1_700_000_000_000,
  policy: {
    minimumSampleCount: 30,
    minimumEligibleRate: 0.8,
    minimumWinRate: 0.5,
    minimumExpectancyPercent: 0,
    maximumAmbiguityRate: 0.1,
  },
  evaluations: [],
  passedCount: 1,
  failedCount: 0,
  insufficientDataCount: 0,
};

const trend = { reports: [{ reportRunId: 'report', generatedAt: 1 }] };
const comparison = { reversingMetricCount: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  readPolicy.mockResolvedValue({ evaluations: [persistedEvaluation], issues: [] });
  readTrends.mockResolvedValue({ trends: [trend], issues: [] });
  compareTrends.mockReturnValue(comparison);
  evaluateDecision.mockReturnValue({
    decision: 'QUALIFIED',
    reasons: ['ALL_GROUPS_PASS', 'TREND_IMPROVING'],
    sourceReportRunId: persistedEvaluation.sourceReportRunId,
    sourceReportGeneratedAt: persistedEvaluation.sourceReportGeneratedAt,
    thresholdCounts: { passed: 1, failed: 0, insufficientData: 0 },
    trendCounts: { improved: 2, degraded: 0, unchanged: 3, unavailable: 1 },
    comparisonCounts: null,
  });
});

describe('trend-aware alert-quality decision CLI', () => {
  it('prints a decision from one threshold evaluation and one trend', async () => {
    const output: string[] = [];
    const code = await runAlertQualityTrendAwareDecisionCli(
      ['--policy', 'policy.jsonl', '--trend', 'trend.jsonl'],
      { log: (...values) => output.push(values.map(String).join(' ')) },
    );

    expect(code).toBe(0);
    expect(output).toContain('ALERT QUALITY TREND-AWARE DECISION');
    expect(output).toContain('Decision: QUALIFIED');
    expect(output).toContain('Momentum: not provided');
    expect(evaluateDecision).toHaveBeenCalledOnce();
  });

  it('compares a baseline trend when supplied', async () => {
    evaluateDecision.mockReturnValue({
      decision: 'QUALIFIED_BUT_DECELERATING',
      reasons: ['ALL_GROUPS_PASS', 'TREND_DECELERATING'],
      sourceReportRunId: persistedEvaluation.sourceReportRunId,
      sourceReportGeneratedAt: persistedEvaluation.sourceReportGeneratedAt,
      thresholdCounts: { passed: 1, failed: 0, insufficientData: 0 },
      trendCounts: { improved: 1, degraded: 0, unchanged: 0, unavailable: 0 },
      comparisonCounts: {
        accelerating: 0,
        decelerating: 1,
        steady: 0,
        reversing: 0,
        unavailable: 0,
      },
    });
    const output: string[] = [];
    const code = await runAlertQualityTrendAwareDecisionCli(
      [
        '--policy',
        'policy.jsonl',
        '--baseline-trend',
        'baseline.jsonl',
        '--trend',
        'candidate.jsonl',
      ],
      { log: (...values) => output.push(values.map(String).join(' ')) },
    );

    expect(code).toBe(0);
    expect(compareTrends).toHaveBeenCalledOnce();
    expect(output.some((line) => line.startsWith('Momentum: accelerating=0'))).toBe(true);
  });

  it('rejects missing required options', async () => {
    const errors: string[] = [];
    const code = await runAlertQualityTrendAwareDecisionCli([], {
      error: (...values) => errors.push(values.map(String).join(' ')),
    });

    expect(code).toBe(1);
    expect(errors[0]).toContain('--policy is required');
  });

  it('rejects files with read issues or multiple records', async () => {
    readPolicy.mockResolvedValueOnce({ evaluations: [], issues: [{ lineNumber: 1 }] });
    const errors: string[] = [];
    const issueCode = await runAlertQualityTrendAwareDecisionCli(
      ['--policy', 'bad.jsonl', '--trend', 'trend.jsonl'],
      { error: (...values) => errors.push(values.map(String).join(' ')) },
    );
    expect(issueCode).toBe(1);
    expect(errors[0]).toContain('read issue');

    readPolicy.mockResolvedValueOnce({ evaluations: [persistedEvaluation], issues: [] });
    readTrends.mockResolvedValueOnce({ trends: [trend, trend], issues: [] });
    const multipleCode = await runAlertQualityTrendAwareDecisionCli(
      ['--policy', 'policy.jsonl', '--trend', 'many.jsonl'],
      { error: (...values) => errors.push(values.map(String).join(' ')) },
    );
    expect(multipleCode).toBe(1);
    expect(errors[1]).toContain('exactly one trend');
  });
});
