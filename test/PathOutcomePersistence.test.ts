import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from '../src/evaluation';
import {
  AlertPathOutcomeRecorder,
  type AlertPathOutcomeRecordWriter,
} from '../src/recording/AlertPathOutcomeRecorder';
import { AlertPathOutcomeReader } from '../src/recording/AlertPathOutcomeReader';
import { generatePathFixtureRecord } from './helpers/pathOutcomeFixtures';

const directories: string[] = [];
const temporaryFile = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'path-outcome-test-'));
  directories.push(directory);
  return path.join(directory, 'path-outcomes.jsonl');
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('AlertPathOutcomeRecorder and AlertPathOutcomeReader', () => {
  it('round-trips canonical UTF-8 JSONL deterministically', async () => {
    const output = temporaryFile();
    const record = generatePathFixtureRecord();
    const recorder = new AlertPathOutcomeRecorder(output);
    recorder.record(record);
    recorder.close();

    expect(readFileSync(output, 'utf8')).toBe(
      `${canonicalJsonStringify(record)}\n`,
    );
    const result = await new AlertPathOutcomeReader().read(output);
    expect(result.records).toEqual([record]);
    expect(result.malformedLines).toEqual([]);
  });

  it('appends records and closes idempotently', async () => {
    const output = temporaryFile();
    const record = generatePathFixtureRecord();
    const first = new AlertPathOutcomeRecorder(output);
    first.record(record);
    first.close();
    first.close();
    const second = new AlertPathOutcomeRecorder(output);
    second.record(record);
    second.close();

    expect(
      (await new AlertPathOutcomeReader().read(output)).records,
    ).toHaveLength(2);
  });

  it('reports malformed lines and unsupported versions without dropping diagnostics', async () => {
    const output = temporaryFile();
    writeFileSync(
      output,
      `${canonicalJsonStringify(generatePathFixtureRecord())}\nnot-json\n{"recordType":"alertPathOutcome","schemaVersion":2}\n`,
    );
    const result = await new AlertPathOutcomeReader().read(output);
    expect(result.records).toHaveLength(1);
    expect(result.malformedLines).toEqual([
      expect.objectContaining({ lineNumber: 2 }),
    ]);
    expect(result.unsupportedSchemaVersions).toEqual([
      expect.objectContaining({ lineNumber: 3, schemaVersion: 2 }),
    ]);
  });

  it('reports duplicate IDs and duplicate evaluation/policy units', async () => {
    const output = temporaryFile();
    const line = canonicalJsonStringify(generatePathFixtureRecord());
    writeFileSync(output, `${line}\n${line}\n`);
    const result = await new AlertPathOutcomeReader().read(output);
    expect(result.duplicatePathOutcomeIds).toHaveLength(1);
    expect(result.duplicateUnits).toHaveLength(1);
    expect(result.duplicatePathOutcomeIds[0]).toMatchObject({
      firstLineNumber: 1,
      duplicateLineNumber: 2,
    });
  });

  it('rejects writes after close', () => {
    const recorder = new AlertPathOutcomeRecorder(temporaryFile());
    recorder.close();
    expect(() => recorder.record(generatePathFixtureRecord())).toThrow(
      'Path-outcome recorder is closed',
    );
  });

  it('propagates append failures and still permits idempotent close', () => {
    let closeCount = 0;
    const writer: AlertPathOutcomeRecordWriter = {
      append: () => {
        throw new Error('disk unavailable');
      },
      close: () => {
        closeCount += 1;
      },
    };
    const recorder = new AlertPathOutcomeRecorder('virtual.jsonl', {
      writerFactory: () => writer,
    });
    expect(() => recorder.record(generatePathFixtureRecord())).toThrow(
      'disk unavailable',
    );
    recorder.close();
    recorder.close();
    expect(closeCount).toBe(1);
  });

  it('validates records before attempting a write', () => {
    let appended = false;
    const recorder = new AlertPathOutcomeRecorder('virtual.jsonl', {
      writerFactory: () => ({
        append: () => {
          appended = true;
        },
        close: () => undefined,
      }),
    });
    const invalid = structuredClone(generatePathFixtureRecord());
    invalid.pathOutcomeId = 'invalid';
    expect(() => recorder.record(invalid)).toThrow('Invalid pathOutcomeId');
    expect(appended).toBe(false);
    recorder.close();
  });
});
