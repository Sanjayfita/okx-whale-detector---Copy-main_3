import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from '../src/evaluation';
import { AlertPathOutcomeReader } from '../src/recording/AlertPathOutcomeReader';
import { runPathOutcomeGeneratorCli } from '../src/tools/generateAlertPathOutcomes';
import { runPathOutcomeInspectorCli } from '../src/tools/inspectAlertPathOutcomes';
import {
  PATH_OUTCOME_NOW,
  createPathFixture,
  createPathMarketLines,
} from './helpers/pathOutcomeFixtures';

const directories: string[] = [];
const createFiles = (): {
  directory: string;
  evaluations: string;
  returns: string;
  market: string;
  output: string;
} => {
  const directory = mkdtempSync(path.join(tmpdir(), 'path-outcome-cli-'));
  directories.push(directory);
  const fixture = createPathFixture();
  const evaluations = path.join(directory, 'evaluations.jsonl');
  const returns = path.join(directory, 'returns.jsonl');
  const market = path.join(directory, 'market.jsonl');
  const output = path.join(directory, 'paths.jsonl');
  writeFileSync(evaluations, `${canonicalJsonStringify(fixture.evaluation)}\n`);
  writeFileSync(returns, `${canonicalJsonStringify(fixture.terminalReturn)}\n`);
  writeFileSync(market, `${createPathMarketLines().join('\n')}\n`);
  return { directory, evaluations, returns, market, output };
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const argumentsFor = (files: ReturnType<typeof createFiles>): string[] => [
  '--evaluations',
  files.evaluations,
  '--returns',
  files.returns,
  '--market-data',
  files.market,
  '--output',
  files.output,
  '--path-run-id',
  'path-outcome-run:cli-test',
  '--now',
  String(PATH_OUTCOME_NOW),
];

describe('path-outcome generator CLI', () => {
  it('generates records and prints deterministic summary counts', async () => {
    const files = createFiles();
    const logs: string[] = [];
    const exitCode = await runPathOutcomeGeneratorCli(argumentsFor(files), {
      log: (...values) => logs.push(values.join(' ')),
      error: (...values) => logs.push(values.join(' ')),
    });
    expect(exitCode).toBe(0);
    const result = await new AlertPathOutcomeReader().read(files.output);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.pathOutcomeRunId).toBe(
      'path-outcome-run:cli-test',
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        'Records: 1',
        'Eligible cells: 15',
        'Ineligible cells: 0',
        'Ambiguous cells: 0',
        'Midpoint paths: 10',
        'Executable paths: 5',
        'Candle-bound paths: 5',
        'Gap-disqualified cells: 0',
      ]),
    );
  });

  it('reports malformed input while processing valid records', async () => {
    const files = createFiles();
    writeFileSync(files.evaluations, 'malformed\n', { flag: 'a' });
    const warnings: string[] = [];
    const exitCode = await runPathOutcomeGeneratorCli(argumentsFor(files), {
      log: () => undefined,
      warn: (...values) => warnings.push(values.join(' ')),
      error: () => undefined,
    });
    expect(exitCode).toBe(0);
    expect(warnings).toEqual([
      expect.stringContaining('Malformed evaluation line 2'),
    ]);
  });

  it('fails cleanly for a missing input file without creating output', async () => {
    const files = createFiles();
    const errors: string[] = [];
    const args = argumentsFor(files);
    args[1] = path.join(files.directory, 'missing.jsonl');
    const exitCode = await runPathOutcomeGeneratorCli(args, {
      log: () => undefined,
      error: (...values) => errors.push(values.join(' ')),
    });
    expect(exitCode).toBe(1);
    expect(errors[0]).toContain('Path-outcome evaluation failed:');
    expect(existsSync(files.output)).toBe(false);
  });

  it('rejects every input/output path collision', async () => {
    const files = createFiles();
    const args = argumentsFor(files);
    args[7] = files.evaluations;
    const errors: string[] = [];
    expect(
      await runPathOutcomeGeneratorCli(args, {
        error: (...values) => errors.push(values.join(' ')),
      }),
    ).toBe(1);
    expect(errors[0]).toContain('must be distinct');
  });
});

describe('path-outcome inspector CLI', () => {
  it('prints schema, metric, reason, and duplicate summaries', async () => {
    const files = createFiles();
    await runPathOutcomeGeneratorCli(argumentsFor(files), {
      log: () => undefined,
      error: () => undefined,
    });
    const logs: string[] = [];
    expect(
      await runPathOutcomeInspectorCli(['--file', files.output], {
        log: (...values) => logs.push(values.join(' ')),
      }),
    ).toBe(0);
    expect(logs).toEqual(
      expect.arrayContaining([
        'Schema versions: 1',
        'Evaluator versions: path-outcome-evaluator-v1',
        'Records: 1',
        'MFE/MAE metrics: 10',
        'Executable metrics: 10',
        'Candle-bound paths: 5',
        'Malformed lines: 0',
        'Duplicate path outcome IDs: 0',
      ]),
    );
    expect(logs.at(-1)).toBe(
      'Win rate, expectancy, target/stop ordering: not present',
    );
  });

  it('returns nonzero for invalid arguments and missing files', async () => {
    const errors: string[] = [];
    expect(
      await runPathOutcomeInspectorCli([], {
        error: (...values) => errors.push(values.join(' ')),
      }),
    ).toBe(1);
    expect(
      await runPathOutcomeInspectorCli(
        ['--file', path.join(tmpdir(), 'definitely-missing-paths.jsonl')],
        {
          error: (...values) => errors.push(values.join(' ')),
        },
      ),
    ).toBe(1);
    expect(errors).toHaveLength(2);
  });
});
