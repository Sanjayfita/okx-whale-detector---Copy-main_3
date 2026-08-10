import { access, readFile, readdir, stat } from 'node:fs/promises';
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
  readonly readinessStatus:
    'INSUFFICIENT_DATA' | 'COLLECTING' | 'RESEARCH_READY' | 'FINALIZED';
  readonly datasetSizeBytes: number;
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
  readonly invalidJson: number;
  readonly invalidRecord: number;
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
      invalidJson: result.invalidJson,
      invalidRecord: result.invalidRecord,
    });
  } catch (error: unknown) {
    if (!isErrorWithCode(error, 'ENOENT')) throw error;
    return Object.freeze({
      records: Object.freeze([]),
      malformed: 0,
      missing: true,
      invalidJson: 0,
      invalidRecord: 0,
    });
  }
};

interface OperationalIntegrityState {
  readonly pendingEventInitializations: number;
  readonly criticalFailures: number;
  readonly unhealthy: boolean;
  readonly malformed: number;
  readonly invalidJson: number;
  readonly schemaInvalid: number;
}

const readOperationalIntegrityState = async (
  evaluationDirectory: string,
): Promise<OperationalIntegrityState> => {
  let pendingEventInitializations = 0;
  let criticalFailures = 0;
  let unhealthy = false;
  let malformed = 0;
  let invalidJson = 0;
  let schemaInvalid = 0;
  try {
    const value = JSON.parse(
      await readFile(
        join(evaluationDirectory, 'event-initializations.json'),
        'utf8',
      ),
    ) as unknown;
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      value.liveOrderExecutionAllowed !== false ||
      !Array.isArray(value.pending)
    ) {
      malformed += 1;
      schemaInvalid += 1;
    } else {
      pendingEventInitializations = value.pending.length;
    }
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      malformed += 1;
      invalidJson += 1;
    } else if (isErrorWithCode(error, 'ENOENT')) {
      // Legacy evaluations predate the transaction journal.
    } else {
      throw error;
    }
  }
  try {
    const value = JSON.parse(
      await readFile(
        join(evaluationDirectory, 'collection-health.json'),
        'utf8',
      ),
    ) as unknown;
    if (
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      value.liveOrderExecutionAllowed !== false ||
      (value.status !== 'HEALTHY' && value.status !== 'UNHEALTHY')
    ) {
      malformed += 1;
      schemaInvalid += 1;
    } else {
      unhealthy = value.status === 'UNHEALTHY';
    }
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      malformed += 1;
      invalidJson += 1;
    } else if (isErrorWithCode(error, 'ENOENT')) {
      // Legacy evaluations predate the durable health marker.
    } else {
      throw error;
    }
  }
  const failures = await readOptionalNdjson(
    join(evaluationDirectory, 'evidence-failures.ndjson'),
    (value): Readonly<Record<string, unknown>> | undefined =>
      isRecord(value) &&
      value.schemaVersion === 1 &&
      value.liveOrderExecutionAllowed === false &&
      typeof value.category === 'string' &&
      typeof value.message === 'string'
        ? Object.freeze(value)
        : undefined,
  );
  criticalFailures = failures.records.length;
  malformed += failures.malformed;
  invalidJson += failures.invalidJson;
  schemaInvalid += failures.invalidRecord;
  return Object.freeze({
    pendingEventInitializations,
    criticalFailures,
    unhealthy,
    malformed,
    invalidJson,
    schemaInvalid,
  });
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

const fileSize = async (filePath: string): Promise<number> => {
  try {
    return (await stat(filePath)).size;
  } catch (error: unknown) {
    if (isErrorWithCode(error, 'ENOENT')) return 0;
    throw error;
  }
};

const hasFinalizedRelease = async (
  evaluationDirectory: string,
): Promise<boolean> => {
  try {
    const entries = await readdir(join(evaluationDirectory, 'datasets'), {
      withFileTypes: true,
    });
    return entries.some(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        /^[a-f0-9]{64}$/u.test(entry.name),
    );
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
    finalizedReleaseExists,
    sourceFileSizes,
    operationalIntegrity,
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
    hasFinalizedRelease(evaluationDirectory),
    Promise.all([
      fileSize(join(evaluationDirectory, 'manifest.json')),
      fileSize(join(evaluationDirectory, 'qualified-alerts.ndjson')),
      fileSize(join(evaluationDirectory, 'alpha-snapshots.ndjson')),
      fileSize(join(evaluationDirectory, 'outcomes.ndjson')),
      fileSize(join(evaluationDirectory, 'pending-observations.json')),
      fileSize(join(evaluationDirectory, 'event-initializations.json')),
      fileSize(join(evaluationDirectory, 'collection-health.json')),
      fileSize(join(evaluationDirectory, 'evidence-failures.ndjson')),
    ]),
    readOperationalIntegrityState(evaluationDirectory),
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
    pendingMalformedRecords: pending.malformed + operationalIntegrity.malformed,
    invalidJsonRecords:
      alerts.invalidJson +
      snapshots.invalidJson +
      outcomes.invalidJson +
      operationalIntegrity.invalidJson,
    schemaInvalidRecords:
      alerts.invalidRecord +
      snapshots.invalidRecord +
      outcomes.invalidRecord +
      pending.malformed +
      operationalIntegrity.schemaInvalid,
    pendingEventInitializationCount:
      operationalIntegrity.pendingEventInitializations,
    criticalFailureCount: operationalIntegrity.criticalFailures,
    collectionUnhealthy: operationalIntegrity.unhealthy,
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
  const readinessStatus: EvidenceProgressReport['readinessStatus'] =
    finalizedReleaseExists
      ? 'FINALIZED'
      : readyForFinalEvaluation
        ? 'RESEARCH_READY'
        : evaluationLeaseActive || quality.qualifiedAlertCount > 0
          ? 'COLLECTING'
          : 'INSUFFICIENT_DATA';

  return Object.freeze({
    ...quality,
    readinessStatus,
    datasetSizeBytes: sourceFileSizes.reduce((sum, size) => sum + size, 0),
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
    maximumOutcomeHorizonMinutes: independence.maximumOutcomeHorizonMinutes,
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
