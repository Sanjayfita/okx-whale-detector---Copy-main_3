import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type { RecordingIntegrityReport } from './recordingIntegrity';

export const RECORDING_INTEGRITY_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const RECORDING_INTEGRITY_DOCUMENT_GENERATOR_VERSION =
  'recording-integrity-document-v1' as const;

export interface RecordingIntegrityDocument {
  schemaVersion: typeof RECORDING_INTEGRITY_DOCUMENT_SCHEMA_VERSION;
  generatorVersion: typeof RECORDING_INTEGRITY_DOCUMENT_GENERATOR_VERSION;
  generatedAt: number;
  report: RecordingIntegrityReport;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertNonNegativeSafeInteger = (name: string, value: unknown): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const assertNullableTimestamp = (name: string, value: unknown): void => {
  if (value !== null) assertNonNegativeSafeInteger(name, value);
};

const validateReport = (value: unknown): RecordingIntegrityReport => {
  if (!isRecord(value)) throw new Error('Recording integrity report must be an object');
  if (typeof value.filePath !== 'string' || value.filePath.trim() === '') {
    throw new Error('report.filePath must be a non-empty string');
  }
  for (const key of [
    'byteLength',
    'lineCount',
    'nonEmptyLineCount',
    'malformedJsonLineCount',
    'nonMonotonicTimestampCount',
  ] as const) {
    assertNonNegativeSafeInteger(`report.${key}`, value[key]);
  }
  assertNullableTimestamp('report.firstTimestamp', value.firstTimestamp);
  assertNullableTimestamp('report.lastTimestamp', value.lastTimestamp);
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error('report.sha256 must be a lowercase SHA-256 digest');
  }
  if (typeof value.valid !== 'boolean') throw new Error('report.valid must be boolean');
  if ((value.nonEmptyLineCount as number) > (value.lineCount as number)) {
    throw new Error('report.nonEmptyLineCount cannot exceed report.lineCount');
  }
  return value as unknown as RecordingIntegrityReport;
};

export const createRecordingIntegrityDocument = (input: {
  generatedAt: number;
  report: RecordingIntegrityReport;
}): RecordingIntegrityDocument => {
  assertNonNegativeSafeInteger('generatedAt', input.generatedAt);
  const report = validateReport(input.report);
  return Object.freeze({
    schemaVersion: RECORDING_INTEGRITY_DOCUMENT_SCHEMA_VERSION,
    generatorVersion: RECORDING_INTEGRITY_DOCUMENT_GENERATOR_VERSION,
    generatedAt: input.generatedAt,
    report: Object.freeze({ ...report }),
  });
};

export const validateRecordingIntegrityDocument = (
  value: unknown,
): value is RecordingIntegrityDocument => {
  if (!isRecord(value)) throw new Error('Recording integrity document must be an object');
  if (value.schemaVersion !== RECORDING_INTEGRITY_DOCUMENT_SCHEMA_VERSION) {
    throw new Error('Unsupported recording integrity document schema version');
  }
  if (value.generatorVersion !== RECORDING_INTEGRITY_DOCUMENT_GENERATOR_VERSION) {
    throw new Error('Unsupported recording integrity document generator version');
  }
  createRecordingIntegrityDocument({
    generatedAt: value.generatedAt as number,
    report: value.report as RecordingIntegrityReport,
  });
  return true;
};

export const serializeRecordingIntegrityDocument = (
  document: RecordingIntegrityDocument,
): string => {
  validateRecordingIntegrityDocument(document);
  return `${canonicalJsonStringify(document)}\n`;
};

export const writeRecordingIntegrityDocument = async (
  filePath: string,
  document: RecordingIntegrityDocument,
): Promise<void> => {
  await writeFile(filePath, serializeRecordingIntegrityDocument(document), 'utf8');
};

export const readRecordingIntegrityDocumentFromText = (
  text: string,
): RecordingIntegrityDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Malformed recording integrity document JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  validateRecordingIntegrityDocument(parsed);
  return parsed as RecordingIntegrityDocument;
};

export const readRecordingIntegrityDocument = async (
  filePath: string,
): Promise<RecordingIntegrityDocument> =>
  readRecordingIntegrityDocumentFromText(await readFile(filePath, 'utf8'));
