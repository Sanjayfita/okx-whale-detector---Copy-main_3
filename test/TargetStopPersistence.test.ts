import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from '../src/evaluation';
import { AlertTargetStopOutcomeReader } from '../src/recording/AlertTargetStopOutcomeReader';
import {
  AlertTargetStopOutcomeRecorder,
  type AlertTargetStopOutcomeRecordWriter,
} from '../src/recording/AlertTargetStopOutcomeRecorder';
import { generateTargetStopFixtureRecord } from './helpers/targetStopFixtures';

const directories: string[] = [];
const temporaryFile = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'target-stop-test-'));
  directories.push(directory);
  return path.join(directory, 'target-stop.jsonl');
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('AlertTargetStopOutcomeRecorder and reader', () => {
  it('round-trips canonical UTF-8 JSONL deterministically', async () => {
    const output = temporaryFile();
    const record = generateTargetStopFixtureRecord();
    const recorder = new AlertTargetStopOutcomeRecorder(output);
    recorder.record(record);
    recorder.close();

    expect(readFileSync(output, 'utf8')).toBe(
      `${canonicalJsonStringify(record)}\n`,
    );
    const read = await new AlertTargetStopOutcomeReader().read(output);
    expect(read.records).toEqual([record]);
    expect(read.malformedLines).toEqual([]);
  });

  it('appends records and closes idempotently', async () => {
    const output = temporaryFile();
    const record = generateTargetStopFixtureRecord();
    const first = new AlertTargetStopOutcomeRecorder(output);
    first.record(record);
    first.close();
    first.close();
    const second = new AlertTargetStopOutcomeRecorder(output);
    second.record(record);
    second.close();
    expect(
      (await new AlertTargetStopOutcomeReader().read(output)).records,
    ).toHaveLength(2);
  });

  it('reports malformed, unsupported, and duplicate records', async () => {
    const output = temporaryFile();
    const line = canonicalJsonStringify(generateTargetStopFixtureRecord());
    writeFileSync(
      output,
      `${line}\n${line}\nnot-json\n{"recordType":"alertTargetStopOutcome","schemaVersion":2}\n`,
    );
    const read = await new AlertTargetStopOutcomeReader().read(output);
    expect(read.records).toHaveLength(2);
    expect(read.duplicateOutcomeIds).toHaveLength(1);
    expect(read.duplicateUnits).toHaveLength(1);
    expect(read.malformedLines).toEqual([
      expect.objectContaining({ lineNumber: 3 }),
    ]);
    expect(read.unsupportedSchemaVersions).toEqual([
      expect.objectContaining({ lineNumber: 4, schemaVersion: 2 }),
    ]);
  });

  it('rejects writes after close', () => {
    const recorder = new AlertTargetStopOutcomeRecorder(temporaryFile());
    recorder.close();
    expect(() => recorder.record(generateTargetStopFixtureRecord())).toThrow(
      'Target/stop recorder is closed',
    );
  });

  it('propagates writer failures and closes once', () => {
    let closeCount = 0;
    const writer: AlertTargetStopOutcomeRecordWriter = {
      append: () => {
        throw new Error('disk unavailable');
      },
      close: () => {
        closeCount += 1;
      },
    };
    const recorder = new AlertTargetStopOutcomeRecorder('virtual.jsonl', {
      writerFactory: () => writer,
    });
    expect(() => recorder.record(generateTargetStopFixtureRecord())).toThrow(
      'disk unavailable',
    );
    recorder.close();
    recorder.close();
    expect(closeCount).toBe(1);
  });

  it('validates before writing', () => {
    let appended = false;
    const recorder = new AlertTargetStopOutcomeRecorder('virtual.jsonl', {
      writerFactory: () => ({
        append: () => {
          appended = true;
        },
        close: () => undefined,
      }),
    });
    const invalid = structuredClone(generateTargetStopFixtureRecord());
    invalid.targetStopOutcomeId = 'invalid';
    expect(() => recorder.record(invalid)).toThrow(
      'Invalid targetStopOutcomeId',
    );
    expect(appended).toBe(false);
    recorder.close();
  });
});
