import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildAlertQualityUnifiedTrend,
  generateAlertQualityUnifiedReport,
  writeAlertQualityUnifiedTrends,
  type AlertQualityUnifiedReport,
} from '../src/evaluation';
import { runAlertQualityTrendComparisonCli } from '../src/tools/compareAlertQualityUnifiedTrends';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const tempPath = async (name: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alert-quality-trend-comparison-cli-'));
  directories.push(directory);
  return path.join(directory, name);
};

const createReport = (index: number, eligibleRateOffset: number): AlertQualityUnifiedReport => {
  const fixture = createTargetStopFixture();
  const report = JSON.parse(
    JSON.stringify(
      generateAlertQualityUnifiedReport({
        terminalReturnRecords: [fixture.terminalReturn],
        pathOutcomeRecords: [fixture.pathOutcome],
        targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
        reportRunId: `alert-quality-report:trend-comparison-cli-${index}`,
        generatedAt: 1_700_000_000_000 + index,
        groupingDimensions: ['HORIZON_MS', 'SOURCE'],
      }),
    ),
  ) as AlertQualityUnifiedReport;
  const observed = report.terminalReturn.groups.find(
    (group) => group.coverage.eligibleRate !== null,
  )!;
  observed.coverage.eligibleRate = observed.coverage.eligibleRate! + eligibleRateOffset;
  return report;
};

const writeTrendPair = async (): Promise<{ baseline: string; candidate: string }> => {
  const baseline = await tempPath('baseline.jsonl');
  const candidate = path.join(path.dirname(baseline), 'candidate.jsonl');
  const baselineTrend = buildAlertQualityUnifiedTrend([
    createReport(0, 0),
    createReport(1, -0.01),
    createReport(2, -0.02),
  ]);
  const candidateTrend = buildAlertQualityUnifiedTrend([
    createReport(3, 0),
    createReport(4, -0.02),
    createReport(5, -0.05),
  ]);
  await writeAlertQualityUnifiedTrends(baseline, [baselineTrend]);
  await writeAlertQualityUnifiedTrends(candidate, [candidateTrend]);
  return { baseline, candidate };
};

describe('alert-quality trend comparison CLI', () => {
  it('prints trend-window summaries and momentum changes', async () => {
    const { baseline, candidate } = await writeTrendPair();
    const output: string[] = [];

    const code = await runAlertQualityTrendComparisonCli(
      ['--baseline', baseline, '--candidate', candidate],
      {
        log: (...values) => output.push(values.join(' ')),
        error: (...values) => output.push(values.join(' ')),
      },
    );

    expect(code).toBe(0);
    expect(output).toContain('ALERT QUALITY TREND-TO-TREND COMPARISON');
    expect(output).toContain('Baseline reports: 3');
    expect(output).toContain('Candidate reports: 3');
    expect(output.some((line) => line.startsWith('ACCELERATING |'))).toBe(true);
    expect(output.at(-1)).toContain('not a trading recommendation');
  });

  it('rejects malformed persisted input', async () => {
    const { candidate } = await writeTrendPair();
    const baseline = await tempPath('malformed.jsonl');
    await writeFile(baseline, 'not-json\n', 'utf8');
    const errors: string[] = [];

    const code = await runAlertQualityTrendComparisonCli(
      ['--baseline', baseline, '--candidate', candidate],
      { error: (...values) => errors.push(values.join(' ')) },
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('baseline trend file contains 1 read issue');
  });

  it('rejects the same input path for both windows', async () => {
    const { baseline } = await writeTrendPair();
    const errors: string[] = [];
    const code = await runAlertQualityTrendComparisonCli(
      ['--baseline', baseline, '--candidate', baseline],
      { error: (...values) => errors.push(values.join(' ')) },
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('paths must be distinct');
  });

  it('rejects invalid arguments', async () => {
    const errors: string[] = [];
    const code = await runAlertQualityTrendComparisonCli([], {
      error: (...values) => errors.push(values.join(' ')),
    });

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('--baseline is required');
  });
});
