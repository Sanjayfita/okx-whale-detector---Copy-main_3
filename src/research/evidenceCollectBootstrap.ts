import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createConfigurationFingerprint,
  parseEvaluationSessionManifest,
  type EvaluationSessionManifest,
} from './evaluationSessionManifest';
import { createCurrentEvidenceEvaluationDefinition } from './evidenceEvaluationDefinition';
import { requireSafeEvidenceEvaluationId } from './evidenceEvaluationId';

export interface EvidenceCollectBootstrap {
  evaluationDirectory: string;
  manifest: EvaluationSessionManifest;
  liveOrderExecutionAllowed: false;
}

export interface EvidenceCollectBootstrapOptions {
  readonly sourceCommit?: string;
  readonly gitStatus?: string;
}

export const loadEvidenceCollectBootstrap = async (
  evaluationId: string,
  projectDirectory: string = process.cwd(),
  options: EvidenceCollectBootstrapOptions = {},
): Promise<EvidenceCollectBootstrap> => {
  const normalizedEvaluationId = requireSafeEvidenceEvaluationId(evaluationId);

  const evaluationDirectory = resolve(
    projectDirectory,
    'data',
    'evaluations',
    normalizedEvaluationId,
  );
  const parsed = JSON.parse(
    await readFile(resolve(evaluationDirectory, 'manifest.json'), 'utf8'),
  ) as unknown;
  const manifest = parseEvaluationSessionManifest(
    parsed,
    normalizedEvaluationId,
  );

  if (manifest === undefined) {
    throw new Error(
      'Evaluation manifest is invalid or execution safety is not locked',
    );
  }
  try {
    const releases = await readdir(resolve(evaluationDirectory, 'datasets'), {
      withFileTypes: true,
    });
    if (
      releases.some(
        (entry) => entry.isDirectory() && /^[a-f0-9]{64}$/u.test(entry.name),
      )
    ) {
      throw new Error('Finalized evidence evaluations are immutable');
    }
  } catch (error: unknown) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    )) {
      throw error;
    }
  }
  const currentDefinition = createCurrentEvidenceEvaluationDefinition();
  const currentConfigurationFingerprint = createConfigurationFingerprint(
    currentDefinition.configuration,
  );
  if (
    currentConfigurationFingerprint !== manifest.configurationFingerprint ||
    JSON.stringify(currentDefinition.instruments) !==
      JSON.stringify(manifest.instruments) ||
    JSON.stringify(currentDefinition.horizonsMinutes) !==
      JSON.stringify(manifest.horizonsMinutes) ||
    currentDefinition.minimumCollectionDays !==
      manifest.minimumCollectionDays ||
    currentDefinition.minimumQualifiedAlerts !==
      manifest.minimumQualifiedAlerts ||
    currentDefinition.minimumInstruments !== manifest.minimumInstruments
  ) {
    throw new Error(
      'Current evidence configuration does not match the frozen evaluation',
    );
  }
  const sourceCommit =
    options.sourceCommit ??
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectDirectory,
      encoding: 'utf8',
    }).trim();
  const gitStatus =
    options.gitStatus ??
    execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: projectDirectory,
      encoding: 'utf8',
    });
  if (sourceCommit !== manifest.sourceCommit || gitStatus.trim().length > 0) {
    throw new Error(
      'Evidence collection requires the clean source commit frozen in the evaluation',
    );
  }

  return Object.freeze({
    evaluationDirectory,
    manifest,
    liveOrderExecutionAllowed: false,
  });
};
