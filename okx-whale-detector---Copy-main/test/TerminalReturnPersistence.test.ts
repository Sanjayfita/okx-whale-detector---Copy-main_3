import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from '../src/evaluation';
import { parseAlertTerminalReturnRecord } from '../src/evaluation/terminalReturnValidation';
import { AlertTerminalReturnReader } from '../src/recording/AlertTerminalReturnReader';
import {
  AlertTerminalReturnRecorder,
  type AlertTerminalReturnRecordWriter,
} from '../src/recording/AlertTerminalReturnRecorder';
import {
  createReturnEvaluation,
  createTerminalReturnRecord,
} from './helpers/terminalReturnFixtures';
import { generateTerminalReturnRecords } from '../src/evaluation/terminalReturnGenerator';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const file = (name: string): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'terminal-return-test-'));
  directories.push(directory);
  return path.join(directory, name);
};

const mutate = (apply: (copy: Record<string, unknown>) => void): string => {
  const copy = JSON.parse(
    JSON.stringify(createTerminalReturnRecord()),
  ) as Record<string, unknown>;
  apply(copy);
  return JSON.stringify(copy);
};

describe('terminal-return schema validation', () => {
  it('accepts a valid generated record', () => {
    const record = createTerminalReturnRecord();
    expect(parseAlertTerminalReturnRecord(JSON.stringify(record))).toEqual(
      record,
    );
  });

  it.each([
    [
      'record type',
      (copy: Record<string, unknown>) => {
        copy.recordType = 'other';
      },
      /record type/,
    ],
    [
      'schema version',
      (copy: Record<string, unknown>) => {
        copy.schemaVersion = 2;
      },
      /Unsupported/,
    ],
    [
      'evaluator version',
      (copy: Record<string, unknown>) => {
        copy.evaluatorVersion = '';
      },
      /identity/,
    ],
    [
      'outcome ID',
      (copy: Record<string, unknown>) => {
        copy.outcomeId = 'bad';
      },
      /identity/,
    ],
    [
      'run ID',
      (copy: Record<string, unknown>) => {
        copy.outcomeRunId = 'bad id';
      },
      /identity/,
    ],
    [
      'policy fingerprint',
      (copy: Record<string, unknown>) => {
        (copy.returnPolicy as Record<string, unknown>).fingerprint = '0'.repeat(
          64,
        );
      },
      /fingerprint/,
    ],
  ])('rejects malformed %s', (_name, apply, expected) => {
    expect(() => parseAlertTerminalReturnRecord(mutate(apply))).toThrow(
      expected,
    );
  });

  it('rejects duplicate, missing, and unordered return cells', () => {
    const duplicate = mutate((copy) => {
      const cells = copy.returns as unknown[];
      cells[1] = cells[0];
    });
    const missing = mutate((copy) => {
      (copy.returns as unknown[]).pop();
    });
    const unordered = mutate((copy) => {
      (copy.returns as unknown[]).reverse();
    });
    for (const line of [duplicate, missing, unordered]) {
      expect(() => parseAlertTerminalReturnRecord(line)).toThrow(/matrix/);
    }
  });

  it('rejects inconsistent raw, directional, and executable formulas', () => {
    const raw = mutate((copy) => {
      (copy.returns as Record<string, unknown>[])[0]!.rawReturn = 999;
    });
    const directional = mutate((copy) => {
      (copy.returns as Record<string, unknown>[])[0]!.okxDirectionalReturn =
        999;
    });
    const executable = mutate((copy) => {
      const cell = (copy.returns as Record<string, unknown>[])[1]!;
      (cell.okxExecutable as Record<string, unknown>).exitPrice = 999;
    });

    expect(() => parseAlertTerminalReturnRecord(raw)).toThrow(/raw/);
    expect(() => parseAlertTerminalReturnRecord(directional)).toThrow(
      /directional/,
    );
    expect(() => parseAlertTerminalReturnRecord(executable)).toThrow(
      /executable/,
    );
  });

  it('rejects inconsistent copied reference arithmetic', () => {
    const line = mutate((copy) => {
      (copy.reference as Record<string, unknown>).spread = 99;
    });
    expect(() => parseAlertTerminalReturnRecord(line)).toThrow(
      /reference arithmetic/,
    );
  });

  it('rejects metrics on ineligible cells', () => {
    const line = mutate((copy) => {
      const cell = (copy.returns as Record<string, unknown>[])[0]!;
      cell.eligibility = 'INELIGIBLE';
      cell.reasons = ['POLICY_INELIGIBLE'];
    });
    expect(() => parseAlertTerminalReturnRecord(line)).toThrow(
      /contains metrics|contradicts alignment/,
    );
  });
});

describe('terminal-return JSONL persistence', () => {
  it('round-trips multiple canonical records with idempotent close', async () => {
    const outputPath = file('returns.jsonl');
    const records = generateTerminalReturnRecords({
      evaluations: [
        createReturnEvaluation({ sequence: 1 }),
        createReturnEvaluation({ sequence: 2 }),
      ],
      outcomeRunId: 'terminal-return-run:persistence',
      now: Date.UTC(2026, 6, 29, 14),
    });
    const recorder = new AlertTerminalReturnRecorder(outputPath);
    records.forEach((record) => recorder.record(record));
    recorder.close();
    recorder.close();

    expect(readFileSync(outputPath, 'utf8')).toBe(
      `${records.map(canonicalJsonStringify).join('\n')}\n`,
    );
    const read = await new AlertTerminalReturnReader().read(outputPath);
    expect(read.records).toHaveLength(2);
    expect(read.malformedLines).toEqual([]);
    expect(read.duplicateOutcomeIds).toEqual([]);
  });

  it('writes byte-identical output for identical injected inputs', () => {
    const left = file('left.jsonl');
    const right = file('right.jsonl');
    const record = createTerminalReturnRecord();
    for (const outputPath of [left, right]) {
      const recorder = new AlertTerminalReturnRecorder(outputPath);
      recorder.record(record);
      recorder.close();
    }
    expect(readFileSync(left)).toEqual(readFileSync(right));
  });

  it('reports malformed, unsupported, and duplicate lines', async () => {
    const outputPath = file('diagnostics.jsonl');
    const record = createTerminalReturnRecord();
    writeFileSync(
      outputPath,
      [
        canonicalJsonStringify(record),
        '{bad json',
        JSON.stringify({ ...record, schemaVersion: 99 }),
        canonicalJsonStringify(record),
        '',
      ].join('\n'),
      'utf8',
    );
    const read = await new AlertTerminalReturnReader().read(outputPath);
    expect(read.records).toHaveLength(2);
    expect(read.malformedLines).toHaveLength(1);
    expect(read.unsupportedSchemaVersions).toHaveLength(1);
    expect(read.duplicateOutcomeIds).toHaveLength(1);
    expect(read.duplicateUnits).toHaveLength(1);
  });

  it('surfaces append/close failures and rejects writes after close', () => {
    const failingWriter: AlertTerminalReturnRecordWriter = {
      append: () => {
        throw new Error('append failed');
      },
      close: () => undefined,
    };
    const append = new AlertTerminalReturnRecorder('unused.jsonl', {
      writerFactory: () => failingWriter,
    });
    expect(() => append.record(createTerminalReturnRecord())).toThrow(
      'append failed',
    );

    const close = new AlertTerminalReturnRecorder('unused.jsonl', {
      writerFactory: () => ({
        append: () => undefined,
        close: () => {
          throw new Error('close failed');
        },
      }),
    });
    expect(() => close.close()).toThrow('close failed');

    const closed = new AlertTerminalReturnRecorder('unused.jsonl', {
      writerFactory: () => ({
        append: () => undefined,
        close: () => undefined,
      }),
    });
    closed.close();
    expect(() => closed.record(createTerminalReturnRecord())).toThrow(/closed/);
  });
});
