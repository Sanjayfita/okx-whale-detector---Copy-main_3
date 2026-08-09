import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runAlertQualityGeneratorCli } from '../src/tools/generateAlertQualityUnifiedReport';
import { runAlertQualityThresholdPolicyCli } from '../src/tools/evaluateAlertQualityThresholdPolicy';
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

const createQualityReport = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'alert-quality-policy-cli-'));
  temporaryDirectories.push(directory);
  const fixture = createTargetStopFixture();
  const target = generateTargetStopFixtureRecord(fixture);
  const returnsPath = path.join(directory, 'returns.jsonl');
  const pathsPath = path.join(directory, 'paths.jsonl');
  const targetsPath = path.join(directory, 'targets.jsonl');
  const reportPath = path.join(directory, 'quality.jsonl');
  await Promise.all([
    writeFile(returnsPath, `${JSON.stringify(fixture.terminalReturn)}\n`, 'utf8'),
    writeFile(pathsPath, `${JSON.stringify(fixture.pathOutcome)}\n`, 'utf8'),
    writeFile(targetsPath, `${JSON.stringify(target)}\n`, 'utf8'),
  ]);
  const code = await runAlertQualityGeneratorCli(
    [
      '--returns', returnsPath,
      '--paths', pathsPath,
      '--targets', targetsPath,
      '--output', reportPath,
      '--report-run-id', 'alert-quality-report:policy-cli-test',
      '--now', '1700000000000',
      '--group-by', 'SOURCE,HORIZON_MS',
    ],
    { log: () => undefined, error: () => undefined },
  );
  if (code !== 0) throw new Error('Unable to create threshold-policy CLI fixture');
  return reportPath;
};

describe('alert-quality threshold policy CLI', () => {
  it('evaluates one persisted report and prints deterministic summary counts', async () => {
    const reportPath = await createQualityReport();
    const logs: string[] = [];
    const code = await runAlertQualityThresholdPolicyCli(
      ['--file', reportPath],
      { log: (...values) => logs.push(values.join(' ')) },
    );

    expect(code).toBe(0);
    expect(logs).toContain('ALERT QUALITY THRESHOLD POLICY');
    expect(logs).toContain('Source report: alert-quality-report:policy-cli-test @ 1700000000000');
    expect(logs.some((line) => line.startsWith('Groups evaluated: '))).toBe(true);
    expect(logs.some((line) => line.startsWith('INSUFFICIENT_DATA: '))).toBe(true);
    expect(logs.at(-1)).toBe('Research analytics only. This output is not a trading recommendation.');
  });

  it('accepts explicit policy overrides', async () => {
    const reportPath = await createQualityReport();
    const logs: string[] = [];
    const code = await runAlertQualityThresholdPolicyCli(
      [
        '--file', reportPath,
        '--minimum-samples', '1',
        '--minimum-eligible-rate', '0',
        '--minimum-win-rate', '0',
        '--minimum-expectancy', '-100',
        '--maximum-ambiguity-rate', '1',
      ],
      { log: (...values) => logs.push(values.join(' ')) },
    );

    expect(code).toBe(0);
    expect(logs).toContain('Minimum samples: 1');
    expect(logs).toContain('Minimum expectancy percent: -100.000000');
    expect(logs).toContain('Maximum ambiguity rate: 1.000000');
  });

  it('rejects malformed report input', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'alert-quality-policy-cli-invalid-'));
    temporaryDirectories.push(directory);
    const reportPath = path.join(directory, 'invalid.jsonl');
    await writeFile(reportPath, '{not-json}\n', 'utf8');
    const errors: string[] = [];

    const code = await runAlertQualityThresholdPolicyCli(
      ['--file', reportPath],
      { error: (...values) => errors.push(values.join(' ')) },
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('read issue');
  });

  it('rejects missing, unknown, and invalid policy options', async () => {
    const errors: string[] = [];
    expect(
      await runAlertQualityThresholdPolicyCli([], {
        error: (...values) => errors.push(values.join(' ')),
      }),
    ).toBe(1);
    expect(errors.join('\n')).toContain('--file is required');

    const reportPath = await createQualityReport();
    errors.length = 0;
    expect(
      await runAlertQualityThresholdPolicyCli(
        ['--file', reportPath, '--unknown', '1'],
        { error: (...values) => errors.push(values.join(' ')) },
      ),
    ).toBe(1);
    expect(errors.join('\n')).toContain('Unknown quality-policy option');

    errors.length = 0;
    expect(
      await runAlertQualityThresholdPolicyCli(
        ['--file', reportPath, '--minimum-win-rate', '1.5'],
        { error: (...values) => errors.push(values.join(' ')) },
      ),
    ).toBe(1);
    expect(errors.join('\n')).toContain('minimumWinRate');
  });
});
