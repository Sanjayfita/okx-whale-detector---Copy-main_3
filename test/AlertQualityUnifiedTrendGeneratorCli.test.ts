import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  generateAlertQualityUnifiedReport,
  readAlertQualityUnifiedTrends,
  writeAlertQualityUnifiedReports,
  type AlertQualityUnifiedReport,
} from '../src/evaluation';
import { runAlertQualityTrendGeneratorCli } from '../src/tools/generateAlertQualityUnifiedTrend';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const tempDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alert-quality-trend-generator-'));
  directories.push(directory);
  return directory;
};

const createReports = (): AlertQualityUnifiedReport[] => {
  const fixture = createTargetStopFixture();
  const shared = {
    terminalReturnRecords: [fixture.terminalReturn],
    pathOutcomeRecords: [fixture.pathOutcome],
    targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
    groupingDimensions: ['HORIZON_MS', 'SOURCE'] as const,
  };
  return [0, 1, 2].map((index) =>
    generateAlertQualityUnifiedReport({
      ...shared,
      reportRunId: `alert-quality-report:trend-generator-${index}`,
      generatedAt: 1_700_000_000_000 + index,
    }),
  );
};

describe('alert-quality trend generator CLI', () => {
  it('builds and persists a trend from unified-report history', async () => {
    const directory = await tempDirectory();
    const reportsPath = path.join(directory, 'reports.jsonl');
    const outputPath = path.join(directory, 'trend.jsonl');
    await writeAlertQualityUnifiedReports(reportsPath, createReports().reverse());
    const output: string[] = [];

    const code = await runAlertQualityTrendGeneratorCli(
      ['--reports', reportsPath, '--output', outputPath],
      {
        log: (...values) => output.push(values.join(' ')),
        error: (...values) => output.push(values.join(' ')),
      },
    );

    expect(code).toBe(0);
    const read = await readAlertQualityUnifiedTrends(outputPath);
    expect(read.issues).toHaveLength(0);
    expect(read.trends).toHaveLength(1);
    expect(read.trends[0]!.reports.map((report) => report.reportRunId)).toEqual([
      'alert-quality-report:trend-generator-0',
      'alert-quality-report:trend-generator-1',
      'alert-quality-report:trend-generator-2',
    ]);
    expect(output).toContain('PERSISTED ALERT QUALITY TREND');
    expect(output).toContain('Source reports: 3');
    expect(output.at(-1)).toContain('not a trading recommendation');
  });

  it('produces byte-identical output for identical report history', async () => {
    const directory = await tempDirectory();
    const reportsPath = path.join(directory, 'reports.jsonl');
    const firstPath = path.join(directory, 'first.jsonl');
    const secondPath = path.join(directory, 'second.jsonl');
    await writeAlertQualityUnifiedReports(reportsPath, createReports());

    expect(
      await runAlertQualityTrendGeneratorCli([
        '--reports',
        reportsPath,
        '--output',
        firstPath,
      ]),
    ).toBe(0);
    expect(
      await runAlertQualityTrendGeneratorCli([
        '--reports',
        reportsPath,
        '--output',
        secondPath,
      ]),
    ).toBe(0);

    expect(await readFile(firstPath, 'utf8')).toBe(await readFile(secondPath, 'utf8'));
  });

  it('rejects malformed source history without creating output', async () => {
    const directory = await tempDirectory();
    const reportsPath = path.join(directory, 'malformed.jsonl');
    const outputPath = path.join(directory, 'trend.jsonl');
    await writeFile(reportsPath, 'not-json\n', 'utf8');
    const errors: string[] = [];

    const code = await runAlertQualityTrendGeneratorCli(
      ['--reports', reportsPath, '--output', outputPath],
      { error: (...values) => errors.push(values.join(' ')) },
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('1 read issue');
    await expect(access(outputPath)).rejects.toThrow();
  });

  it('rejects fewer than two reports without creating output', async () => {
    const directory = await tempDirectory();
    const reportsPath = path.join(directory, 'single.jsonl');
    const outputPath = path.join(directory, 'trend.jsonl');
    await writeAlertQualityUnifiedReports(reportsPath, [createReports()[0]!]);

    expect(
      await runAlertQualityTrendGeneratorCli([
        '--reports',
        reportsPath,
        '--output',
        outputPath,
      ]),
    ).toBe(1);
    await expect(access(outputPath)).rejects.toThrow();
  });

  it('rejects invalid arguments and path collisions', async () => {
    const directory = await tempDirectory();
    const reportsPath = path.join(directory, 'reports.jsonl');
    await writeAlertQualityUnifiedReports(reportsPath, createReports());
    const errors: string[] = [];

    expect(
      await runAlertQualityTrendGeneratorCli([], {
        error: (...values) => errors.push(values.join(' ')),
      }),
    ).toBe(1);
    expect(
      await runAlertQualityTrendGeneratorCli(
        ['--reports', reportsPath, '--output', reportsPath],
        { error: (...values) => errors.push(values.join(' ')) },
      ),
    ).toBe(1);
    expect(errors.join('\n')).toContain('--reports is required');
    expect(errors.join('\n')).toContain('paths must be distinct');
  });
});
