import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from '../src/evaluation';
import { AlertTerminalReturnReader } from '../src/recording/AlertTerminalReturnReader';
import { runTerminalReturnGeneratorCli } from '../src/tools/generateAlertTerminalReturns';
import { runTerminalReturnInspectorCli } from '../src/tools/inspectAlertTerminalReturns';
import {
  TERMINAL_RETURN_NOW,
  createReturnEvaluation,
} from './helpers/terminalReturnFixtures';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const workspace = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'terminal-return-cli-'));
  directories.push(directory);
  const evaluationsPath = path.join(directory, 'evaluations.jsonl');
  const outputPath = path.join(directory, 'returns.jsonl');
  writeFileSync(
    evaluationsPath,
    `${canonicalJsonStringify(createReturnEvaluation())}\n`,
    'utf8',
  );
  return { directory, evaluationsPath, outputPath };
};

describe('terminal-return generator CLI', () => {
  it('generates returns with injected identity and summary counts', async () => {
    const files = workspace();
    const output: string[] = [];
    const errors: string[] = [];
    const exitCode = await runTerminalReturnGeneratorCli(
      [
        '--evaluations',
        files.evaluationsPath,
        '--output',
        files.outputPath,
        '--outcome-run-id',
        'terminal-return-run:cli',
        '--now',
        String(TERMINAL_RETURN_NOW),
      ],
      {
        log: (...values) => output.push(values.join(' ')),
        error: (...values) => errors.push(values.join(' ')),
      },
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(output).toContain('Records: 1');
    expect(output).toContain('Eligible cells: 15');
    expect(output).toContain('Ineligible cells: 0');
    expect(output).toContain('Ambiguous cells: 0');
    expect(output).toContain('Raw-return metrics: 15');
    const read = await new AlertTerminalReturnReader().read(files.outputPath);
    expect(read.records[0]?.outcomeRunId).toBe('terminal-return-run:cli');
  });

  it('reports malformed input while retaining valid evaluations', async () => {
    const files = workspace();
    writeFileSync(
      files.evaluationsPath,
      `${readFileSync(files.evaluationsPath, 'utf8')}{bad json\n`,
      'utf8',
    );
    const warnings: string[] = [];
    const exitCode = await runTerminalReturnGeneratorCli(
      ['--evaluations', files.evaluationsPath, '--output', files.outputPath],
      {
        warn: (...values) => warnings.push(values.join(' ')),
        log: () => undefined,
      },
    );
    expect(exitCode).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Malformed evaluation line 2/);
  });

  it('fails for missing input and path collision', async () => {
    const files = workspace();
    expect(
      await runTerminalReturnGeneratorCli([], {
        error: () => undefined,
      }),
    ).toBe(1);
    expect(
      await runTerminalReturnGeneratorCli(
        [
          '--evaluations',
          files.evaluationsPath,
          '--output',
          files.evaluationsPath,
        ],
        { error: () => undefined },
      ),
    ).toBe(1);
  });

  it('produces deterministic bytes with injected run ID and time', async () => {
    const files = workspace();
    const secondPath = path.join(files.directory, 'returns-2.jsonl');
    for (const outputPath of [files.outputPath, secondPath]) {
      expect(
        await runTerminalReturnGeneratorCli(
          [
            '--evaluations',
            files.evaluationsPath,
            '--output',
            outputPath,
            '--outcome-run-id',
            'terminal-return-run:deterministic',
            '--now',
            String(TERMINAL_RETURN_NOW),
          ],
          { log: () => undefined },
        ),
      ).toBe(0);
    }
    expect(readFileSync(files.outputPath)).toEqual(readFileSync(secondPath));
  });
});

describe('terminal-return inspector CLI', () => {
  it('reports return metrics without quality aggregation', async () => {
    const files = workspace();
    expect(
      await runTerminalReturnGeneratorCli(
        ['--evaluations', files.evaluationsPath, '--output', files.outputPath],
        { log: () => undefined },
      ),
    ).toBe(0);
    const output: string[] = [];
    const exitCode = await runTerminalReturnInspectorCli(
      ['--file', files.outputPath],
      { log: (...values) => output.push(values.join(' ')) },
    );
    expect(exitCode).toBe(0);
    expect(output).toContain('Records: 1');
    expect(output).toContain('Unique evaluations: 1');
    expect(output).toContain('Eligible cells: 15');
    expect(output).toContain('Raw-return metrics: 15');
    expect(output).toContain('OKX directional metrics: 15');
    expect(output).toContain('External directional metrics: 15');
    expect(output).toContain('Duplicate outcome IDs: 0');
    expect(output).toContain('Win rate, expectancy, MFE, and MAE: not present');
  });

  it('returns nonzero for invalid invocation', async () => {
    expect(
      await runTerminalReturnInspectorCli([], {
        error: () => undefined,
      }),
    ).toBe(1);
  });
});
