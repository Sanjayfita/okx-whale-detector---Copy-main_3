import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type { AlertAlignmentEvaluationRecord } from '../evaluation/alertAlignmentEvaluation';
import { parseAlertAlignmentEvaluationRecord } from '../evaluation/alertAlignmentEvaluationValidation';

export interface AlertAlignmentEvaluationRecordWriter {
  append(line: string): void;
  close(): void;
}

export interface AlertAlignmentEvaluationRecorderOptions {
  writerFactory?: (outputPath: string) => AlertAlignmentEvaluationRecordWriter;
}

class AppendOnlyEvaluationWriter implements AlertAlignmentEvaluationRecordWriter {
  private readonly descriptor: number;
  private closed = false;

  public constructor(outputPath: string) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    this.descriptor = openSync(outputPath, 'a');
  }

  public append(line: string): void {
    if (this.closed) {
      throw new Error('Alignment evaluation writer is closed');
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

export class AlertAlignmentEvaluationRecorder {
  private readonly writer: AlertAlignmentEvaluationRecordWriter;
  private closed = false;

  public constructor(
    public readonly outputPath: string,
    options: AlertAlignmentEvaluationRecorderOptions = {},
  ) {
    if (outputPath.trim().length === 0) {
      throw new Error('Alignment evaluation output path must not be empty');
    }
    this.writer =
      options.writerFactory?.(outputPath) ??
      new AppendOnlyEvaluationWriter(outputPath);
  }

  public record(record: AlertAlignmentEvaluationRecord): void {
    if (this.closed) {
      throw new Error('Alignment evaluation recorder is closed');
    }
    const line = canonicalJsonStringify(record);
    parseAlertAlignmentEvaluationRecord(line);
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
