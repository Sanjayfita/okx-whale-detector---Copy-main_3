import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type { AlertPathOutcomeRecord } from '../evaluation/pathOutcome';
import { parseAlertPathOutcomeRecord } from '../evaluation/pathOutcomeValidation';

export interface AlertPathOutcomeRecordWriter {
  append(line: string): void;
  close(): void;
}

export interface AlertPathOutcomeRecorderOptions {
  writerFactory?: (outputPath: string) => AlertPathOutcomeRecordWriter;
}

class AppendOnlyPathOutcomeWriter implements AlertPathOutcomeRecordWriter {
  private readonly descriptor: number;
  private closed = false;

  public constructor(outputPath: string) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    this.descriptor = openSync(outputPath, 'a');
  }

  public append(line: string): void {
    if (this.closed) {
      throw new Error('Path-outcome writer is closed');
    }
    writeFileSync(this.descriptor, line, { encoding: 'utf8' });
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    closeSync(this.descriptor);
    this.closed = true;
  }
}

export class AlertPathOutcomeRecorder {
  private readonly writer: AlertPathOutcomeRecordWriter;
  private closed = false;

  public constructor(
    public readonly outputPath: string,
    options: AlertPathOutcomeRecorderOptions = {},
  ) {
    if (outputPath.trim().length === 0) {
      throw new Error('Path-outcome output path must not be empty');
    }
    this.writer =
      options.writerFactory?.(outputPath) ??
      new AppendOnlyPathOutcomeWriter(outputPath);
  }

  public record(record: AlertPathOutcomeRecord): void {
    if (this.closed) {
      throw new Error('Path-outcome recorder is closed');
    }
    const line = canonicalJsonStringify(record);
    parseAlertPathOutcomeRecord(line);
    this.writer.append(`${line}\n`);
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.writer.close();
    this.closed = true;
  }
}
