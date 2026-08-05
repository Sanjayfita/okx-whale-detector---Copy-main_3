import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import { analyzeAlphaResearchDataset } from './alphaResearchAnalysis';
import { createAlphaResearchConfig } from './alphaResearchConfig';
import { parseAlphaResearchDataset } from './alphaResearchDataset';
import { loadAlphaResearchDataset } from './alphaResearchDatasetLoader';
import {
  createAlphaResearchConfigurationFingerprint,
  createAlphaResearchDatasetFingerprint,
} from './alphaResearchFingerprint';
import type { AlphaResearchReport } from './alphaAnalysisTypes';
import type { AlphaResearchDataset } from './alphaFeatureTypes';
import { EvidenceEvaluationLease } from './evidenceEvaluationLease';
import {
  createEvidenceSourceFingerprint,
  createFileSha256,
  EVIDENCE_SOURCE_FILE_NAMES,
  type EvidenceSourceFingerprint,
} from './evidenceSourceFingerprint';
import {
  parseEvaluationSessionManifest,
  type EvaluationSessionManifest,
} from './evaluationSessionManifest';
import {
  inspectEvidenceProgress,
  type EvidenceProgressReport,
} from './evidenceProgressInspector';

export const EVIDENCE_DATASET_RELEASE_SCHEMA_VERSION = 1 as const;

export interface EvidenceDatasetReleaseManifest {
  readonly schemaVersion: typeof EVIDENCE_DATASET_RELEASE_SCHEMA_VERSION;
  readonly releaseId: string;
  readonly evaluationId: string;
  readonly createdAt: number;
  readonly sourceCommit: string;
  readonly evaluationConfigurationFingerprint: string;
  readonly evidenceSource: EvidenceSourceFingerprint;
  readonly datasetFingerprint: string;
  readonly releaseFingerprint: string;
  readonly datasetFile: 'alpha-dataset.json';
  readonly datasetFileSha256: string;
  readonly researchReportFile: 'alpha-research-report.json';
  readonly researchReportFileSha256: string;
  readonly researchStatus: AlphaResearchReport['status'];
  readonly totalRows: number;
  readonly productionFeaturesEnabled: readonly [];
  readonly quality: EvidenceProgressReport;
  readonly immutable: true;
  readonly liveOrderExecutionAllowed: false;
}

export interface EvidenceDatasetRelease {
  readonly directory: string;
  readonly manifest: EvidenceDatasetReleaseManifest;
  readonly dataset: AlphaResearchDataset;
  readonly report: AlphaResearchReport;
  readonly liveOrderExecutionAllowed: false;
}

export interface EvidenceDatasetReleaseVerification {
  readonly directory: string;
  readonly valid: boolean;
  readonly releaseFingerprint: string | null;
  readonly datasetFingerprint: string | null;
  readonly reasons: readonly string[];
  readonly liveOrderExecutionAllowed: false;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

const isResearchStatus = (
  value: unknown,
): value is AlphaResearchReport['status'] =>
  value === 'COMPLETE' ||
  value === 'INSUFFICIENT_DATA' ||
  value === 'INCOMPLETE_DATA' ||
  value === 'NO_EMPIRICAL_DATA';

const isReleaseManifest = (
  value: unknown,
): value is EvidenceDatasetReleaseManifest =>
  isRecord(value) &&
  value.schemaVersion === EVIDENCE_DATASET_RELEASE_SCHEMA_VERSION &&
  typeof value.releaseId === 'string' &&
  typeof value.evaluationId === 'string' &&
  typeof value.createdAt === 'number' &&
  Number.isSafeInteger(value.createdAt) &&
  value.createdAt >= 0 &&
  typeof value.sourceCommit === 'string' &&
  isSha256(value.evaluationConfigurationFingerprint) &&
  isRecord(value.evidenceSource) &&
  value.evidenceSource.algorithm === 'sha256' &&
  value.evidenceSource.fingerprintVersion === 'evidence-source-v1' &&
  isSha256(value.evidenceSource.fingerprint) &&
  Array.isArray(value.evidenceSource.files) &&
  isSha256(value.datasetFingerprint) &&
  isSha256(value.releaseFingerprint) &&
  value.datasetFile === 'alpha-dataset.json' &&
  isSha256(value.datasetFileSha256) &&
  value.researchReportFile === 'alpha-research-report.json' &&
  isSha256(value.researchReportFileSha256) &&
  isResearchStatus(value.researchStatus) &&
  typeof value.totalRows === 'number' &&
  Number.isSafeInteger(value.totalRows) &&
  value.totalRows >= 0 &&
  Array.isArray(value.productionFeaturesEnabled) &&
  value.productionFeaturesEnabled.length === 0 &&
  isRecord(value.quality) &&
  value.immutable === true &&
  value.liveOrderExecutionAllowed === false;

const readEvaluationManifest = async (
  evaluationDirectory: string,
): Promise<EvaluationSessionManifest> => {
  const parsed = JSON.parse(
    await readFile(join(evaluationDirectory, 'manifest.json'), 'utf8'),
  ) as unknown;
  const manifest = parseEvaluationSessionManifest(parsed);
  if (manifest === undefined) {
    throw new Error('Evaluation manifest is invalid or has been modified');
  }
  return manifest;
};

const targetExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch (error: unknown) {
    if (isErrorWithCode(error, 'ENOENT')) return false;
    throw error;
  }
};

const copyFrozenEvidenceSources = async (
  sourceDirectory: string,
  destinationDirectory: string,
): Promise<void> => {
  for (const name of EVIDENCE_SOURCE_FILE_NAMES) {
    const destinationPath = join(destinationDirectory, name);
    await copyFile(
      join(sourceDirectory, name),
      destinationPath,
      constants.COPYFILE_EXCL,
    );
    // Windows FlushFileBuffers requires a write-capable handle. `r+` preserves
    // the copied bytes while making the durability sync portable.
    const file = await open(destinationPath, 'r+');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  }
};

const createReleaseFingerprint = (input: {
  readonly evaluationId: string;
  readonly sourceCommit: string;
  readonly configurationFingerprint: string;
  readonly evidenceSourceFingerprint: string;
  readonly datasetFingerprint: string;
  readonly datasetFileSha256: string;
  readonly researchReportFileSha256: string;
  readonly researchStatus: AlphaResearchReport['status'];
  readonly totalRows: number;
}): string =>
  createHash('sha256')
    .update(
      canonicalJsonStringify({
        fingerprintVersion: 'evidence-release-v1',
        ...input,
      }),
      'utf8',
    )
    .digest('hex');

const verifyEvidenceDatasetReleaseStrict = async (
  releaseDirectory: string,
): Promise<EvidenceDatasetReleaseVerification> => {
  const reasons: string[] = [];
  const manifestValue = JSON.parse(
    await readFile(join(releaseDirectory, 'release-manifest.json'), 'utf8'),
  ) as unknown;
  if (!isReleaseManifest(manifestValue)) {
    throw new Error('Release manifest is invalid');
  }
  const manifest = manifestValue;
  const sourceManifest = await readEvaluationManifest(releaseDirectory);
  const [evidenceSource, datasetFileSha256, researchReportFileSha256] =
    await Promise.all([
      createEvidenceSourceFingerprint(releaseDirectory),
      createFileSha256(join(releaseDirectory, manifest.datasetFile)),
      createFileSha256(join(releaseDirectory, manifest.researchReportFile)),
    ]);
  if (
    canonicalJsonStringify(evidenceSource) !==
    canonicalJsonStringify(manifest.evidenceSource)
  ) {
    reasons.push('Frozen evidence source fingerprint does not match');
  }
  if (datasetFileSha256 !== manifest.datasetFileSha256) {
    reasons.push('Materialized dataset hash does not match');
  }
  if (researchReportFileSha256 !== manifest.researchReportFileSha256) {
    reasons.push('Research report hash does not match');
  }

  const datasetValue = JSON.parse(
    await readFile(join(releaseDirectory, manifest.datasetFile), 'utf8'),
  ) as unknown;
  const dataset = parseAlphaResearchDataset(datasetValue);
  if (dataset === undefined) {
    reasons.push('Materialized alpha dataset is invalid');
  }
  const reportValue = JSON.parse(
    await readFile(join(releaseDirectory, manifest.researchReportFile), 'utf8'),
  ) as unknown;
  if (
    !isRecord(reportValue) ||
    reportValue.schemaVersion !== 2 ||
    reportValue.evaluationId !== manifest.evaluationId ||
    reportValue.liveOrderExecutionAllowed !== false ||
    !Array.isArray(reportValue.productionFeaturesEnabled) ||
    reportValue.productionFeaturesEnabled.length > 0 ||
    !isResearchStatus(reportValue.status) ||
    !isSha256(reportValue.configurationFingerprint) ||
    !isSha256(reportValue.datasetFingerprint) ||
    typeof reportValue.totalRows !== 'number'
  ) {
    reasons.push('Alpha research report envelope is invalid');
  }

  const datasetFingerprint =
    dataset === undefined
      ? null
      : createAlphaResearchDatasetFingerprint(dataset);
  if (
    datasetFingerprint !== null &&
    datasetFingerprint !== manifest.datasetFingerprint
  ) {
    reasons.push('Materialized dataset fingerprint does not match');
  }
  if (
    sourceManifest.evaluationId !== manifest.evaluationId ||
    sourceManifest.sourceCommit !== manifest.sourceCommit ||
    sourceManifest.configurationFingerprint !==
      manifest.evaluationConfigurationFingerprint
  ) {
    reasons.push('Frozen evaluation identity does not match release metadata');
  }

  const progress = await inspectEvidenceProgress(
    releaseDirectory,
    manifest.createdAt,
  );
  if (
    canonicalJsonStringify(progress) !==
    canonicalJsonStringify(manifest.quality)
  ) {
    reasons.push('Recomputed evidence quality does not match release metadata');
  }

  const reportStatus =
    isRecord(reportValue) && isResearchStatus(reportValue.status)
      ? reportValue.status
      : manifest.researchStatus;
  const totalRows = dataset?.rows.length ?? manifest.totalRows;
  const computedReleaseFingerprint =
    datasetFingerprint === null
      ? null
      : createReleaseFingerprint({
          evaluationId: sourceManifest.evaluationId,
          sourceCommit: sourceManifest.sourceCommit,
          configurationFingerprint: sourceManifest.configurationFingerprint,
          evidenceSourceFingerprint: evidenceSource.fingerprint,
          datasetFingerprint,
          datasetFileSha256,
          researchReportFileSha256,
          researchStatus: reportStatus,
          totalRows,
        });
  if (
    computedReleaseFingerprint === null ||
    computedReleaseFingerprint !== manifest.releaseFingerprint ||
    basename(releaseDirectory) !== manifest.releaseFingerprint ||
    manifest.releaseId !==
      `${manifest.evaluationId}:${manifest.releaseFingerprint}` ||
    manifest.researchStatus !== reportStatus ||
    manifest.totalRows !== totalRows
  ) {
    reasons.push('Content-addressed release identity does not match');
  }
  if (
    isRecord(reportValue) &&
    (reportValue.datasetFingerprint !== manifest.datasetFingerprint ||
      reportValue.configurationFingerprint !==
        createAlphaResearchConfigurationFingerprint(
          createAlphaResearchConfig(),
        ))
  ) {
    reasons.push('Research report assumptions do not match frozen inputs');
  }

  return Object.freeze({
    directory: releaseDirectory,
    valid: reasons.length === 0,
    releaseFingerprint: manifest.releaseFingerprint,
    datasetFingerprint,
    reasons: Object.freeze(reasons),
    liveOrderExecutionAllowed: false,
  });
};

export const verifyEvidenceDatasetRelease = async (
  releaseDirectory: string,
): Promise<EvidenceDatasetReleaseVerification> => {
  try {
    return await verifyEvidenceDatasetReleaseStrict(releaseDirectory);
  } catch (error: unknown) {
    return Object.freeze({
      directory: releaseDirectory,
      valid: false,
      releaseFingerprint: null,
      datasetFingerprint: null,
      reasons: Object.freeze([
        error instanceof Error ? error.message : String(error),
      ]),
      liveOrderExecutionAllowed: false,
    });
  }
};

export const createEvidenceDatasetRelease = async (input: {
  readonly evaluationId: string;
  readonly evaluationDirectory?: string;
  readonly createdAt?: number;
  readonly projectDirectory?: string;
  readonly sourceCommit?: string;
  readonly gitStatus?: string;
}): Promise<EvidenceDatasetRelease> => {
  const evaluationId = input.evaluationId.trim();
  if (
    evaluationId.length === 0 ||
    evaluationId === '.' ||
    evaluationId === '..' ||
    evaluationId.includes('/') ||
    evaluationId.includes('\\')
  ) {
    throw new Error('evaluationId must be a safe non-empty directory name');
  }
  const createdAt = input.createdAt ?? Date.now();
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new Error('createdAt must be a non-negative safe integer');
  }
  const evaluationDirectory =
    input.evaluationDirectory ?? resolve('data', 'evaluations', evaluationId);
  const manifest = await readEvaluationManifest(evaluationDirectory);
  if (manifest.evaluationId !== evaluationId) {
    throw new Error('Evaluation directory does not match evaluationId');
  }
  const projectDirectory = input.projectDirectory ?? process.cwd();
  const sourceCommit =
    input.sourceCommit ??
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectDirectory,
      encoding: 'utf8',
    }).trim();
  const gitStatus =
    input.gitStatus ??
    execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: projectDirectory,
      encoding: 'utf8',
    });
  if (sourceCommit !== manifest.sourceCommit || gitStatus.trim().length > 0) {
    throw new Error(
      'Evidence finalization requires the clean source commit frozen in the evaluation',
    );
  }

  const evaluationLease = new EvidenceEvaluationLease({
    evaluationDirectory,
    evaluationId,
    sourceCommit: manifest.sourceCommit,
    configurationFingerprint: manifest.configurationFingerprint,
    purpose: 'FINALIZATION',
  });
  await evaluationLease.acquire();
  try {
    const releasesDirectory = join(evaluationDirectory, 'datasets');
    await mkdir(releasesDirectory, { recursive: true });
    const stagingDirectory = await mkdtemp(
      join(releasesDirectory, '.staging-'),
    );
    try {
      const sourceBefore =
        await createEvidenceSourceFingerprint(evaluationDirectory);
      if (sourceBefore.files.some((file) => file.missing)) {
        throw new Error('Evidence release requires every source file');
      }
      await copyFrozenEvidenceSources(evaluationDirectory, stagingDirectory);
      const [sourceAfter, frozenSource] = await Promise.all([
        createEvidenceSourceFingerprint(evaluationDirectory),
        createEvidenceSourceFingerprint(stagingDirectory),
      ]);
      if (
        sourceBefore.fingerprint !== sourceAfter.fingerprint ||
        sourceAfter.fingerprint !== frozenSource.fingerprint
      ) {
        throw new Error(
          'Evidence changed while it was being frozen; stop collection and retry',
        );
      }

      const progress = await inspectEvidenceProgress(
        stagingDirectory,
        createdAt,
      );
      if (!progress.readyForFinalEvaluation) {
        throw new Error(
          `Evidence is not ready for final evaluation: ${[
            ...progress.healthReasons,
            !progress.durationRequirementMet ? 'minimum duration not met' : '',
            !progress.alertRequirementMet ? 'minimum alert count not met' : '',
            !progress.minimumInstrumentsMet
              ? 'minimum instrument count not met'
              : '',
            !progress.snapshotRequirementMet
              ? 'snapshot coverage incomplete'
              : '',
            !progress.outcomeRequirementMet
              ? 'outcome coverage incomplete'
              : '',
          ]
            .filter((reason) => reason.length > 0)
            .join('; ')}`,
        );
      }

      const alphaConfig = createAlphaResearchConfig();
      const dataset = await loadAlphaResearchDataset({
        evaluationId,
        evaluationDirectory: stagingDirectory,
        config: alphaConfig,
      });
      if (dataset.synthetic) {
        throw new Error(
          'Synthetic evidence cannot create an empirical release',
        );
      }
      const datasetFingerprint = createAlphaResearchDatasetFingerprint(dataset);
      const report = analyzeAlphaResearchDataset({
        dataset,
        config: alphaConfig,
      });
      if (
        report.datasetFingerprint !== datasetFingerprint ||
        report.productionFeaturesEnabled.length > 0
      ) {
        throw new Error('Alpha research report violated release invariants');
      }

      const datasetFile = 'alpha-dataset.json' as const;
      const researchReportFile = 'alpha-research-report.json' as const;
      await writeFile(
        join(stagingDirectory, datasetFile),
        `${JSON.stringify(dataset, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', flush: true },
      );
      await writeFile(
        join(stagingDirectory, researchReportFile),
        `${JSON.stringify(report, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', flush: true },
      );
      const [datasetFileSha256, researchReportFileSha256] = await Promise.all([
        createFileSha256(join(stagingDirectory, datasetFile)),
        createFileSha256(join(stagingDirectory, researchReportFile)),
      ]);
      const releaseFingerprint = createReleaseFingerprint({
        evaluationId,
        sourceCommit: manifest.sourceCommit,
        configurationFingerprint: manifest.configurationFingerprint,
        evidenceSourceFingerprint: frozenSource.fingerprint,
        datasetFingerprint,
        datasetFileSha256,
        researchReportFileSha256,
        researchStatus: report.status,
        totalRows: dataset.rows.length,
      });
      const productionFeaturesEnabled: readonly [] = [];
      const releaseManifest: EvidenceDatasetReleaseManifest = Object.freeze({
        schemaVersion: EVIDENCE_DATASET_RELEASE_SCHEMA_VERSION,
        releaseId: `${evaluationId}:${releaseFingerprint}`,
        evaluationId,
        createdAt,
        sourceCommit: manifest.sourceCommit,
        evaluationConfigurationFingerprint: manifest.configurationFingerprint,
        evidenceSource: frozenSource,
        datasetFingerprint,
        releaseFingerprint,
        datasetFile,
        datasetFileSha256,
        researchReportFile,
        researchReportFileSha256,
        researchStatus: report.status,
        totalRows: dataset.rows.length,
        productionFeaturesEnabled,
        quality: progress,
        immutable: true,
        liveOrderExecutionAllowed: false,
      });
      await writeFile(
        join(stagingDirectory, 'release-manifest.json'),
        `${JSON.stringify(releaseManifest, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', flush: true },
      );

      const releaseDirectory = join(releasesDirectory, releaseFingerprint);
      if (await targetExists(releaseDirectory)) {
        throw new Error(
          `Immutable dataset release already exists: ${releaseFingerprint}`,
        );
      }
      await rename(stagingDirectory, releaseDirectory);
      return Object.freeze({
        directory: releaseDirectory,
        manifest: releaseManifest,
        dataset,
        report,
        liveOrderExecutionAllowed: false,
      });
    } catch (error: unknown) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw error;
    }
  } finally {
    await evaluationLease.release();
  }
};
