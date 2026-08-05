import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import {
  createUnifiedSafetyEvidenceBundle,
  type SafetyEvidenceItem,
  type UnifiedSafetyEvidenceBundle,
} from './unifiedSafetyEvidenceBundle';

export const UNIFIED_SAFETY_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const UNIFIED_SAFETY_EVIDENCE_GENERATOR_VERSION =
  'unified-safety-evidence-v1' as const;

export interface UnifiedSafetyEvidenceDocument {
  schemaVersion: typeof UNIFIED_SAFETY_EVIDENCE_SCHEMA_VERSION;
  generatorVersion: typeof UNIFIED_SAFETY_EVIDENCE_GENERATOR_VERSION;
  generatedAt: number;
  bundle: UnifiedSafetyEvidenceBundle;
}

const SOURCES: readonly SafetyEvidenceItem['source'][] = Object.freeze([
  'LIVE_TRADING_READINESS',
  'READINESS_TREND',
  'PAPER_TRADING_RISK',
  'RUNTIME_HEALTH',
  'RECORDING_INTEGRITY',
]);

const STATES: readonly SafetyEvidenceItem['state'][] = Object.freeze([
  'PASS',
  'REVIEW',
  'FAIL',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireSafeInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as number;
};

const requireStringArray = (value: unknown, name: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be an array of strings`);
  }
  return Object.freeze([...(value as string[])]);
};

const validateEvidenceItem = (value: unknown, index: number): SafetyEvidenceItem => {
  if (!isRecord(value)) {
    throw new Error(`bundle.evidence[${index}] must be an object`);
  }
  if (!SOURCES.includes(value.source as SafetyEvidenceItem['source'])) {
    throw new Error(`bundle.evidence[${index}].source is invalid`);
  }
  if (!STATES.includes(value.state as SafetyEvidenceItem['state'])) {
    throw new Error(`bundle.evidence[${index}].state is invalid`);
  }
  if (typeof value.summary !== 'string' || value.summary.trim() === '') {
    throw new Error(`bundle.evidence[${index}].summary must not be empty`);
  }

  return Object.freeze({
    source: value.source as SafetyEvidenceItem['source'],
    generatedAt: requireSafeInteger(
      value.generatedAt,
      `bundle.evidence[${index}].generatedAt`,
    ),
    state: value.state as SafetyEvidenceItem['state'],
    summary: value.summary,
    reasons: requireStringArray(value.reasons, `bundle.evidence[${index}].reasons`),
  });
};

const validateBundle = (value: unknown): UnifiedSafetyEvidenceBundle => {
  if (!isRecord(value)) throw new Error('bundle must be an object');
  if (!Array.isArray(value.evidence)) {
    throw new Error('bundle.evidence must be an array');
  }
  if (value.orderExecutionAuthorized !== false) {
    throw new Error('bundle.orderExecutionAuthorized must remain false');
  }

  const generatedAt = requireSafeInteger(value.generatedAt, 'bundle.generatedAt');
  const evidence = value.evidence.map(validateEvidenceItem);
  const expected = createUnifiedSafetyEvidenceBundle({ generatedAt, evidence });

  if (value.status !== expected.status) {
    throw new Error('bundle.status is inconsistent');
  }

  const fields = [
    'passedSources',
    'reviewSources',
    'failedSources',
    'missingSources',
    'reasons',
  ] as const;

  for (const field of fields) {
    const actual = requireStringArray(value[field], `bundle.${field}`);
    const expectedValues = expected[field];
    if (
      actual.length !== expectedValues.length ||
      actual.some((item, index) => item !== expectedValues[index])
    ) {
      throw new Error(`bundle.${field} is inconsistent`);
    }
  }

  return expected;
};

export const createUnifiedSafetyEvidenceDocument = (input: {
  generatedAt: number;
  bundle: UnifiedSafetyEvidenceBundle;
}): UnifiedSafetyEvidenceDocument => {
  const generatedAt = requireSafeInteger(input.generatedAt, 'generatedAt');
  const bundle = validateBundle(input.bundle);
  if (bundle.generatedAt > generatedAt) {
    throw new Error('bundle.generatedAt cannot be newer than document generatedAt');
  }

  return Object.freeze({
    schemaVersion: UNIFIED_SAFETY_EVIDENCE_SCHEMA_VERSION,
    generatorVersion: UNIFIED_SAFETY_EVIDENCE_GENERATOR_VERSION,
    generatedAt,
    bundle,
  });
};

export const validateUnifiedSafetyEvidenceDocument = (
  value: unknown,
): value is UnifiedSafetyEvidenceDocument => {
  if (!isRecord(value)) {
    throw new Error('Unified safety evidence document must be an object');
  }
  if (value.schemaVersion !== UNIFIED_SAFETY_EVIDENCE_SCHEMA_VERSION) {
    throw new Error('Unsupported unified safety evidence schema version');
  }
  if (value.generatorVersion !== UNIFIED_SAFETY_EVIDENCE_GENERATOR_VERSION) {
    throw new Error('Unsupported unified safety evidence generator version');
  }

  const generatedAt = requireSafeInteger(value.generatedAt, 'generatedAt');
  const bundle = validateBundle(value.bundle);
  if (bundle.generatedAt > generatedAt) {
    throw new Error('bundle.generatedAt cannot be newer than document generatedAt');
  }
  return true;
};

export const serializeUnifiedSafetyEvidenceDocument = (
  document: UnifiedSafetyEvidenceDocument,
): string => {
  validateUnifiedSafetyEvidenceDocument(document);
  return `${canonicalJsonStringify(document)}\n`;
};

export const readUnifiedSafetyEvidenceDocumentFromText = (
  text: string,
): UnifiedSafetyEvidenceDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `Malformed unified safety evidence JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  validateUnifiedSafetyEvidenceDocument(parsed);
  return parsed as UnifiedSafetyEvidenceDocument;
};

export const writeUnifiedSafetyEvidenceDocument = async (
  filePath: string,
  document: UnifiedSafetyEvidenceDocument,
): Promise<void> => {
  await writeFile(filePath, serializeUnifiedSafetyEvidenceDocument(document), 'utf8');
};

export const readUnifiedSafetyEvidenceDocument = async (
  filePath: string,
): Promise<UnifiedSafetyEvidenceDocument> =>
  readUnifiedSafetyEvidenceDocumentFromText(await readFile(filePath, 'utf8'));
