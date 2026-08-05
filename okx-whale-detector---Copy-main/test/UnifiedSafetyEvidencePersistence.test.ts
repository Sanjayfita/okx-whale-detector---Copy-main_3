import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createUnifiedSafetyEvidenceBundle,
  type SafetyEvidenceItem,
} from '../src/safety/unifiedSafetyEvidenceBundle';
import {
  createUnifiedSafetyEvidenceDocument,
  readUnifiedSafetyEvidenceDocument,
  readUnifiedSafetyEvidenceDocumentFromText,
  serializeUnifiedSafetyEvidenceDocument,
  writeUnifiedSafetyEvidenceDocument,
} from '../src/safety/unifiedSafetyEvidencePersistence';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const item = (
  source: SafetyEvidenceItem['source'],
  state: SafetyEvidenceItem['state'] = 'PASS',
): SafetyEvidenceItem => ({
  source,
  generatedAt: 900,
  state,
  summary: `${source} summary`,
  reasons: ['deterministic evidence'],
});

const createBundle = () =>
  createUnifiedSafetyEvidenceBundle({
    generatedAt: 1_000,
    evidence: [
      item('LIVE_TRADING_READINESS'),
      item('READINESS_TREND'),
      item('PAPER_TRADING_RISK'),
      item('RUNTIME_HEALTH'),
      item('RECORDING_INTEGRITY'),
    ],
  });

describe('unified safety evidence persistence', () => {
  it('serializes deterministically and preserves disabled order execution', () => {
    const document = createUnifiedSafetyEvidenceDocument({
      generatedAt: 1_100,
      bundle: createBundle(),
    });

    const first = serializeUnifiedSafetyEvidenceDocument(document);
    const second = serializeUnifiedSafetyEvidenceDocument(document);

    expect(second).toBe(first);
    expect(first.endsWith('\n')).toBe(true);
    expect(document.bundle.orderExecutionAuthorized).toBe(false);
    expect(readUnifiedSafetyEvidenceDocumentFromText(first)).toEqual(document);
  });

  it('writes and reads a validated document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'unified-safety-evidence-'));
    temporaryDirectories.push(directory);
    const filePath = join(directory, 'evidence.json');
    const document = createUnifiedSafetyEvidenceDocument({
      generatedAt: 1_100,
      bundle: createBundle(),
    });

    await writeUnifiedSafetyEvidenceDocument(filePath, document);

    expect(await readUnifiedSafetyEvidenceDocument(filePath)).toEqual(document);
    expect((await readFile(filePath, 'utf8')).endsWith('\n')).toBe(true);
  });

  it('rejects malformed and unsupported documents', () => {
    expect(() => readUnifiedSafetyEvidenceDocumentFromText('{')).toThrow(
      'Malformed unified safety evidence JSON',
    );

    const document = createUnifiedSafetyEvidenceDocument({
      generatedAt: 1_100,
      bundle: createBundle(),
    });
    expect(() =>
      readUnifiedSafetyEvidenceDocumentFromText(
        JSON.stringify({ ...document, schemaVersion: 2 }),
      ),
    ).toThrow('Unsupported unified safety evidence schema version');
  });

  it('rejects inconsistent status and enabled order execution', () => {
    const document = createUnifiedSafetyEvidenceDocument({
      generatedAt: 1_100,
      bundle: createBundle(),
    });

    expect(() =>
      readUnifiedSafetyEvidenceDocumentFromText(
        JSON.stringify({
          ...document,
          bundle: { ...document.bundle, status: 'BLOCKED' },
        }),
      ),
    ).toThrow('bundle.status is inconsistent');

    expect(() =>
      readUnifiedSafetyEvidenceDocumentFromText(
        JSON.stringify({
          ...document,
          bundle: { ...document.bundle, orderExecutionAuthorized: true },
        }),
      ),
    ).toThrow('bundle.orderExecutionAuthorized must remain false');
  });

  it('rejects a bundle newer than its document', () => {
    expect(() =>
      createUnifiedSafetyEvidenceDocument({
        generatedAt: 999,
        bundle: createBundle(),
      }),
    ).toThrow('bundle.generatedAt cannot be newer than document generatedAt');
  });
});
