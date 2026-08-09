import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createCurrentEvidenceEvaluationDefinition } from '../research/evidenceEvaluationDefinition';
import {
  createEvaluationSessionManifest,
  type EvaluationSessionManifest,
} from '../research/evaluationSessionManifest';

export interface InitializeEvidenceEvaluationOptions {
  readonly evaluationId: string;
  readonly projectDirectory?: string;
  readonly createdAt?: number;
  readonly sourceCommit?: string;
  readonly gitStatus?: string;
}

export interface InitializedEvidenceEvaluation {
  readonly evaluationDirectory: string;
  readonly manifest: EvaluationSessionManifest;
  readonly liveOrderExecutionAllowed: false;
}

const requireSafeEvaluationId = (evaluationId: string): string => {
  const normalized = evaluationId.trim();
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new Error('evaluationId must be a safe non-empty directory name');
  }
  return normalized;
};

export const initializeEvidenceEvaluation = (
  options: InitializeEvidenceEvaluationOptions,
): InitializedEvidenceEvaluation => {
  const projectDirectory = options.projectDirectory ?? process.cwd();
  const evaluationId = requireSafeEvaluationId(options.evaluationId);
  const gitStatus =
    options.gitStatus ??
    execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: projectDirectory,
      encoding: 'utf8',
    });
  if (gitStatus.trim().length > 0) {
    throw new Error(
      'Evidence collection requires a clean committed worktree so its source commit is reproducible',
    );
  }
  const sourceCommit =
    options.sourceCommit ??
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectDirectory,
      encoding: 'utf8',
    }).trim();
  const definition = createCurrentEvidenceEvaluationDefinition();
  const manifest = createEvaluationSessionManifest({
    evaluationId,
    sourceCommit,
    configuration: definition.configuration,
    instruments: definition.instruments,
    minimumCollectionDays: definition.minimumCollectionDays,
    minimumQualifiedAlerts: definition.minimumQualifiedAlerts,
    minimumInstruments: definition.minimumInstruments,
    horizonsMinutes: definition.horizonsMinutes,
    createdAt: options.createdAt ?? Date.now(),
  });
  const evaluationsDirectory = resolve(projectDirectory, 'data', 'evaluations');
  const evaluationDirectory = resolve(evaluationsDirectory, evaluationId);
  mkdirSync(evaluationsDirectory, { recursive: true });
  mkdirSync(evaluationDirectory);
  writeFileSync(
    resolve(evaluationDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx', flush: true },
  );
  writeFileSync(resolve(evaluationDirectory, 'qualified-alerts.ndjson'), '', {
    flag: 'wx',
    flush: true,
  });
  writeFileSync(resolve(evaluationDirectory, 'alpha-snapshots.ndjson'), '', {
    flag: 'wx',
    flush: true,
  });
  writeFileSync(resolve(evaluationDirectory, 'outcomes.ndjson'), '', {
    flag: 'wx',
    flush: true,
  });
  writeFileSync(
    resolve(evaluationDirectory, 'pending-observations.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        pending: [],
        liveOrderExecutionAllowed: false,
      },
      null,
      2,
    )}\n`,
    { flag: 'wx', flush: true },
  );

  return Object.freeze({
    evaluationDirectory,
    manifest,
    liveOrderExecutionAllowed: false,
  });
};

const main = (): void => {
  const evaluationId =
    process.argv[2]?.trim() ||
    `eval-${new Date().toISOString().slice(0, 10)}-v1`;
  const result = initializeEvidenceEvaluation({ evaluationId });
  console.log('Evidence evaluation initialized');
  console.log(`Evaluation ID: ${result.manifest.evaluationId}`);
  console.log(`Directory: ${result.evaluationDirectory}`);
  console.log(`Source commit: ${result.manifest.sourceCommit}`);
  console.log(
    `Configuration fingerprint: ${result.manifest.configurationFingerprint}`,
  );
  console.log('Live order execution remains disabled.');
};

if (require.main === module) {
  try {
    main();
  } catch (error: unknown) {
    console.error(
      `Evidence initialization failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
