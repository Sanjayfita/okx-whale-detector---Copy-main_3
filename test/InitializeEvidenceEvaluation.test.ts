import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseEvaluationSessionManifest } from '../src/research/evaluationSessionManifest';
import { initializeEvidenceEvaluation } from '../src/tools/initializeEvidenceEvaluation';

describe('initializeEvidenceEvaluation', () => {
  it('creates a frozen, versioned, research-only evidence directory', async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'evidence-init-'));
    const result = initializeEvidenceEvaluation({
      evaluationId: 'eval-test-v1',
      projectDirectory,
      createdAt: 1_800_000_000_000,
      sourceCommit: 'abc123',
      gitStatus: '',
    });
    const persisted = JSON.parse(
      await readFile(join(result.evaluationDirectory, 'manifest.json'), 'utf8'),
    ) as unknown;

    expect(parseEvaluationSessionManifest(persisted, 'eval-test-v1')).toEqual(
      result.manifest,
    );
    expect(result.manifest.minimumQualifiedAlerts).toBe(1_000);
    expect(result.manifest.minimumInstruments).toBe(2);
    expect(
      result.manifest.configuration.alphaResearchConfigurationFingerprint,
    ).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      await readFile(
        join(result.evaluationDirectory, 'alpha-snapshots.ndjson'),
        'utf8',
      ),
    ).toBe('');
    expect(result.liveOrderExecutionAllowed).toBe(false);
  });

  it('refuses to start evidence collection from uncommitted source', async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'evidence-init-'));

    expect(() =>
      initializeEvidenceEvaluation({
        evaluationId: 'eval-test-v1',
        projectDirectory,
        sourceCommit: 'abc123',
        gitStatus: ' M src/index.ts',
      }),
    ).toThrow('clean committed worktree');
  });
});
