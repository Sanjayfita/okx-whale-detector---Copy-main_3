import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const inspectionOrder = vi.hoisted((): string[] => []);

vi.mock('../src/research/evidenceSourceFingerprint', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../src/research/evidenceSourceFingerprint')
    >();
  return {
    ...actual,
    createEvidenceSourceFingerprint: async (evaluationDirectory: string) => {
      inspectionOrder.push('fingerprint');
      return actual.createEvidenceSourceFingerprint(evaluationDirectory);
    },
  };
});

vi.mock('../src/research/evidenceNdjson', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/research/evidenceNdjson')>();
  return {
    ...actual,
    readEvidenceNdjsonFile: async <T>(
      filePath: string,
      parseRecord: (value: unknown) => T | undefined,
      options = {},
    ) => {
      inspectionOrder.push('read');
      return actual.readEvidenceNdjsonFile(filePath, parseRecord, options);
    },
  };
});

import { createAlphaResearchConfig } from '../src/research/alphaResearchConfig';
import { createAlphaResearchConfigurationFingerprint } from '../src/research/alphaResearchFingerprint';
import { createEvaluationSessionManifest } from '../src/research/evaluationSessionManifest';
import { inspectEvidenceProgress } from '../src/research/evidenceProgressInspector';

describe('EvidenceProgressInspector stable active reads', () => {
  it('fingerprints before reading append-only evidence files', async () => {
    inspectionOrder.length = 0;
    const directory = await mkdtemp(
      join(tmpdir(), 'evidence-progress-stability-'),
    );
    const configuration = {
      alphaResearchConfigurationFingerprint:
        createAlphaResearchConfigurationFingerprint(
          createAlphaResearchConfig(),
        ),
    };
    const manifest = createEvaluationSessionManifest({
      evaluationId: 'eval-stability-test',
      sourceCommit: 'test-source',
      configuration,
      instruments: ['BTC-USDT-SWAP'],
      minimumCollectionDays: 1,
      minimumQualifiedAlerts: 1,
      minimumInstruments: 1,
      createdAt: 1_800_000_000_000,
    });

    await Promise.all([
      writeFile(
        join(directory, 'manifest.json'),
        `${JSON.stringify(manifest)}\n`,
        'utf8',
      ),
      writeFile(join(directory, 'qualified-alerts.ndjson'), '', 'utf8'),
      writeFile(join(directory, 'alpha-snapshots.ndjson'), '', 'utf8'),
      writeFile(join(directory, 'outcomes.ndjson'), '', 'utf8'),
      writeFile(
        join(directory, 'pending-observations.json'),
        JSON.stringify({
          schemaVersion: 1,
          pending: [],
          liveOrderExecutionAllowed: false,
        }),
        'utf8',
      ),
    ]);

    await inspectEvidenceProgress(directory, 1_800_000_001_000);

    expect(inspectionOrder[0]).toBe('fingerprint');
    expect(inspectionOrder).toContain('read');
    expect(inspectionOrder[inspectionOrder.length - 1]).toBe('fingerprint');
  });
});
