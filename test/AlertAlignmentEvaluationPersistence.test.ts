import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createDefaultEvaluationConfiguration,
  createEvaluationAlert,
  createPreparedEvaluationMarket,
  EVALUATION_NOW,
} from './helpers/alignmentEvaluationFixtures';
import {
  canonicalJsonStringify,
  generateAlertAlignmentEvaluations,
} from '../src/evaluation';
import { parseAlertAlignmentEvaluationRecord } from '../src/evaluation/alertAlignmentEvaluationValidation';
import { AlertAlignmentEvaluationReader } from '../src/recording/AlertAlignmentEvaluationReader';
import {
  AlertAlignmentEvaluationRecorder,
  type AlertAlignmentEvaluationRecordWriter,
} from '../src/recording/AlertAlignmentEvaluationRecorder';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const temporaryFile = (name: string): string => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'alignment-evaluation-test-'),
  );
  directories.push(directory);
  return path.join(directory, name);
};

const createRecord = () =>
  generateAlertAlignmentEvaluations({
    alerts: [createEvaluationAlert()],
    marketRecording: createPreparedEvaluationMarket(),
    configuration: createDefaultEvaluationConfiguration(),
    evaluationRunId: 'evaluation-run:persistence',
    now: EVALUATION_NOW + 7_200_000,
  })[0]!;

const mutate = (
  record: ReturnType<typeof createRecord>,
  apply: (copy: Record<string, unknown>) => void,
): string => {
  const copy = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  apply(copy);
  return JSON.stringify(copy);
};

describe('alert alignment evaluation validation', () => {
  it('accepts a valid generated record', () => {
    const record = createRecord();
    expect(parseAlertAlignmentEvaluationRecord(JSON.stringify(record))).toEqual(
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
      'schema',
      (copy: Record<string, unknown>) => {
        copy.schemaVersion = 2;
      },
      /Unsupported/,
    ],
    [
      'evaluator version',
      (copy: Record<string, unknown>) => {
        (copy.provenance as Record<string, unknown>).evaluatorVersion = '';
      },
      /provenance/,
    ],
    [
      'evaluation ID',
      (copy: Record<string, unknown>) => {
        copy.evaluationId = 'bad';
      },
      /identity/,
    ],
    [
      'run ID',
      (copy: Record<string, unknown>) => {
        copy.evaluationRunId = 'bad id';
      },
      /identity/,
    ],
    [
      'instrument',
      (copy: Record<string, unknown>) => {
        (copy.instrument as Record<string, unknown>).instType = 'FUTURES';
      },
      /instrument/,
    ],
    [
      'configuration fingerprint',
      (copy: Record<string, unknown>) => {
        (copy.configuration as Record<string, unknown>).fingerprint =
          '0'.repeat(64);
      },
      /fingerprint/,
    ],
  ])('rejects malformed %s fields', (_name, apply, expected) => {
    expect(() =>
      parseAlertAlignmentEvaluationRecord(mutate(createRecord(), apply)),
    ).toThrow(expected);
  });

  it('rejects duplicate, missing, unrequested, and unordered matrix pairs', () => {
    const record = createRecord();
    const duplicate = mutate(record, (copy) => {
      const alignments = copy.alignments as unknown[];
      alignments[1] = alignments[0];
    });
    const missing = mutate(record, (copy) => {
      (copy.alignments as unknown[]).pop();
    });
    const unrequested = mutate(record, (copy) => {
      const alignment = (copy.alignments as Record<string, unknown>[])[0]!;
      alignment.horizonMs = 42;
    });
    const unordered = mutate(record, (copy) => {
      (copy.alignments as unknown[]).reverse();
    });

    for (const line of [duplicate, missing, unrequested, unordered]) {
      expect(() => parseAlertAlignmentEvaluationRecord(line)).toThrow(
        /matrix|target/,
      );
    }
  });

  it('rejects contradictory completeness and source-specific observations', () => {
    const contradiction = mutate(createRecord(), (copy) => {
      const alignment = (copy.alignments as Record<string, unknown>[])[0]!;
      alignment.completeness = 'MISSING';
      alignment.primaryReason = null;
      alignment.reasons = [];
    });
    const sourceMismatch = mutate(createRecord(), (copy) => {
      const alignment = (copy.alignments as Record<string, unknown>[])[0]!;
      (alignment.selectedObservation as Record<string, unknown>).close = 101;
    });

    expect(() => parseAlertAlignmentEvaluationRecord(contradiction)).toThrow(
      /Contradictory/,
    );
    expect(() => parseAlertAlignmentEvaluationRecord(sourceMismatch)).toThrow(
      /source-specific/,
    );
  });

  it('accepts typed inconsistent-reference evaluations but rejects non-finite storage', () => {
    const invalidRecord = generateAlertAlignmentEvaluations({
      alerts: [createEvaluationAlert({ referenceMidpoint: 999 })],
      marketRecording: createPreparedEvaluationMarket(),
      configuration: createDefaultEvaluationConfiguration(),
      evaluationRunId: 'evaluation-run:invalid-reference',
      now: EVALUATION_NOW + 7_200_000,
    })[0]!;

    expect(() =>
      parseAlertAlignmentEvaluationRecord(JSON.stringify(invalidRecord)),
    ).not.toThrow();
    expect(() =>
      parseAlertAlignmentEvaluationRecord(
        mutate(createRecord(), (copy) => {
          (copy.reference as Record<string, unknown>).midpoint = null;
        }),
      ),
    ).toThrow(/reference/);
  });
});

describe('alert alignment evaluation JSONL persistence', () => {
  it('round-trips multiple records and writes one canonical UTF-8 line each', async () => {
    const filePath = temporaryFile('evaluations.jsonl');
    const records = generateAlertAlignmentEvaluations({
      alerts: [createEvaluationAlert(), createEvaluationAlert({ sequence: 2 })],
      marketRecording: createPreparedEvaluationMarket(),
      configuration: createDefaultEvaluationConfiguration(),
      evaluationRunId: 'evaluation-run:multiple',
      now: EVALUATION_NOW + 7_200_000,
    });
    const recorder = new AlertAlignmentEvaluationRecorder(filePath);
    for (const record of records) {
      recorder.record(record);
    }
    recorder.close();
    recorder.close();

    const contents = readFileSync(filePath, 'utf8');
    expect(contents).toBe(
      records.map((record) => canonicalJsonStringify(record)).join('\n') + '\n',
    );
    const read = await new AlertAlignmentEvaluationReader().read(filePath);
    expect(read.records).toHaveLength(2);
    expect(read.malformedLines).toEqual([]);
    expect(read.duplicateEvaluationIds).toEqual([]);
  });

  it('produces byte-identical files for identical injected inputs', () => {
    const leftPath = temporaryFile('left.jsonl');
    const rightPath = temporaryFile('right.jsonl');
    const record = createRecord();
    for (const filePath of [leftPath, rightPath]) {
      const recorder = new AlertAlignmentEvaluationRecorder(filePath);
      recorder.record(record);
      recorder.close();
    }

    expect(readFileSync(leftPath)).toEqual(readFileSync(rightPath));
  });

  it('retains malformed, unsupported, and duplicate diagnostics', async () => {
    const filePath = temporaryFile('diagnostics.jsonl');
    const record = createRecord();
    const unsupported = {
      ...record,
      schemaVersion: 99,
    };
    writeFileSync(
      filePath,
      [
        canonicalJsonStringify(record),
        '{bad json',
        JSON.stringify(unsupported),
        canonicalJsonStringify(record),
        '',
      ].join('\n'),
      'utf8',
    );

    const read = await new AlertAlignmentEvaluationReader().read(filePath);
    expect(read.records).toHaveLength(2);
    expect(read.malformedLines).toHaveLength(1);
    expect(read.unsupportedSchemaVersions).toHaveLength(1);
    expect(read.duplicateEvaluationIds).toHaveLength(1);
    expect(read.duplicateUnits).toHaveLength(1);
  });

  it('surfaces append and close failures and rejects writes after close', () => {
    const appendFailure: AlertAlignmentEvaluationRecordWriter = {
      append: () => {
        throw new Error('append failed');
      },
      close: () => undefined,
    };
    const recorder = new AlertAlignmentEvaluationRecorder('unused.jsonl', {
      writerFactory: () => appendFailure,
    });
    expect(() => recorder.record(createRecord())).toThrow('append failed');

    const closeFailure = new AlertAlignmentEvaluationRecorder('unused.jsonl', {
      writerFactory: () => ({
        append: () => undefined,
        close: () => {
          throw new Error('close failed');
        },
      }),
    });
    expect(() => closeFailure.close()).toThrow('close failed');

    const closed = new AlertAlignmentEvaluationRecorder('unused.jsonl', {
      writerFactory: () => ({
        append: () => undefined,
        close: () => undefined,
      }),
    });
    closed.close();
    expect(() => closed.record(createRecord())).toThrow(/closed/);
  });
});
