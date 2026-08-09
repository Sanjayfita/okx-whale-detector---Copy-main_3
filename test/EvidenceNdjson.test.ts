import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseEvidenceNdjson,
  readEvidenceNdjsonFile,
} from '../src/research/evidenceNdjson';

const temporaryDirectories: string[] = [];

const parseNumberRecord = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('evidence NDJSON', () => {
  it('streams records with the same bounded diagnostics as in-memory parsing', async () => {
    const content = '1\nnot-json\n"wrong-schema"\n\n2\n';
    const directory = await mkdtemp(path.join(os.tmpdir(), 'evidence-ndjson-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'records.ndjson');
    await writeFile(filePath, content, 'utf8');

    const memory = parseEvidenceNdjson(content, parseNumberRecord);
    const streamed = await readEvidenceNdjsonFile(filePath, parseNumberRecord);

    expect(streamed).toEqual(memory);
    expect(streamed.records).toEqual([1, 2]);
    expect(streamed.nonEmptyLines).toBe(4);
    expect(streamed.malformed).toBe(2);
    expect(streamed.issues).toEqual([
      { lineNumber: 2, reason: 'INVALID_JSON' },
      { lineNumber: 3, reason: 'INVALID_RECORD' },
    ]);
  });

  it('caps retained issue details without hiding the malformed count', () => {
    const result = parseEvidenceNdjson(
      'bad\nalso-bad\nstill-bad\n',
      parseNumberRecord,
      { maximumReportedIssues: 1 },
    );

    expect(result.malformed).toBe(3);
    expect(result.issues).toHaveLength(1);
  });

  it('fails closed when resource limits are exceeded', () => {
    expect(() =>
      parseEvidenceNdjson('1\n2\n', parseNumberRecord, {
        maximumRecords: 1,
      }),
    ).toThrow('record limit exceeded');
    expect(() =>
      parseEvidenceNdjson('123\n', parseNumberRecord, {
        maximumLineBytes: 2,
      }),
    ).toThrow('exceeds maximumLineBytes');
  });
});
