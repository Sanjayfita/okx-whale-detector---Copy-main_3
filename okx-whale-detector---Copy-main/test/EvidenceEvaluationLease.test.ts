import {
  access,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_EVALUATION_LEASE_SCHEMA_VERSION,
  EvidenceEvaluationLease,
  parseEvidenceEvaluationLeaseRecord,
} from '../src/research/evidenceEvaluationLease';

const createDirectory = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'evidence-evaluation-lease-'));

const createLease = (
  directory: string,
  leaseId: string,
  overrides: Readonly<{
    host?: string;
    processId?: number;
    isProcessAlive?: (processId: number) => boolean;
    purpose?: 'COLLECTION' | 'FINALIZATION';
  }> = {},
): EvidenceEvaluationLease =>
  new EvidenceEvaluationLease({
    evaluationDirectory: directory,
    evaluationId: 'eval-test',
    sourceCommit: 'source-commit',
    configurationFingerprint: 'configuration-fingerprint',
    purpose: overrides.purpose ?? 'COLLECTION',
    clock: () => 1_800_000_000_000,
    processId: overrides.processId ?? 7_001,
    host: overrides.host ?? 'research-host',
    leaseIdFactory: () => leaseId,
    isProcessAlive: overrides.isProcessAlive ?? (() => true),
  });

describe('EvidenceEvaluationLease', () => {
  it('allows exactly one active writer and releases only its own lease', async () => {
    const directory = await createDirectory();
    const first = createLease(directory, 'lease-one');
    const second = createLease(directory, 'lease-two');

    const record = await first.acquire();
    expect(record.purpose).toBe('COLLECTION');
    await expect(second.acquire()).rejects.toThrow(
      'Another process owns this evidence evaluation',
    );

    await first.release();
    await expect(access(join(directory, 'evaluation.lock'))).rejects.toThrow();

    await expect(second.acquire()).resolves.toMatchObject({
      leaseId: 'lease-two',
    });
    await second.release();
  });

  it('archives a same-host lease whose owner is demonstrably dead', async () => {
    const directory = await createDirectory();
    const staleRecord = {
      schemaVersion: EVIDENCE_EVALUATION_LEASE_SCHEMA_VERSION,
      leaseId: 'stale-lease',
      evaluationId: 'eval-test',
      sourceCommit: 'source-commit',
      configurationFingerprint: 'configuration-fingerprint',
      purpose: 'COLLECTION',
      host: 'research-host',
      processId: 7_000,
      acquiredAt: 1_799_999_000_000,
      liveOrderExecutionAllowed: false,
    } as const;
    await writeFile(
      join(directory, 'evaluation.lock'),
      `${JSON.stringify(staleRecord)}\n`,
      'utf8',
    );
    const replacement = createLease(directory, 'replacement-lease', {
      processId: 7_001,
      isProcessAlive: () => false,
    });

    await expect(replacement.acquire()).resolves.toMatchObject({
      leaseId: 'replacement-lease',
    });
    const history = await readdir(join(directory, 'lease-history'));
    expect(history).toEqual(['stale-lease.stale.json']);
    const archivedName = history[0];
    if (archivedName === undefined) {
      throw new Error('Expected an archived stale lease');
    }
    const archived = parseEvidenceEvaluationLeaseRecord(
      JSON.parse(
        await readFile(join(directory, 'lease-history', archivedName), 'utf8'),
      ) as unknown,
    );
    expect(archived).toEqual(staleRecord);
    await replacement.release();
  });

  it('does not steal a valid lease from another host', async () => {
    const directory = await createDirectory();
    const remote = createLease(directory, 'remote-lease', {
      host: 'remote-host',
    });
    const local = createLease(directory, 'local-lease', {
      host: 'local-host',
      isProcessAlive: () => false,
    });
    await remote.acquire();

    await expect(local.acquire()).rejects.toThrow(
      'Another process owns this evidence evaluation',
    );
    await remote.release();
  });

  it('refuses to replace an unreadable lease record', async () => {
    const directory = await createDirectory();
    await writeFile(join(directory, 'evaluation.lock'), 'not-json\n', 'utf8');
    const lease = createLease(directory, 'local-lease', {
      isProcessAlive: () => false,
    });

    await expect(lease.acquire()).rejects.toThrow(
      'Existing evidence evaluation lease is unreadable',
    );
    await expect(
      readFile(join(directory, 'evaluation.lock'), 'utf8'),
    ).resolves.toBe('not-json\n');
  });
});
