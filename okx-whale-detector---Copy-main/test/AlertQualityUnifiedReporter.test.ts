import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  formatAlertQualityUnifiedReport,
  generateAlertQualityUnifiedReport,
  serializeAlertQualityUnifiedReport,
} from '../src/evaluation';
import { runAlertQualitySummaryCli } from '../src/tools/summarizeAlertQualityUnifiedReports';
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

const createReport = () => {
  const fixture = createTargetStopFixture();
  return generateAlertQualityUnifiedReport({
    terminalReturnRecords: [fixture.terminalReturn],
    pathOutcomeRecords: [fixture.pathOutcome],
    targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
    reportRunId: 'alert-quality-report:summary-test',
    generatedAt: 1_700_000_000_000,
  });
};

describe('human-readable unified alert-quality reporter', () => {
  it('prints coverage and metric denominators without recommendations', () => {
    const summary = formatAlertQualityUnifiedReport(createReport());

    expect(summary).toContain('ALERT QUALITY SUMMARY');
    expect(summary).toContain('TERMINAL RETURNS');
    expect(summary).toContain('PATH OUTCOMES');
    expect(summary).toContain('TARGET / STOP OUTCOMES');
    expect(summary).toMatch(/eligible=.*\(\d+\/\d+\)/);
    expect(summary).toMatch(/positive=.*\(\d+\/\d+\)/);
    expect(summary).toMatch(/target-first=.*\(\d+\/\d+\)/);
    expect(summary).toContain('Research output only. No trading recommendation is produced.');
    expect(summary.toLowerCase()).not.toContain('buy now');
    expect(summary.toLowerCase()).not.toContain('sell now');
  });

  it('formats identical reports byte-identically', () => {
    const report = createReport();
    expect(formatAlertQualityUnifiedReport(report)).toBe(
      formatAlertQualityUnifiedReport(report),
    );
  });

  it('prints explicit no-observation messages for an empty report', () => {
    const summary = formatAlertQualityUnifiedReport(
      generateAlertQualityUnifiedReport({
        terminalReturnRecords: [],
        pathOutcomeRecords: [],
        targetStopRecords: [],
        reportRunId: 'alert-quality-report:empty-summary',
        generatedAt: 0,
      }),
    );

    expect(summary).toContain('No terminal-return observations.');
    expect(summary).toContain('No path-outcome observations.');
    expect(summary).toContain('No target/stop observations.');
  });

  it('summarizes a persisted report through the CLI', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'alert-quality-summary-'));
    directories.push(directory);
    const file = path.join(directory, 'quality.jsonl');
    await writeFile(file, serializeAlertQualityUnifiedReport(createReport()), 'utf8');
    const logs: string[] = [];
    const errors: string[] = [];

    const code = await runAlertQualitySummaryCli(['--file', file], {
      log: (...values) => logs.push(values.join(' ')),
      error: (...values) => errors.push(values.join(' ')),
    });

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(logs.join('\n')).toContain('alert-quality-report:summary-test');
    expect(logs.join('\n')).toContain('OKX executable MFE');
  });

  it('rejects malformed persisted input instead of hiding read issues', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'alert-quality-summary-'));
    directories.push(directory);
    const file = path.join(directory, 'quality.jsonl');
    await writeFile(file, '{not-json}\n', 'utf8');
    const errors: string[] = [];

    const code = await runAlertQualitySummaryCli(['--file', file], {
      log: () => undefined,
      error: (...values) => errors.push(values.join(' ')),
    });

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('read issue');
  });
});
