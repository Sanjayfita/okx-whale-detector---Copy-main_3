import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type { AlertTerminalReturnRecord } from '../evaluation/terminalReturn';
import { parseAlertTerminalReturnRecord } from '../evaluation/terminalReturnValidation';

export interface AlertTerminalReturnRecordWriter {
  append(line: string): void;
  close(): void;
}

export interface AlertTerminalReturnRecorderOptions {
  writerFactory?: (outputPath: string) => AlertTerminalReturnRecordWriter;
}

class AppendOnlyTerminalReturnWriter implements AlertTerminalReturnRecordWriter {
  private readonly descriptor: number;
  private closed = false;

  public constructor(outputPath: string) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    this.descriptor = openSync(outputPath, 'a');
  }

  public append(line: string): void {
    if (this.closed) {
      throw new Error('Terminal-return writer is closed');
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

export class AlertTerminalReturnRecorder {
  private readonly writer: AlertTerminalReturnRecordWriter;
  private closed = false;

  public constructor(
    public readonly outputPath: string,
    options: AlertTerminalReturnRecorderOptions = {},
  ) {
    if (outputPath.trim().length === 0) {
      throw new Error('Terminal-return output path must not be empty');
    }
    this.writer =
      options.writerFactory?.(outputPath) ??
      new AppendOnlyTerminalReturnWriter(outputPath);
  }

  public record(record: AlertTerminalReturnRecord): void {
    if (this.closed) {
      throw new Error('Terminal-return recorder is closed');
    }
    const line = canonicalJsonStringify(record);
    parseAlertTerminalReturnRecord(line);
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
