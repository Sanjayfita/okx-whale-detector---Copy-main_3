import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface RecordingIntegrityReport {
  filePath: string;
  byteLength: number;
  lineCount: number;
  nonEmptyLineCount: number;
  malformedJsonLineCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  nonMonotonicTimestampCount: number;
  sha256: string;
  valid: boolean;
}

const timestampFromRecord = (value: unknown): number | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidate = record.timestamp ?? record.ts ?? record.recordedAt;
  return Number.isSafeInteger(candidate) && (candidate as number) >= 0
    ? (candidate as number)
    : null;
};

export const inspectRecordingIntegrityFromText = (input: {
  filePath: string;
  text: string;
}): RecordingIntegrityReport => {
  const lines = input.text.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim() !== '');
  let malformedJsonLineCount = 0;
  let firstTimestamp: number | null = null;
  let lastTimestamp: number | null = null;
  let previousTimestamp: number | null = null;
  let nonMonotonicTimestampCount = 0;

  for (const line of nonEmptyLines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformedJsonLineCount += 1;
      continue;
    }

    const timestamp = timestampFromRecord(parsed);
    if (timestamp === null) continue;
    firstTimestamp ??= timestamp;
    if (previousTimestamp !== null && timestamp < previousTimestamp) {
      nonMonotonicTimestampCount += 1;
    }
    previousTimestamp = timestamp;
    lastTimestamp = timestamp;
  }

  const byteLength = Buffer.byteLength(input.text, 'utf8');
  const sha256 = createHash('sha256').update(input.text, 'utf8').digest('hex');

  return Object.freeze({
    filePath: input.filePath,
    byteLength,
    lineCount: lines.length,
    nonEmptyLineCount: nonEmptyLines.length,
    malformedJsonLineCount,
    firstTimestamp,
    lastTimestamp,
    nonMonotonicTimestampCount,
    sha256,
    valid:
      nonEmptyLines.length > 0 &&
      malformedJsonLineCount === 0 &&
      nonMonotonicTimestampCount === 0,
  });
};

export const inspectRecordingIntegrity = async (
  filePath: string,
): Promise<RecordingIntegrityReport> =>
  inspectRecordingIntegrityFromText({ filePath, text: await readFile(filePath, 'utf8') });
