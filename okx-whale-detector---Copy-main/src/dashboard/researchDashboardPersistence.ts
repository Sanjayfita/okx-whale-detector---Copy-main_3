import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type {
  ResearchDashboardSnapshot,
  ResearchDashboardStatus,
} from './researchDashboard';

export const RESEARCH_DASHBOARD_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const RESEARCH_DASHBOARD_DOCUMENT_GENERATOR_VERSION =
  'research-dashboard-document-v1' as const;

export interface ResearchDashboardDocument {
  schemaVersion: typeof RESEARCH_DASHBOARD_DOCUMENT_SCHEMA_VERSION;
  generatorVersion: typeof RESEARCH_DASHBOARD_DOCUMENT_GENERATOR_VERSION;
  snapshot: ResearchDashboardSnapshot;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertNonNegativeSafeInteger = (name: string, value: unknown): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const assertStringArray = (
  name: string,
  value: unknown,
  requireSorted = true,
): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be an array of strings`);
  }
  if (requireSorted) {
    const sorted = [...value].sort((left, right) => left.localeCompare(right));
    if (value.some((item, index) => item !== sorted[index])) {
      throw new Error(`${name} must be sorted`);
    }
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${name} must not contain duplicates`);
  }
  return Object.freeze([...value]);
};

const isDashboardStatus = (value: unknown): value is ResearchDashboardStatus =>
  value === 'READY' || value === 'WARNING' || value === 'BLOCKED';

const isRuntimeStatus = (value: unknown): value is 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' =>
  value === 'HEALTHY' || value === 'DEGRADED' || value === 'UNHEALTHY';

const validateSnapshot = (value: unknown): ResearchDashboardSnapshot => {
  if (!isRecord(value)) throw new Error('Research dashboard snapshot must be an object');
  assertNonNegativeSafeInteger('snapshot.generatedAt', value.generatedAt);
  if (!isDashboardStatus(value.status)) throw new Error('snapshot.status is invalid');
  if (!isRuntimeStatus(value.runtimeStatus)) throw new Error('snapshot.runtimeStatus is invalid');
  if (!isRecord(value.counts)) throw new Error('snapshot.counts must be an object');

  const countKeys = [
    'recordings',
    'validRecordings',
    'researchSessions',
    'completedResearchSessions',
    'strategyCandidates',
    'evaluatedStrategyCandidates',
  ] as const;
  for (const key of countKeys) {
    assertNonNegativeSafeInteger(`snapshot.counts.${key}`, value.counts[key]);
  }

  const invalidRecordingPaths = assertStringArray(
    'snapshot.invalidRecordingPaths',
    value.invalidRecordingPaths,
  );
  const incompleteResearchSessionIds = assertStringArray(
    'snapshot.incompleteResearchSessionIds',
    value.incompleteResearchSessionIds,
  );
  const unevaluatedStrategyCandidateIds = assertStringArray(
    'snapshot.unevaluatedStrategyCandidateIds',
    value.unevaluatedStrategyCandidateIds,
  );
  const reasons = assertStringArray('snapshot.reasons', value.reasons, false);

  const recordings = value.counts.recordings as number;
  const validRecordings = value.counts.validRecordings as number;
  const researchSessions = value.counts.researchSessions as number;
  const completedResearchSessions = value.counts.completedResearchSessions as number;
  const strategyCandidates = value.counts.strategyCandidates as number;
  const evaluatedStrategyCandidates = value.counts.evaluatedStrategyCandidates as number;

  if (validRecordings > recordings || recordings - validRecordings !== invalidRecordingPaths.length) {
    throw new Error('Recording counts are inconsistent');
  }
  if (
    completedResearchSessions > researchSessions ||
    researchSessions - completedResearchSessions !== incompleteResearchSessionIds.length
  ) {
    throw new Error('Research-session counts are inconsistent');
  }
  if (
    evaluatedStrategyCandidates > strategyCandidates ||
    strategyCandidates - evaluatedStrategyCandidates !== unevaluatedStrategyCandidateIds.length
  ) {
    throw new Error('Strategy-candidate counts are inconsistent');
  }

  const expectedStatus: ResearchDashboardStatus =
    value.runtimeStatus === 'UNHEALTHY' || invalidRecordingPaths.length > 0
      ? 'BLOCKED'
      : reasons.length > 0
        ? 'WARNING'
        : 'READY';
  if (value.status !== expectedStatus) throw new Error('snapshot.status is inconsistent');

  return Object.freeze({
    generatedAt: value.generatedAt as number,
    status: value.status,
    runtimeStatus: value.runtimeStatus,
    counts: Object.freeze({
      recordings,
      validRecordings,
      researchSessions,
      completedResearchSessions,
      strategyCandidates,
      evaluatedStrategyCandidates,
    }),
    invalidRecordingPaths,
    incompleteResearchSessionIds,
    unevaluatedStrategyCandidateIds,
    reasons,
  });
};

export const createResearchDashboardDocument = (
  snapshot: ResearchDashboardSnapshot,
): ResearchDashboardDocument =>
  Object.freeze({
    schemaVersion: RESEARCH_DASHBOARD_DOCUMENT_SCHEMA_VERSION,
    generatorVersion: RESEARCH_DASHBOARD_DOCUMENT_GENERATOR_VERSION,
    snapshot: validateSnapshot(snapshot),
  });

export const validateResearchDashboardDocument = (
  value: unknown,
): value is ResearchDashboardDocument => {
  if (!isRecord(value)) throw new Error('Research dashboard document must be an object');
  if (value.schemaVersion !== RESEARCH_DASHBOARD_DOCUMENT_SCHEMA_VERSION) {
    throw new Error('Unsupported research dashboard document schema version');
  }
  if (value.generatorVersion !== RESEARCH_DASHBOARD_DOCUMENT_GENERATOR_VERSION) {
    throw new Error('Unsupported research dashboard document generator version');
  }
  validateSnapshot(value.snapshot);
  return true;
};

export const serializeResearchDashboardDocument = (
  document: ResearchDashboardDocument,
): string => {
  validateResearchDashboardDocument(document);
  return `${canonicalJsonStringify(document)}\n`;
};

export const readResearchDashboardDocumentFromText = (
  text: string,
): ResearchDashboardDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Malformed research dashboard document JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  validateResearchDashboardDocument(parsed);
  return parsed as ResearchDashboardDocument;
};

export const writeResearchDashboardDocument = async (
  filePath: string,
  document: ResearchDashboardDocument,
): Promise<void> => {
  await writeFile(filePath, serializeResearchDashboardDocument(document), 'utf8');
};

export const readResearchDashboardDocument = async (
  filePath: string,
): Promise<ResearchDashboardDocument> =>
  readResearchDashboardDocumentFromText(await readFile(filePath, 'utf8'));
