import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  generateAlertQualityUnifiedReport,
  writeAlertQualityUnifiedReports,
  type AlertQualityUnifiedReport,
} from '../src/evaluation';
import { runAlertQualityTrendCli } from '../src/tools/summarizeAlertQualityUnifiedTrend';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const createReports = (): AlertQualityUnifiedReport[] => {
  const fixture = createTargetStopFixture();
  const input = {
    terminalReturnRecords: [fixture.terminalReturn],
    pathOutcomeRecords: [fixture.pathOutcome],
    targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
    groupingDimensions: ['HORIZON_MS', 'SOURCE'] as const,
  };
  const reports = [0, 1, 2].map((index) =>
    JSON.parse(
      JSON.stringify(
        generateAlertQualityUnifiedReport({
          ...input,
          reportRunId: `alert-quality-report:trend-cli-${index}`,
          generatedAt: 1_700_000_000_000 + index * 1_000,
        }),
      ),
    ),
  ) as AlertQualityUnifiedReport[];
  const secondGroup = reports[1]!.terminalReturn.groups.find(
    (group) => group.coverage.eligibleRate !== null,
  )!;
  const thirdGroup = reports[2]!.terminalReturn.groups.find(
    (group) => group.groupKey === secondGroup.groupKey,
  )!;
  secondGroup.coverage.eligibleRate = secondGroup.coverage.eligibleRate! - 0.1;
  thirdGroup.coverage.eligibleRate = secondGroup.coverage.eligibleRate! + 0.2;
  return reports;
};

const tempFile = async (name: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alert-quality-trend-cli-'));
  directories.push(directory);
  return path.join(directory, name);
};

describe('alert-quality trend CLI', () => {
  it('prints ordered report points, transitions, and long-term changes', async () => {
    const filePath = await tempFile('history.jsonl');
    await writeAlertQualityUnifiedReports(filePath, createReports().reverse());
    const output: string[] = [];

    const code = await runAlertQualityTrendCli(['--file', filePath], {
      log: (...values) => output.push(values.join(' ')),
      error: (...values) => output.push(values.join(' ')),
    });

    expect(code).toBe(0);
    expect(output).toContain('ALERT QUALITY TREND HISTORY');
    expect(output).toContain('Reports: 3');
    expect(output).toContain('Transitions: 2');
    expect(output.some((line) => line.includes('alert-quality-report:trend-cli-0'))).toBe(true);
    expect(output.some((line) => line.includes('LONG-TERM CHANGED METRICS'))).toBe(true);
    expect(output.some((line) => line.startsWith('IMPROVED |'))).toBe(true);
    expect(output.at(-1)).toContain('not a trading recommendation');
  });

  it('rejects a history containing fewer than two reports', async () => {
    const filePath = await tempFile('single.jsonl');
    await writeAlertQualityUnifiedReports(filePath, [createReports()[0]!]);
    const errors: string[] = [];

    const code = await runAlertQualityTrendCli(['--file', filePath], {
      error: (...values) => errors.push(values.join(' ')),
    });

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('requires at least two reports');
  });

  it('rejects malformed persisted input', async () => {
    const filePath = await tempFile('malformed.jsonl');
    await writeFile(filePath, 'not-json\n', 'utf8');
    const errors: string[] = [];

    const code = await runAlertQualityTrendCli(['--file', filePath], {
      error: (...values) => errors.push(values.join(' ')),
    });

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('1 read issue');
  });

  it('rejects invalid arguments', async () => {
    const errors: string[] = [];
    const code = await runAlertQualityTrendCli([], {
      error: (...values) => errors.push(values.join(' ')),
    });

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('Usage: alerts:trend:quality');
  });
});
