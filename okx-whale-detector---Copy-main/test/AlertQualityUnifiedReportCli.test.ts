import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readAlertQualityUnifiedReports } from '../src/evaluation';
import { runAlertQualityGeneratorCli } from '../src/tools/generateAlertQualityUnifiedReport';
import { runAlertQualityInspectorCli } from '../src/tools/inspectAlertQualityUnifiedReports';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const createFiles = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alert-quality-cli-'));
  temporaryDirectories.push(directory);
  const fixture = createTargetStopFixture();
  const target = generateTargetStopFixtureRecord(fixture);
  const returnsPath = path.join(directory, 'returns.jsonl');
  const pathsPath = path.join(directory, 'paths.jsonl');
  const targetsPath = path.join(directory, 'targets.jsonl');
  const outputPath = path.join(directory, 'quality.jsonl');
  await Promise.all([
    writeFile(returnsPath, `${JSON.stringify(fixture.terminalReturn)}\n`, 'utf8'),
    writeFile(pathsPath, `${JSON.stringify(fixture.pathOutcome)}\n`, 'utf8'),
    writeFile(targetsPath, `${JSON.stringify(target)}\n`, 'utf8'),
  ]);
  return { returnsPath, pathsPath, targetsPath, outputPath };
};

describe('unified alert-quality CLIs', () => {
  it('generates and persists one deterministic report', async () => {
    const files = await createFiles();
    const logs: string[] = [];
    const code = await runAlertQualityGeneratorCli(
      [
        '--returns',
        files.returnsPath,
        '--paths',
        files.pathsPath,
        '--targets',
        files.targetsPath,
        '--output',
        files.outputPath,
        '--report-run-id',
        'alert-quality-report:cli-test',
        '--now',
        '1700000000000',
        '--group-by',
        'SOURCE,HORIZON_MS',
      ],
      { log: (...values) => logs.push(values.join(' ')) },
    );

    expect(code).toBe(0);
    const read = await readAlertQualityUnifiedReports(files.outputPath);
    expect(read.reports).toHaveLength(1);
    expect(read.reports[0]?.reportRunId).toBe('alert-quality-report:cli-test');
    expect(read.reports[0]?.generatedAt).toBe(1_700_000_000_000);
    expect(read.reports[0]?.inputRecordCounts).toEqual({
      terminalReturn: 1,
      pathOutcome: 1,
      targetStop: 1,
    });
    expect(logs).toContain('Terminal-return records: 1');
  });

  it('produces byte-identical output for identical injected inputs', async () => {
    const files = await createFiles();
    const secondOutput = path.join(path.dirname(files.outputPath), 'quality-2.jsonl');
    const args = [
      '--returns', files.returnsPath,
      '--paths', files.pathsPath,
      '--targets', files.targetsPath,
      '--report-run-id', 'alert-quality-report:stable',
      '--now', '1700000000000',
    ];
    expect(
      await runAlertQualityGeneratorCli([...args, '--output', files.outputPath]),
    ).toBe(0);
    expect(
      await runAlertQualityGeneratorCli([...args, '--output', secondOutput]),
    ).toBe(0);
    expect(await readFile(files.outputPath, 'utf8')).toBe(
      await readFile(secondOutput, 'utf8'),
    );
  });

  it('inspects persisted reports and prints summary counts', async () => {
    const files = await createFiles();
    await runAlertQualityGeneratorCli(
      [
        '--returns', files.returnsPath,
        '--paths', files.pathsPath,
        '--targets', files.targetsPath,
        '--output', files.outputPath,
        '--report-run-id', 'alert-quality-report:inspect',
        '--now', '1700000000000',
      ],
    );
    const logs: string[] = [];
    const code = await runAlertQualityInspectorCli(
      ['--file', files.outputPath],
      { log: (...values) => logs.push(values.join(' ')) },
    );
    expect(code).toBe(0);
    expect(logs).toContain('Reports: 1');
    expect(logs).toContain('Terminal-return input records: 1');
    expect(logs).toContain('Exact duplicate reports: 0');
  });

  it('rejects missing required options', async () => {
    const errors: string[] = [];
    const code = await runAlertQualityGeneratorCli([], {
      error: (...values) => errors.push(values.join(' ')),
    });
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('--returns is required');
  });

  it('rejects unsupported grouping dimensions', async () => {
    const files = await createFiles();
    const errors: string[] = [];
    const code = await runAlertQualityGeneratorCli(
      [
        '--returns', files.returnsPath,
        '--paths', files.pathsPath,
        '--targets', files.targetsPath,
        '--output', files.outputPath,
        '--group-by', 'UNKNOWN',
      ],
      { error: (...values) => errors.push(values.join(' ')) },
    );
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('Unsupported alert-quality grouping dimension');
  });

  it('rejects invalid inspector usage', async () => {
    const errors: string[] = [];
    const code = await runAlertQualityInspectorCli([], {
      error: (...values) => errors.push(values.join(' ')),
    });
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('Usage: alerts:inspect:quality');
  });
});
