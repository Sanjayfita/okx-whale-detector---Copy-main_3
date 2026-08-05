import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCorrelatedAlertSemanticFingerprint } from '../src/recording/correlatedAlertEvaluationContext';
import { AlertAlignmentEvaluationReader } from '../src/recording/AlertAlignmentEvaluationReader';
import { runAlertAlignmentGeneratorCli } from '../src/tools/generateAlertAlignmentEvaluations';
import { runAlertAlignmentInspectorCli } from '../src/tools/inspectAlertAlignmentEvaluations';
import {
  EVALUATION_NOW,
  createEvaluationAlert,
  createEvaluationMarketLines,
} from './helpers/alignmentEvaluationFixtures';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const workspace = () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'alignment-evaluation-cli-'),
  );
  directories.push(directory);
  const alert = createEvaluationAlert();
  alert.semanticFingerprint = createCorrelatedAlertSemanticFingerprint(
    alert.alert,
    alert.evaluationContext,
  );
  const alertsPath = path.join(directory, 'alerts.jsonl');
  const marketPath = path.join(directory, 'market.jsonl');
  const outputPath = path.join(directory, 'evaluations.jsonl');
  writeFileSync(alertsPath, `${JSON.stringify(alert)}\n`, 'utf8');
  writeFileSync(
    marketPath,
    `${createEvaluationMarketLines().join('\n')}\n`,
    'utf8',
  );
  return { directory, alertsPath, marketPath, outputPath };
};

describe('alert alignment evaluation generator CLI', () => {
  it('generates deterministic custom-source records and prints totals', async () => {
    const files = workspace();
    const output: string[] = [];
    const errors: string[] = [];
    const exitCode = await runAlertAlignmentGeneratorCli(
      [
        '--alerts',
        files.alertsPath,
        '--market-data',
        files.marketPath,
        '--output',
        files.outputPath,
        '--horizons',
        '1m',
        '--sources',
        'midpoint,candle-close',
        '--evaluation-run-id',
        'evaluation-run:cli',
        '--now',
        String(EVALUATION_NOW + 7_200_000),
      ],
      {
        log: (...values) => output.push(values.join(' ')),
        error: (...values) => errors.push(values.join(' ')),
      },
    );

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(output).toContain('Evaluation records: 1');
    expect(output).toContain('Alignment cells: 2');
    expect(output).toContain('COMPLETE: 2');
    const read = await new AlertAlignmentEvaluationReader().read(
      files.outputPath,
    );
    expect(read.records[0]?.evaluationRunId).toBe('evaluation-run:cli');
    expect(read.records[0]?.alignments.map((result) => result.source)).toEqual([
      'ORDER_BOOK_MIDPOINT',
      'CONFIRMED_CANDLE_CLOSE',
    ]);
  });

  it('reports malformed alert lines while retaining valid records', async () => {
    const files = workspace();
    writeFileSync(
      files.alertsPath,
      `${readFileSync(files.alertsPath, 'utf8')}{bad json\n`,
      'utf8',
    );
    const warnings: string[] = [];
    const exitCode = await runAlertAlignmentGeneratorCli(
      [
        '--alerts',
        files.alertsPath,
        '--market-data',
        files.marketPath,
        '--output',
        files.outputPath,
        '--evaluation-run-id',
        'evaluation-run:malformed-alert',
        '--now',
        String(EVALUATION_NOW + 7_200_000),
      ],
      {
        warn: (...values) => warnings.push(values.join(' ')),
        log: () => undefined,
      },
    );

    expect(exitCode).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Malformed alert line 2/);
  });

  it('fails for missing inputs, malformed market JSON, and path collisions', async () => {
    const files = workspace();
    const errors: string[] = [];
    expect(
      await runAlertAlignmentGeneratorCli([], {
        error: (...values) => errors.push(values.join(' ')),
      }),
    ).toBe(1);

    writeFileSync(files.marketPath, '{bad json\n', 'utf8');
    expect(
      await runAlertAlignmentGeneratorCli(
        [
          '--alerts',
          files.alertsPath,
          '--market-data',
          files.marketPath,
          '--output',
          files.outputPath,
        ],
        { error: (...values) => errors.push(values.join(' ')) },
      ),
    ).toBe(1);

    expect(
      await runAlertAlignmentGeneratorCli(
        [
          '--alerts',
          files.alertsPath,
          '--market-data',
          files.marketPath,
          '--output',
          files.alertsPath,
        ],
        { error: (...values) => errors.push(values.join(' ')) },
      ),
    ).toBe(1);
    expect(errors.join('\n')).toMatch(/Usage|malformed JSON|must differ/);
  });
});

describe('alert alignment evaluation inspector CLI', () => {
  it('reports identities, completeness, provenance, and no returns', async () => {
    const files = workspace();
    expect(
      await runAlertAlignmentGeneratorCli(
        [
          '--alerts',
          files.alertsPath,
          '--market-data',
          files.marketPath,
          '--output',
          files.outputPath,
          '--horizons',
          '1m',
          '--evaluation-run-id',
          'evaluation-run:inspect',
          '--now',
          String(EVALUATION_NOW + 7_200_000),
        ],
        { log: () => undefined },
      ),
    ).toBe(0);
    const output: string[] = [];
    const exitCode = await runAlertAlignmentInspectorCli(
      ['--file', files.outputPath],
      { log: (...values) => output.push(values.join(' ')) },
    );

    expect(exitCode).toBe(0);
    expect(output).toContain('Records: 1');
    expect(output).toContain('Unique alerts: 1');
    expect(output).toContain('COMPLETE: 3');
    expect(output).toContain('Malformed lines: 0');
    expect(output).toContain('Duplicate evaluation IDs: 0');
    expect(output).toContain('Returns/outcomes: not present');
  });

  it('returns nonzero for an invalid invocation', async () => {
    expect(
      await runAlertAlignmentInspectorCli([], {
        error: () => undefined,
      }),
    ).toBe(1);
  });
});
