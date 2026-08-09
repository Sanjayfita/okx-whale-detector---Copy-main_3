import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import { parseAlertOutcomeObservation } from './alertOutcomeObservation';
import {
  evaluateEvidenceDatasetQuality,
  type EvidenceDatasetQualityMetrics,
} from './evidenceDatasetQuality';
import { measureEvidenceIndependence } from './evidenceIndependence';
import { readEvidenceNdjsonFile } from './evidenceNdjson';
import {
  parseEvaluationSessionManifest,
  type EvaluationSessionManifest,
} from './evaluationSessionManifest';
import { createAlphaResearchConfig } from './alphaResearchConfig';
import { createAlphaResearchConfigurationFingerprint } from './alphaResearchFingerprint';
import { parseAlphaResearchEventSnapshot } from './alphaSnapshotParser';
import {
  createEvidenceSourceFingerprint,
  type EvidenceSourceFingerprint,
} from './evidenceSourceFingerprint';
import {
  parsePendingOutcomeJob,
  type PendingOutcomeJob,
} from './persistentOutcomeScheduler';
import { parseQualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

export interface EvidenceProgressReport extends EvidenceDatasetQualityMetrics {
  readonly evaluationId: string;
  readonly collectionStartedAt: number;
  readonly collectionDays: number;
  readonly evidenceSpanDays: number;
  readonly firstAlertDetectedAt: number | null;
  readonly lastAlertDetectedAt: number | null;
  readonly lastOutcomeObservedAt: number | null;
  readonly minimumCollectionDays: number;
  readonly minimumQualifiedAlerts: number;
  readonly maximumOutcomeHorizonMinutes: number;
  readonly independentAlertCount: number;
  readonly dependentAlertCount: number;
  readonly durationRequirementMet: boolean;
  readonly alertRequirementMet: boolean;
  readonly evaluationLeaseActive: boolean;
  readonly readyForFinalEvaluation: boolean;
  readonly evidenceSource: EvidenceSourceFingerprint;
  readonly liveOrderExecutionAllowed: false;
}

export interface EvidenceProgressInspectorOptions {
  readonly maximumObservationDelayMs?: number;
}

interface OptionalNdjsonRead<T> {
  readonly records: readonly T[];
  readonly malformed: number;
  readonly missing: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readOptionalNdjson = async <T>(
  filePath: string,
  parser: (value: unknown) => T | undefined,
): Promise<OptionalNdjsonRead<T>> => {
  try {
    const result = await readEvidenceNdjsonFile(filePath, parser);
    return Object.freeze({
      records: result.records,
      malformed: result.malformed,
      missing: false,
    });
  } catch (error: unknown) {
    if (!isErrorWithCode(error, 'ENOENT')) throw error;
    return Object.freeze({
      records: Object.freeze([]),
      malformed: 0,
      missing: true,
    });
  }
};

const readManifest = async (
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

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch (error: unknown) {
    if (isErrorWithCode(error, 'ENOENT')) return false;
    throw error;
  }
};

const readPendingJobs = async (
  evaluationDirectory: string,
): Promise<
  Readonly<{
    jobs: readonly PendingOutcomeJob[];
    malformed: number;
    missing: boolean;
  }>
> => {
  let text: string;
  try {
    text = await readFile(
      join(evaluationDirectory, 'pending-observations.json'),
      'utf8',
    );
  } catch (error: unknown) {
    if (!isErrorWithCode(error, 'ENOENT')) throw error;
    return Object.freeze({
      jobs: Object.freeze([]),
      malformed: 0,
      missing: true,
    });
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) &&
          parsed.schemaVersion === 1 &&
          parsed.liveOrderExecutionAllowed === false &&
          Array.isArray(parsed.pending)
        ? parsed.pending
        : undefined;
    if (values === undefined) {
      return Object.freeze({
        jobs: Object.freeze([]),
        malformed: 1,
        missing: false,
      });
    }
    const jobs: PendingOutcomeJob[] = [];
    let malformed = 0;
    for (const value of values) {
      const job = parsePendingOutcomeJob(value);
      if (job === undefined) malformed += 1;
      else jobs.push(job);
    }
    return Object.freeze({
      jobs: Object.freeze(jobs),
      malformed,
      missing: false,
    });
  } catch {
    return Object.freeze({
      jobs: Object.freeze([]),
      malformed: 1,
      missing: false,
    });
  }
};

export const inspectEvidenceProgress = async (
  evaluationDirectory: string,
  now: number = Date.now(),
  options: EvidenceProgressInspectorOptions = {},
): Promise<EvidenceProgressReport> => {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('now must be a non-negative safe integer');
  }
  const maximumObservationDelayMs = options.maximumObservationDelayMs ?? 10_000;
  if (
    !Number.isSafeInteger(maximumObservationDelayMs) ||
    maximumObservationDelayMs < 0
  ) {
    throw new Error(
      'maximumObservationDelayMs must be a non-negative safe integer',
    );
  }

  const manifest = await readManifest(evaluationDirectory);
  const alphaConfig = createAlphaResearchConfig();
  const [
    alerts,
    snapshots,
    outcomes,
    pending,
    evidenceSource,
    evaluationLeaseActive,
  ] = await Promise.all([
    readOptionalNdjson(
      join(evaluationDirectory, 'qualified-alerts.ndjson'),
      parseQualifiedAlertEvidenceRecord,
    ),
    readOptionalNdjson(
      join(evaluationDirectory, 'alpha-snapshots.ndjson'),
      parseAlphaResearchEventSnapshot,
    ),
    readOptionalNdjson(
      join(evaluationDirectory, 'outcomes.ndjson'),
      parseAlertOutcomeObservation,
    ),
    readPendingJobs(evaluationDirectory),
    createEvidenceSourceFingerprint(evaluationDirectory),
    pathExists(join(evaluationDirectory, 'evaluation.lock')),
  ]);

  const configuredAlphaFingerprint =
    manifest.configuration.alphaResearchConfigurationFingerprint;
  const alphaFingerprintMismatch =
    configuredAlphaFingerprint !== undefined &&
    configuredAlphaFingerprint !==
      createAlphaResearchConfigurationFingerprint(alphaConfig);
  const missingSourceCount = [
    alerts.missing,
    snapshots.missing,
    outcomes.missing,
    pending.missing,
  ].filter(Boolean).length;
  const quality = evaluateEvidenceDatasetQuality({
    manifest,
    alerts: alerts.records,
    outcomes: outcomes.records,
    snapshots: snapshots.records,
    pendingJobs: pending.jobs,
    parserMalformedRecords:
      alerts.malformed +
      snapshots.malformed +
      outcomes.malformed +
      missingSourceCount +
      (alphaFingerprintMismatch ? 1 : 0),
    pendingMalformedRecords: pending.malformed,
    now,
    maximumObservationDelayMs,
    alphaConfig,
  });
  const independence = measureEvidenceIndependence(
    alerts.records,
    manifest.horizonsMinutes,
  );
  const collectionDays = Math.max(0, (now - manifest.createdAt) / 86_400_000);
  const firstAlertDetectedAt = alerts.records.reduce<number | null>(
    (earliest, alert) =>
      earliest === null
        ? alert.detectedAt
        : Math.min(earliest, alert.detectedAt),
    null,
  );
  const lastAlertDetectedAt = alerts.records.reduce<number | null>(
    (latest, alert) =>
      latest === null ? alert.detectedAt : Math.max(latest, alert.detectedAt),
    null,
  );
  const evidenceSpanDays =
    firstAlertDetectedAt === null || lastAlertDetectedAt === null
      ? 0
      : Math.floor(lastAlertDetectedAt / 86_400_000) -
        Math.floor(firstAlertDetectedAt / 86_400_000) +
        1;
  const durationRequirementMet =
    evidenceSpanDays >= manifest.minimumCollectionDays;
  const alertRequirementMet =
    independence.independentAlertCount >= manifest.minimumQualifiedAlerts;
  const readyForFinalEvaluation =
    durationRequirementMet &&
    alertRequirementMet &&
    quality.minimumInstrumentsMet &&
    quality.snapshotRequirementMet &&
    quality.outcomeRequirementMet &&
    quality.integrityValid &&
    !evaluationLeaseActive &&
    !evidenceSource.files.some((file) => file.missing);

  return Object.freeze({
    ...quality,
    evaluationId: manifest.evaluationId,
    collectionStartedAt: manifest.createdAt,
    collectionDays,
    evidenceSpanDays,
    firstAlertDetectedAt,
    lastAlertDetectedAt,
    lastOutcomeObservedAt: outcomes.records.reduce<number | null>(
      (latest, outcome) =>
        latest === null
          ? outcome.observedAt
          : Math.max(latest, outcome.observedAt),
      null,
    ),
    minimumCollectionDays: manifest.minimumCollectionDays,
    minimumQualifiedAlerts: manifest.minimumQualifiedAlerts,
    maximumOutcomeHorizonMinutes:
      independence.maximumOutcomeHorizonMinutes,
    independentAlertCount: independence.independentAlertCount,
    dependentAlertCount: independence.dependentAlertCount,
    durationRequirementMet,
    alertRequirementMet,
    evaluationLeaseActive,
    readyForFinalEvaluation,
    evidenceSource,
    liveOrderExecutionAllowed: false,
  });
};
