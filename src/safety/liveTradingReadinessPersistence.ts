import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type {
  LiveTradingReadinessAssessment,
  LiveTradingReadinessChecklist,
} from './liveTradingReadiness';
import { assessLiveTradingReadiness } from './liveTradingReadiness';

export const LIVE_TRADING_READINESS_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const LIVE_TRADING_READINESS_DOCUMENT_GENERATOR_VERSION =
  'live-trading-readiness-document-v1' as const;

export interface LiveTradingReadinessDocument {
  schemaVersion: typeof LIVE_TRADING_READINESS_DOCUMENT_SCHEMA_VERSION;
  generatorVersion: typeof LIVE_TRADING_READINESS_DOCUMENT_GENERATOR_VERSION;
  generatedAt: number;
  checklist: LiveTradingReadinessChecklist;
  assessment: LiveTradingReadinessAssessment;
}

const CHECKLIST_KEYS: readonly (keyof LiveTradingReadinessChecklist)[] = Object.freeze([
  'credentialsIsolated',
  'tradePermissionDisabledByDefault',
  'maximumOrderNotionalConfigured',
  'maximumDailyLossConfigured',
  'emergencyStopImplemented',
  'duplicateOrderProtectionImplemented',
  'exchangeReconciliationImplemented',
  'auditLoggingImplemented',
  'manualApprovalRequired',
  'testnetValidationCompleted',
  'independentSecurityReviewCompleted',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateGeneratedAt = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('generatedAt must be a non-negative safe integer');
  }
  return value as number;
};

const validateChecklist = (value: unknown): LiveTradingReadinessChecklist => {
  if (!isRecord(value)) throw new Error('checklist must be an object');

  const checklist = {} as Record<keyof LiveTradingReadinessChecklist, boolean>;
  for (const key of CHECKLIST_KEYS) {
    if (typeof value[key] !== 'boolean') {
      throw new Error(`checklist.${key} must be a boolean`);
    }
    checklist[key] = value[key] as boolean;
  }

  return Object.freeze(checklist) as LiveTradingReadinessChecklist;
};

const equalStringArrays = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const validateAssessment = (
  value: unknown,
  checklist: LiveTradingReadinessChecklist,
): LiveTradingReadinessAssessment => {
  if (!isRecord(value)) throw new Error('assessment must be an object');
  const expected = assessLiveTradingReadiness(checklist);

  if (value.status !== expected.status) throw new Error('assessment.status is inconsistent');
  if (value.completedChecks !== expected.completedChecks) {
    throw new Error('assessment.completedChecks is inconsistent');
  }
  if (value.totalChecks !== expected.totalChecks) {
    throw new Error('assessment.totalChecks is inconsistent');
  }
  if (value.orderExecutionAuthorized !== false) {
    throw new Error('assessment.orderExecutionAuthorized must remain false');
  }
  if (!Array.isArray(value.missingChecks) || value.missingChecks.some((item) => typeof item !== 'string')) {
    throw new Error('assessment.missingChecks must be an array of strings');
  }
  if (!Array.isArray(value.reasons) || value.reasons.some((item) => typeof item !== 'string')) {
    throw new Error('assessment.reasons must be an array of strings');
  }
  if (!equalStringArrays(value.missingChecks as string[], expected.missingChecks)) {
    throw new Error('assessment.missingChecks is inconsistent');
  }
  if (!equalStringArrays(value.reasons as string[], expected.reasons)) {
    throw new Error('assessment.reasons is inconsistent');
  }

  return expected;
};

export const createLiveTradingReadinessDocument = (input: {
  generatedAt: number;
  checklist: LiveTradingReadinessChecklist;
}): LiveTradingReadinessDocument => {
  const generatedAt = validateGeneratedAt(input.generatedAt);
  const checklist = validateChecklist(input.checklist);

  return Object.freeze({
    schemaVersion: LIVE_TRADING_READINESS_DOCUMENT_SCHEMA_VERSION,
    generatorVersion: LIVE_TRADING_READINESS_DOCUMENT_GENERATOR_VERSION,
    generatedAt,
    checklist,
    assessment: assessLiveTradingReadiness(checklist),
  });
};

export const validateLiveTradingReadinessDocument = (
  value: unknown,
): value is LiveTradingReadinessDocument => {
  if (!isRecord(value)) throw new Error('Live trading readiness document must be an object');
  if (value.schemaVersion !== LIVE_TRADING_READINESS_DOCUMENT_SCHEMA_VERSION) {
    throw new Error('Unsupported live trading readiness document schema version');
  }
  if (value.generatorVersion !== LIVE_TRADING_READINESS_DOCUMENT_GENERATOR_VERSION) {
    throw new Error('Unsupported live trading readiness document generator version');
  }

  validateGeneratedAt(value.generatedAt);
  const checklist = validateChecklist(value.checklist);
  validateAssessment(value.assessment, checklist);
  return true;
};

export const serializeLiveTradingReadinessDocument = (
  document: LiveTradingReadinessDocument,
): string => {
  validateLiveTradingReadinessDocument(document);
  return `${canonicalJsonStringify(document)}\n`;
};

export const readLiveTradingReadinessDocumentFromText = (
  text: string,
): LiveTradingReadinessDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `Malformed live trading readiness document JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }

  validateLiveTradingReadinessDocument(parsed);
  return parsed as LiveTradingReadinessDocument;
};

export const writeLiveTradingReadinessDocument = async (
  filePath: string,
  document: LiveTradingReadinessDocument,
): Promise<void> => {
  await writeFile(filePath, serializeLiveTradingReadinessDocument(document), 'utf8');
};

export const readLiveTradingReadinessDocument = async (
  filePath: string,
): Promise<LiveTradingReadinessDocument> =>
  readLiveTradingReadinessDocumentFromText(await readFile(filePath, 'utf8'));
