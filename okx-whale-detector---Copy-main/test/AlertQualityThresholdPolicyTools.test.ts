import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runGenerateAlertQualityThresholdEvaluationCli } from '../src/tools/generateAlertQualityThresholdEvaluation';
import { runInspectAlertQualityThresholdEvaluationsCli } from '../src/tools/inspectAlertQualityThresholdEvaluations';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const capture = () => {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    output,
    errors,
    dependencies: {
      log: (...values: unknown[]) => output.push(values.map(String).join(' ')),
      error: (...values: unknown[]) => errors.push(values.map(String).join(' ')),
    },
  };
};

describe('alert-quality threshold policy persistence tools', () => {
  it('rejects missing generator options', async () => {
    const captured = capture();
    const code = await runGenerateAlertQualityThresholdEvaluationCli([], captured.dependencies);
    expect(code).toBe(1);
    expect(captured.errors.join('\n')).toContain('--file is required');
  });

  it('rejects a unified-report file with read issues', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'threshold-policy-tools-'));
    directories.push(directory);
    const input = path.join(directory, 'quality.jsonl');
    await writeFile(input, '{broken\n', 'utf8');
    const captured = capture();
    const code = await runGenerateAlertQualityThresholdEvaluationCli(
      ['--file', input, '--output', path.join(directory, 'out.jsonl'), '--run-id', 'run:1', '--generated-at', '1'],
      captured.dependencies,
    );
    expect(code).toBe(1);
    expect(captured.errors.join('\n')).toContain('read issue');
  });

  it('inspects an empty evaluation file deterministically', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'threshold-policy-tools-'));
    directories.push(directory);
    const input = path.join(directory, 'evaluations.jsonl');
    await writeFile(input, '', 'utf8');
    const captured = capture();
    const code = await runInspectAlertQualityThresholdEvaluationsCli(['--file', input], captured.dependencies);
    expect(code).toBe(0);
    expect(captured.output).toContain('Valid evaluations: 0');
    expect(captured.output).toContain('Read issues: 0');
  });

  it('returns failure when inspection finds malformed JSON', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'threshold-policy-tools-'));
    directories.push(directory);
    const input = path.join(directory, 'evaluations.jsonl');
    await writeFile(input, '{broken\n', 'utf8');
    const captured = capture();
    const code = await runInspectAlertQualityThresholdEvaluationsCli(['--file', input], captured.dependencies);
    expect(code).toBe(1);
    expect(captured.output.join('\n')).toContain('MALFORMED_JSON');
  });
});
