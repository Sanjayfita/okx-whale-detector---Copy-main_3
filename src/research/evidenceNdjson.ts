import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface EvidenceNdjsonIssue {
  readonly lineNumber: number;
  readonly reason: 'INVALID_JSON' | 'INVALID_RECORD';
}

export interface ParsedEvidenceNdjson<T> {
  readonly records: readonly T[];
  readonly malformed: number;
  readonly nonEmptyLines: number;
  readonly issues: readonly EvidenceNdjsonIssue[];
}

export interface EvidenceNdjsonReadOptions {
  readonly maximumLineBytes?: number;
  readonly maximumRecords?: number;
  readonly maximumReportedIssues?: number;
}

const DEFAULT_MAXIMUM_LINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAXIMUM_RECORDS = 5_000_000;
const DEFAULT_MAXIMUM_REPORTED_ISSUES = 100;

interface MutableParseState<T> {
  readonly records: T[];
  readonly issues: EvidenceNdjsonIssue[];
  malformed: number;
  nonEmptyLines: number;
}

const validateLimit = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
};

const resolveOptions = (
  options: EvidenceNdjsonReadOptions,
): Readonly<Required<EvidenceNdjsonReadOptions>> => {
  const resolved = Object.freeze({
    maximumLineBytes: options.maximumLineBytes ?? DEFAULT_MAXIMUM_LINE_BYTES,
    maximumRecords: options.maximumRecords ?? DEFAULT_MAXIMUM_RECORDS,
    maximumReportedIssues:
      options.maximumReportedIssues ?? DEFAULT_MAXIMUM_REPORTED_ISSUES,
  });
  validateLimit(resolved.maximumLineBytes, 'maximumLineBytes');
  validateLimit(resolved.maximumRecords, 'maximumRecords');
  validateLimit(resolved.maximumReportedIssues, 'maximumReportedIssues');
  return resolved;
};

const parseLine = <T>(
  line: string,
  lineNumber: number,
  parseRecord: (value: unknown) => T | undefined,
  state: MutableParseState<T>,
  options: Readonly<Required<EvidenceNdjsonReadOptions>>,
): void => {
  if (line.trim().length === 0) return;
  state.nonEmptyLines += 1;
  if (state.nonEmptyLines > options.maximumRecords) {
    throw new Error(
      `NDJSON record limit exceeded at line ${lineNumber}: maximum=${options.maximumRecords}`,
    );
  }
  const lineBytes = Buffer.byteLength(line, 'utf8');
  if (lineBytes > options.maximumLineBytes) {
    throw new Error(
      `NDJSON line ${lineNumber} exceeds maximumLineBytes=${options.maximumLineBytes}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    state.malformed += 1;
    if (state.issues.length < options.maximumReportedIssues) {
      state.issues.push(Object.freeze({ lineNumber, reason: 'INVALID_JSON' }));
    }
    return;
  }

  const record = parseRecord(parsed);
  if (record === undefined) {
    state.malformed += 1;
    if (state.issues.length < options.maximumReportedIssues) {
      state.issues.push(
        Object.freeze({ lineNumber, reason: 'INVALID_RECORD' }),
      );
    }
    return;
  }
  state.records.push(record);
};

const finish = <T>(state: MutableParseState<T>): ParsedEvidenceNdjson<T> =>
  Object.freeze({
    records: Object.freeze(state.records),
    malformed: state.malformed,
    nonEmptyLines: state.nonEmptyLines,
    issues: Object.freeze(state.issues),
  });

export const parseEvidenceNdjson = <T>(
  content: string,
  parseRecord: (value: unknown) => T | undefined,
  options: EvidenceNdjsonReadOptions = {},
): ParsedEvidenceNdjson<T> => {
  const resolvedOptions = resolveOptions(options);
  const state: MutableParseState<T> = {
    records: [],
    issues: [],
    malformed: 0,
    nonEmptyLines: 0,
  };

  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    parseLine(line, index + 1, parseRecord, state, resolvedOptions);
  }

  return finish(state);
};

export const readEvidenceNdjsonFile = async <T>(
  filePath: string,
  parseRecord: (value: unknown) => T | undefined,
  options: EvidenceNdjsonReadOptions = {},
): Promise<ParsedEvidenceNdjson<T>> => {
  const resolvedOptions = resolveOptions(options);
  const state: MutableParseState<T> = {
    records: [],
    issues: [],
    malformed: 0,
    nonEmptyLines: 0,
  };
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      parseLine(line, lineNumber, parseRecord, state, resolvedOptions);
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return finish(state);
};
