import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';

export const STRATEGY_CANDIDATE_REGISTRY_SCHEMA_VERSION = 1 as const;
export const STRATEGY_CANDIDATE_REGISTRY_GENERATOR_VERSION =
  'strategy-candidate-registry-v1' as const;

export type StrategyCandidateStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';

export interface StrategyCandidate {
  candidateId: string;
  label: string;
  status: StrategyCandidateStatus;
  createdAt: number;
  parameters: Readonly<Record<string, unknown>>;
  parameterFingerprint: string;
  notes: string | null;
}

export interface StrategyCandidateRegistry {
  schemaVersion: typeof STRATEGY_CANDIDATE_REGISTRY_SCHEMA_VERSION;
  generatorVersion: typeof STRATEGY_CANDIDATE_REGISTRY_GENERATOR_VERSION;
  registryId: string;
  generatedAt: number;
  candidates: readonly StrategyCandidate[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STATUSES = new Set<StrategyCandidateStatus>(['DRAFT', 'ACTIVE', 'RETIRED']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertIdentifier = (name: string, value: unknown): void => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${name} must be a valid durable identifier`);
  }
};

const assertTimestamp = (name: string, value: unknown): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

export const fingerprintStrategyParameters = (
  parameters: Readonly<Record<string, unknown>>,
): string => createHash('sha256').update(canonicalJsonStringify(parameters)).digest('hex');

export const createStrategyCandidate = (input: {
  candidateId: string;
  label: string;
  status?: StrategyCandidateStatus;
  createdAt: number;
  parameters: Readonly<Record<string, unknown>>;
  notes?: string | null;
}): StrategyCandidate => {
  assertIdentifier('candidateId', input.candidateId);
  assertTimestamp('createdAt', input.createdAt);
  if (typeof input.label !== 'string' || input.label.trim() === '') {
    throw new Error('label must be a non-empty string');
  }
  if (!isRecord(input.parameters)) throw new Error('parameters must be an object');
  const status = input.status ?? 'DRAFT';
  if (!STATUSES.has(status)) throw new Error(`Unsupported candidate status: ${status}`);

  return Object.freeze({
    candidateId: input.candidateId,
    label: input.label.trim(),
    status,
    createdAt: input.createdAt,
    parameters: Object.freeze({ ...input.parameters }),
    parameterFingerprint: fingerprintStrategyParameters(input.parameters),
    notes: input.notes?.trim() || null,
  });
};

export const createStrategyCandidateRegistry = (input: {
  registryId: string;
  generatedAt: number;
  candidates: readonly StrategyCandidate[];
}): StrategyCandidateRegistry => {
  assertIdentifier('registryId', input.registryId);
  assertTimestamp('generatedAt', input.generatedAt);
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new Error('candidates must contain at least one strategy candidate');
  }
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  const candidates = [...input.candidates].sort((left, right) =>
    left.candidateId.localeCompare(right.candidateId),
  );
  candidates.forEach((candidate) => {
    validateStrategyCandidate(candidate);
    if (ids.has(candidate.candidateId)) {
      throw new Error(`Duplicate candidate id: ${candidate.candidateId}`);
    }
    if (fingerprints.has(candidate.parameterFingerprint)) {
      throw new Error(`Duplicate candidate parameters: ${candidate.parameterFingerprint}`);
    }
    ids.add(candidate.candidateId);
    fingerprints.add(candidate.parameterFingerprint);
  });
  return Object.freeze({
    schemaVersion: STRATEGY_CANDIDATE_REGISTRY_SCHEMA_VERSION,
    generatorVersion: STRATEGY_CANDIDATE_REGISTRY_GENERATOR_VERSION,
    registryId: input.registryId,
    generatedAt: input.generatedAt,
    candidates: Object.freeze(candidates),
  });
};

export const validateStrategyCandidate = (value: unknown): value is StrategyCandidate => {
  if (!isRecord(value)) throw new Error('Strategy candidate must be an object');
  assertIdentifier('candidateId', value.candidateId);
  assertTimestamp('createdAt', value.createdAt);
  if (typeof value.label !== 'string' || value.label.trim() === '') {
    throw new Error('label must be a non-empty string');
  }
  if (!STATUSES.has(value.status as StrategyCandidateStatus)) {
    throw new Error('status is invalid');
  }
  if (!isRecord(value.parameters)) throw new Error('parameters must be an object');
  const expected = fingerprintStrategyParameters(value.parameters);
  if (value.parameterFingerprint !== expected) {
    throw new Error('parameterFingerprint does not match parameters');
  }
  if (value.notes !== null && typeof value.notes !== 'string') {
    throw new Error('notes must be a string or null');
  }
  return true;
};

export const validateStrategyCandidateRegistry = (
  value: unknown,
): value is StrategyCandidateRegistry => {
  if (!isRecord(value)) throw new Error('Strategy candidate registry must be an object');
  if (value.schemaVersion !== STRATEGY_CANDIDATE_REGISTRY_SCHEMA_VERSION) {
    throw new Error('Unsupported strategy candidate registry schema version');
  }
  if (value.generatorVersion !== STRATEGY_CANDIDATE_REGISTRY_GENERATOR_VERSION) {
    throw new Error('Unsupported strategy candidate registry generator version');
  }
  createStrategyCandidateRegistry({
    registryId: value.registryId as string,
    generatedAt: value.generatedAt as number,
    candidates: value.candidates as StrategyCandidate[],
  });
  return true;
};

export const serializeStrategyCandidateRegistry = (registry: StrategyCandidateRegistry): string => {
  validateStrategyCandidateRegistry(registry);
  return `${canonicalJsonStringify(registry)}\n`;
};

export const writeStrategyCandidateRegistry = async (
  filePath: string,
  registry: StrategyCandidateRegistry,
): Promise<void> => writeFile(filePath, serializeStrategyCandidateRegistry(registry), 'utf8');

export const readStrategyCandidateRegistryFromText = (text: string): StrategyCandidateRegistry => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Malformed strategy candidate registry JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  validateStrategyCandidateRegistry(parsed);
  return parsed as StrategyCandidateRegistry;
};

export const readStrategyCandidateRegistry = async (
  filePath: string,
): Promise<StrategyCandidateRegistry> =>
  readStrategyCandidateRegistryFromText(await readFile(filePath, 'utf8'));
