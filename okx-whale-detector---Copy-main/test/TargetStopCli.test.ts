import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from '../src/evaluation';
import { AlertTargetStopOutcomeReader } from '../src/recording/AlertTargetStopOutcomeReader';
import { runTargetStopGeneratorCli } from '../src/tools/generateAlertTargetStopOutcomes';
import { runTargetStopInspectorCli } from '../src/tools/inspectAlertTargetStopOutcomes';
import {
  PATH_OUTCOME_NOW,
  createPathMarketLines,
} from './helpers/pathOutcomeFixtures';
import { createTargetStopFixture } from './helpers/targetStopFixtures';

const directories: string[] = [];
const createFiles = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'target-stop-cli-'));
  directories.push(directory);
  const fixture = createTargetStopFixture();
  const evaluations = path.join(directory, 'evaluations.jsonl');
  const returns = path.join(directory, 'returns.jsonl');
  const paths = path.join(directory, 'paths.jsonl');
  const market = path.join(directory, 'market.jsonl');
  const output = path.join(directory, 'targets.jsonl');
  writeFileSync(evaluations, `${canonicalJsonStringify(fixture.evaluation)}\n`);
  writeFileSync(returns, `${canonicalJsonStringify(fixture.terminalReturn)}\n`);
  writeFileSync(paths, `${canonicalJsonStringify(fixture.pathOutcome)}\n`);
  writeFileSync(market, `${createPathMarketLines().join('\n')}\n`);
  return { directory, evaluations, returns, paths, market, output };
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
  '--paths',
  files.paths,
  '--market-data',
  files.market,
  '--output',
  files.output,
  '--target-percent',
  '1',
  '--stop-percent',
  '1',
  '--target-stop-run-id',
  'target-stop-run:cli-test',
  '--now',
  String(PATH_OUTCOME_NOW),
];

describe('target/stop generator CLI', () => {
  it('generates a record with explicit policy and summary', async () => {
    const files = createFiles();
    const logs: string[] = [];
    expect(
      await runTargetStopGeneratorCli(argumentsFor(files), {
        log: (...values) => logs.push(values.join(' ')),
        error: (...values) => logs.push(values.join(' ')),
      }),
    ).toBe(0);
    const read = await new AlertTargetStopOutcomeReader().read(files.output);
    expect(read.records).toHaveLength(1);
    expect(read.records[0]).toMatchObject({
      targetStopRunId: 'target-stop-run:cli-test',
      policy: { targetPercent: 1, stopPercent: 1 },
    });
    expect(logs).toEqual(
      expect.arrayContaining([
        'Records: 1',
        'Eligible cells: 10',
        'Ambiguous cells: 5',
        'Gap-disqualified: 0',
      ]),
    );
  });

  it('reports malformed input while retaining valid records', async () => {
    const files = createFiles();
    writeFileSync(files.paths, 'malformed\n', { flag: 'a' });
    const warnings: string[] = [];
    expect(
      await runTargetStopGeneratorCli(argumentsFor(files), {
        log: () => undefined,
        warn: (...values) => warnings.push(values.join(' ')),
        error: () => undefined,
      }),
    ).toBe(0);
    expect(warnings).toEqual([
      expect.stringContaining('Malformed path-outcome line 2'),
    ]);
  });

  it('fails for missing files without creating output', async () => {
    const files = createFiles();
    const args = argumentsFor(files);
    args[1] = path.join(files.directory, 'missing.jsonl');
    expect(
      await runTargetStopGeneratorCli(args, {
        log: () => undefined,
        error: () => undefined,
      }),
    ).toBe(1);
    expect(existsSync(files.output)).toBe(false);
  });

  it.each([
    ['missing target', ['--target-percent', '1']],
    ['missing stop', ['--stop-percent', '1']],
    ['invalid target', ['--target-percent', '0']],
    ['invalid stop', ['--stop-percent', 'Infinity']],
  ])('rejects %s', async (_label, removal) => {
    const files = createFiles();
    const args = argumentsFor(files);
    const index = args.indexOf(removal[0]!);
    if (removal[1] === args[index + 1]) args.splice(index, 2);
    else args[index + 1] = removal[1]!;
    expect(
      await runTargetStopGeneratorCli(args, {
        log: () => undefined,
        error: () => undefined,
      }),
    ).toBe(1);
  });

  it('rejects input/output path collisions', async () => {
    const files = createFiles();
    const args = argumentsFor(files);
    args[9] = files.evaluations;
    expect(
      await runTargetStopGeneratorCli(args, {
        log: () => undefined,
        error: () => undefined,
      }),
    ).toBe(1);
  });
});

describe('target/stop inspector CLI', () => {
  it('prints schema, policy, result, and diagnostic summaries', async () => {
    const files = createFiles();
    await runTargetStopGeneratorCli(argumentsFor(files), {
      log: () => undefined,
      error: () => undefined,
    });
    const logs: string[] = [];
    expect(
      await runTargetStopInspectorCli(['--file', files.output], {
        log: (...values) => logs.push(values.join(' ')),
      }),
    ).toBe(0);
    expect(logs).toEqual(
      expect.arrayContaining([
        'Schema versions: 1',
        'Evaluator versions: target-stop-evaluator-v1',
        'Records: 1',
        'Target percentages: 1',
        'Stop percentages: 1',
        'Malformed lines: 0',
        'Duplicate outcome IDs: 0',
      ]),
    );
    expect(logs.at(-1)).toBe(
      'Win rate, expectancy, and quality aggregation: not present',
    );
  });

  it('returns nonzero for invalid arguments and missing files', async () => {
    expect(
      await runTargetStopInspectorCli([], { error: () => undefined }),
    ).toBe(1);
    expect(
      await runTargetStopInspectorCli(
        ['--file', path.join(tmpdir(), 'missing-target-stop.jsonl')],
        { error: () => undefined },
      ),
    ).toBe(1);
  });
});
