import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';

export const RESEARCH_SESSION_MANIFEST_SCHEMA_VERSION = 1 as const;
export const RESEARCH_SESSION_MANIFEST_GENERATOR_VERSION =
  'research-session-manifest-v1' as const;

export type ResearchSessionStatus = 'PLANNED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface ResearchSessionArtifactReference {
  kind:
    | 'MARKET_RECORDING'
    | 'ALIGNMENT_EVALUATIONS'
    | 'TERMINAL_RETURNS'
    | 'PATH_OUTCOMES'
    | 'TARGET_STOP_OUTCOMES'
    | 'QUALITY_REPORT'
    | 'QUALITY_TREND'
    | 'THRESHOLD_EVALUATION'
    | 'TREND_AWARE_DECISION';
  path: string;
  runId?: string;
}

export interface ResearchSessionManifest {
  schemaVersion: typeof RESEARCH_SESSION_MANIFEST_SCHEMA_VERSION;
  generatorVersion: typeof RESEARCH_SESSION_MANIFEST_GENERATOR_VERSION;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  status: ResearchSessionStatus;
  instrumentIds: readonly string[];
  notes: string | null;
  artifacts: readonly ResearchSessionArtifactReference[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STATUSES = new Set<ResearchSessionStatus>(['PLANNED', 'RUNNING', 'COMPLETED', 'FAILED']);
const ARTIFACT_KINDS = new Set<ResearchSessionArtifactReference['kind']>([
  'MARKET_RECORDING',
  'ALIGNMENT_EVALUATIONS',
  'TERMINAL_RETURNS',
  'PATH_OUTCOMES',
  'TARGET_STOP_OUTCOMES',
  'QUALITY_REPORT',
  'QUALITY_TREND',
  'THRESHOLD_EVALUATION',
  'TREND_AWARE_DECISION',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertNonNegativeSafeInteger = (name: string, value: unknown): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const assertIdentifier = (name: string, value: unknown): void => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${name} must be a valid durable identifier`);
  }
};

const normalizeInstruments = (instrumentIds: readonly string[]): readonly string[] => {
  const values = [...new Set(instrumentIds.map((value) => value.trim()).filter(Boolean))].sort();
  if (values.length === 0) throw new Error('instrumentIds must contain at least one instrument');
  values.forEach((value, index) => assertIdentifier(`instrumentIds[${index}]`, value));
  return Object.freeze(values);
};

const normalizeArtifacts = (
  artifacts: readonly ResearchSessionArtifactReference[],
): readonly ResearchSessionArtifactReference[] => {
  const normalized = artifacts.map((artifact) => {
    if (!ARTIFACT_KINDS.has(artifact.kind)) throw new Error(`Unsupported artifact kind: ${artifact.kind}`);
    if (typeof artifact.path !== 'string' || artifact.path.trim() === '') {
      throw new Error('Artifact path must be a non-empty string');
    }
    if (artifact.runId !== undefined) assertIdentifier('artifact.runId', artifact.runId);
    return Object.freeze({
      kind: artifact.kind,
      path: artifact.path.trim(),
      ...(artifact.runId === undefined ? {} : { runId: artifact.runId }),
    });
  });
  return Object.freeze(
    normalized.sort((left, right) =>
      `${left.kind}:${left.path}:${left.runId ?? ''}`.localeCompare(
        `${right.kind}:${right.path}:${right.runId ?? ''}`,
      ),
    ),
  );
};

export const createResearchSessionManifest = (input: {
  sessionId: string;
  createdAt: number;
  updatedAt?: number;
  status?: ResearchSessionStatus;
  instrumentIds: readonly string[];
  notes?: string | null;
  artifacts?: readonly ResearchSessionArtifactReference[];
}): ResearchSessionManifest => {
  assertIdentifier('sessionId', input.sessionId);
  assertNonNegativeSafeInteger('createdAt', input.createdAt);
  const updatedAt = input.updatedAt ?? input.createdAt;
  assertNonNegativeSafeInteger('updatedAt', updatedAt);
  if (updatedAt < input.createdAt) throw new Error('updatedAt cannot be earlier than createdAt');
  const status = input.status ?? 'PLANNED';
  if (!STATUSES.has(status)) throw new Error(`Unsupported research session status: ${status}`);
  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') {
    throw new Error('notes must be a string or null');
  }

  return Object.freeze({
    schemaVersion: RESEARCH_SESSION_MANIFEST_SCHEMA_VERSION,
    generatorVersion: RESEARCH_SESSION_MANIFEST_GENERATOR_VERSION,
    sessionId: input.sessionId,
    createdAt: input.createdAt,
    updatedAt,
    status,
    instrumentIds: normalizeInstruments(input.instrumentIds),
    notes: input.notes?.trim() || null,
    artifacts: normalizeArtifacts(input.artifacts ?? []),
  });
};

export const validateResearchSessionManifest = (
  value: unknown,
): value is ResearchSessionManifest => {
  if (!isRecord(value)) throw new Error('Research session manifest must be an object');
  if (value.schemaVersion !== RESEARCH_SESSION_MANIFEST_SCHEMA_VERSION) {
    throw new Error('Unsupported research session manifest schema version');
  }
  if (value.generatorVersion !== RESEARCH_SESSION_MANIFEST_GENERATOR_VERSION) {
    throw new Error('Unsupported research session manifest generator version');
  }
  createResearchSessionManifest({
    sessionId: value.sessionId as string,
    createdAt: value.createdAt as number,
    updatedAt: value.updatedAt as number,
    status: value.status as ResearchSessionStatus,
    instrumentIds: value.instrumentIds as string[],
    notes: value.notes as string | null,
    artifacts: value.artifacts as ResearchSessionArtifactReference[],
  });
  return true;
};

export const serializeResearchSessionManifest = (manifest: ResearchSessionManifest): string => {
  validateResearchSessionManifest(manifest);
  return `${canonicalJsonStringify(manifest)}\n`;
};

export const writeResearchSessionManifest = async (
  filePath: string,
  manifest: ResearchSessionManifest,
): Promise<void> => {
  await writeFile(filePath, serializeResearchSessionManifest(manifest), 'utf8');
};

export const readResearchSessionManifestFromText = (text: string): ResearchSessionManifest => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Malformed research session manifest JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateResearchSessionManifest(parsed);
  return parsed as ResearchSessionManifest;
};

export const readResearchSessionManifest = async (
  filePath: string,
): Promise<ResearchSessionManifest> =>
  readResearchSessionManifestFromText(await readFile(filePath, 'utf8'));
