import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import path from 'node:path';

import type { ExternalWhaleSignal } from '../types/ExternalWhaleSignal';

export interface ExternalSignalRecord {
  type: 'externalSignal';
  recordedAt: number;
  signal: ExternalWhaleSignal;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const parseExternalSignalRecord = (
  line: string,
): ExternalSignalRecord => {
  const value: unknown = JSON.parse(line);

  if (!isRecord(value) || value.type !== 'externalSignal') {
    throw new Error('Invalid external signal record type');
  }

  if (
    typeof value.recordedAt !== 'number' ||
    !Number.isFinite(value.recordedAt)
  ) {
    throw new Error('Invalid external signal recording timestamp');
  }

  if (
    !isRecord(value.signal) ||
    typeof value.signal.id !== 'string' ||
    typeof value.signal.underlyingEventId !== 'string' ||
    typeof value.signal.provider !== 'string' ||
    typeof value.signal.category !== 'string' ||
    typeof value.signal.direction !== 'string' ||
    typeof value.signal.occurredAt !== 'number' ||
    typeof value.signal.receivedAt !== 'number' ||
    typeof value.signal.confidence !== 'number' ||
    typeof value.signal.description !== 'string' ||
    !Array.isArray(value.signal.evidence)
  ) {
    throw new Error('Invalid recorded external whale signal');
  }

  return value as unknown as ExternalSignalRecord;
};

export class ExternalSignalRecorder {
  private readonly stream: WriteStream;
  public readonly filePath: string;

  public constructor(directory: string, now = new Date()) {
    mkdirSync(directory, { recursive: true });
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    this.filePath = path.join(
      directory,
      `external-whale-signals-${timestamp}.ndjson`,
    );
    this.stream = createWriteStream(this.filePath, {
      flags: 'wx',
      encoding: 'utf8',
    });
  }

  public record(signal: ExternalWhaleSignal, recordedAt = Date.now()): void {
    const record: ExternalSignalRecord = {
      type: 'externalSignal',
      recordedAt,
      signal,
    };
    this.stream.write(`${JSON.stringify(record)}\n`);
  }

  public close(): void {
    this.stream.end();
  }
}
