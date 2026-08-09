import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadEvidenceCollectBootstrap } from '../src/research/evidenceCollectBootstrap';
import { createCurrentEvidenceEvaluationDefinition } from '../src/research/evidenceEvaluationDefinition';
import { createEvaluationSessionManifest } from '../src/research/evaluationSessionManifest';

const createFixture = async () => {
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'evidence-collect-bootstrap-'),
  );
  const evaluationId = 'eval-test-v1';
  const evaluationDirectory = join(
    projectDirectory,
    'data',
    'evaluations',
    evaluationId,
  );
  await mkdir(evaluationDirectory, { recursive: true });

  const definition = createCurrentEvidenceEvaluationDefinition();
  const manifest = createEvaluationSessionManifest({
    evaluationId,
    sourceCommit: 'abc123',
    configuration: definition.configuration,
    instruments: definition.instruments,
    horizonsMinutes: definition.horizonsMinutes,
    minimumCollectionDays: definition.minimumCollectionDays,
    minimumQualifiedAlerts: definition.minimumQualifiedAlerts,
    minimumInstruments: definition.minimumInstruments,
    createdAt: 1_000,
  });
  await writeFile(
    join(evaluationDirectory, 'manifest.json'),
    `${JSON.stringify(manifest)}\n`,
    'utf8',
  );

  return { projectDirectory, evaluationId, evaluationDirectory, manifest };
};

describe('loadEvidenceCollectBootstrap', () => {
  it('loads a frozen research-only evaluation', async () => {
    const fixture = await createFixture();

    const result = await loadEvidenceCollectBootstrap(
      fixture.evaluationId,
      fixture.projectDirectory,
      { sourceCommit: 'abc123', gitStatus: '' },
    );

    expect(result.evaluationDirectory).toBe(fixture.evaluationDirectory);
    expect(result.manifest).toEqual(fixture.manifest);
    expect(result.liveOrderExecutionAllowed).toBe(false);
  });

  it('rejects a dirty or different source checkout', async () => {
    const fixture = await createFixture();

    await expect(
      loadEvidenceCollectBootstrap(
        fixture.evaluationId,
        fixture.projectDirectory,
        { sourceCommit: 'different', gitStatus: '' },
      ),
    ).rejects.toThrow('clean source commit');
    await expect(
      loadEvidenceCollectBootstrap(
        fixture.evaluationId,
        fixture.projectDirectory,
        { sourceCommit: 'abc123', gitStatus: ' M src/index.ts' },
      ),
    ).rejects.toThrow('clean source commit');
  });

  it('rejects unsafe evaluation directory names', async () => {
    await expect(loadEvidenceCollectBootstrap('../outside')).rejects.toThrow(
      'evaluationId must be a safe directory name',
    );
  });

  it('rejects a manifest that enables any execution path', async () => {
    const fixture = await createFixture();
    await writeFile(
      join(fixture.evaluationDirectory, 'manifest.json'),
      `${JSON.stringify({
        ...fixture.manifest,
        transportDispatchAllowed: true,
      })}\n`,
      'utf8',
    );

    await expect(
      loadEvidenceCollectBootstrap(
        fixture.evaluationId,
        fixture.projectDirectory,
      ),
    ).rejects.toThrow(
      'Evaluation manifest is invalid or execution safety is not locked',
    );
  });
});
