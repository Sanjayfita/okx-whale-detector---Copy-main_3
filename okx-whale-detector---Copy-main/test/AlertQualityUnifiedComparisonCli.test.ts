import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  generateAlertQualityUnifiedReport,
  writeAlertQualityUnifiedReports,
  type AlertQualityUnifiedReport,
} from '../src/evaluation';
import { runAlertQualityComparisonCli } from '../src/tools/compareAlertQualityUnifiedReports';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const directories: string[] = [];

afterEach(() => {
  directories.splice(0).forEach((directory) =>
    rmSync(directory, { recursive: true, force: true }),
  );
});

const createReport = (reportRunId: string, generatedAt: number): AlertQualityUnifiedReport => {
  const fixture = createTargetStopFixture();
  return generateAlertQualityUnifiedReport({
    terminalReturnRecords: [fixture.terminalReturn],
    pathOutcomeRecords: [fixture.pathOutcome],
    targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
    reportRunId,
    generatedAt,
    groupingDimensions: ['HORIZON_MS', 'SOURCE'],
  });
};

const createPaths = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'alert-quality-comparison-cli-'));
  directories.push(directory);
  return {
    baseline: path.join(directory, 'baseline.jsonl'),
    candidate: path.join(directory, 'candidate.jsonl'),
  };
};

describe('alert-quality comparison CLI', () => {
  it('compares two persisted reports and prints deterministic counts', async () => {
    const files = createPaths();
    await writeAlertQualityUnifiedReports(files.baseline, [
      createReport('alert-quality-report:baseline-cli', 1_700_000_000_000),
    ]);
    await writeAlertQualityUnifiedReports(files.candidate, [
      createReport('alert-quality-report:candidate-cli', 1_700_000_100_000),
    ]);
    const output: string[] = [];

    const code = await runAlertQualityComparisonCli(
      ['--baseline', files.baseline, '--candidate', files.candidate],
      { log: (...values) => output.push(values.join(' ')) },
    );

    expect(code).toBe(0);
    expect(output).toContain('ALERT QUALITY HISTORICAL COMPARISON');
    expect(output).toContain('Improved metrics: 0');
    expect(output).toContain('Degraded metrics: 0');
    expect(output).toContain('CHANGED METRICS');
    expect(output).toContain('none');
    expect(output.at(-1)).toContain('not a trading recommendation');
  });

  it('prints changed metric details', async () => {
    const files = createPaths();
    const baseline = createReport('alert-quality-report:baseline-change', 1_700_000_000_000);
    const candidate = JSON.parse(
      JSON.stringify(
        createReport('alert-quality-report:candidate-change', 1_700_000_100_000),
      ),
    ) as AlertQualityUnifiedReport;
    const group = candidate.terminalReturn.groups[0]!;
    group.coverage.eligibleRate = (group.coverage.eligibleRate ?? 0) + 0.1;
    await writeAlertQualityUnifiedReports(files.baseline, [baseline]);
    await writeAlertQualityUnifiedReports(files.candidate, [candidate]);
    const output: string[] = [];

    const code = await runAlertQualityComparisonCli(
      ['--baseline', files.baseline, '--candidate', files.candidate],
      { log: (...values) => output.push(values.join(' ')) },
    );

    expect(code).toBe(0);
    expect(output.some((line) => line.startsWith('IMPROVED | TERMINAL_RETURN'))).toBe(
      true,
    );
  });

  it('rejects malformed persisted input', async () => {
    const files = createPaths();
    writeFileSync(files.baseline, '{not-json}\n', 'utf8');
    await writeAlertQualityUnifiedReports(files.candidate, [
      createReport('alert-quality-report:candidate-malformed', 1_700_000_100_000),
    ]);
    const errors: string[] = [];

    const code = await runAlertQualityComparisonCli(
      ['--baseline', files.baseline, '--candidate', files.candidate],
      { error: (...values) => errors.push(values.join(' ')) },
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('contains 1 read issue');
  });

  it('requires exactly one report in each file', async () => {
    const files = createPaths();
    await writeAlertQualityUnifiedReports(files.baseline, []);
    await writeAlertQualityUnifiedReports(files.candidate, [
      createReport('alert-quality-report:candidate-count', 1_700_000_100_000),
    ]);
    const errors: string[] = [];

    const code = await runAlertQualityComparisonCli(
      ['--baseline', files.baseline, '--candidate', files.candidate],
      { error: (...values) => errors.push(values.join(' ')) },
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('exactly one unique report');
  });

  it('rejects invalid usage and path collisions', async () => {
    const files = createPaths();
    const errors: string[] = [];
    expect(await runAlertQualityComparisonCli([], { error: (...v) => errors.push(v.join(' ')) })).toBe(1);
    expect(
      await runAlertQualityComparisonCli(
        ['--baseline', files.baseline, '--candidate', files.baseline],
        { error: (...v) => errors.push(v.join(' ')) },
      ),
    ).toBe(1);
    expect(errors.join('\n')).toContain('Usage: alerts:compare:quality');
    expect(errors.join('\n')).toContain('paths must be distinct');
  });
});
