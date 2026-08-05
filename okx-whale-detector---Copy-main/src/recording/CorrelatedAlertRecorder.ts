import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  createCorrelatedAlertSemanticFingerprint,
  hasVersionedAlertIdentity,
  isValidCorrelatedAlertEvaluationContext,
} from './correlatedAlertEvaluationContext';
import { isSafeCorrelatedAlertOutputPath } from './correlatedAlertPath';
import type { PerformanceTrace } from '../core/PerformanceTrace';
import type {
  CorrelatedAlert,
  VersionedCorrelatedAlert,
} from '../types/correlatedAlert';
import type {
  CorrelatedAlertEvaluationContext,
  CorrelatedAlertProvenance,
  CorrelatedAlertRecordContext,
} from '../types/correlatedAlertEvaluation';

export const LEGACY_CORRELATED_ALERT_SCHEMA_VERSION = 1 as const;
export const CORRELATED_ALERT_SCHEMA_VERSION = 2 as const;
export const DEFAULT_CORRELATED_ALERT_OUTPUT_PATH =
  'data/alerts/correlated-alerts.jsonl';

export interface CorrelatedAlertRecordV1 {
  schemaVersion: typeof LEGACY_CORRELATED_ALERT_SCHEMA_VERSION;
  /** UTC epoch milliseconds when this JSONL record was appended. */
  recordedAt: number;
  alert: CorrelatedAlert;
}

export interface CorrelatedAlertRecordV2 {
  schemaVersion: typeof CORRELATED_ALERT_SCHEMA_VERSION;
  /** UTC epoch milliseconds when this JSONL record was appended. */
  recordedAt: number;
  sourceSessionId: string;
  alertSequence: number;
  semanticFingerprint: string;
  provenance: CorrelatedAlertProvenance;
  alert: VersionedCorrelatedAlert;
  evaluationContext: CorrelatedAlertEvaluationContext;
}

export type CorrelatedAlertRecord =
  CorrelatedAlertRecordV1 | CorrelatedAlertRecordV2;

export interface CorrelatedAlertRecordWriter {
  append(line: string, flush: boolean): CorrelatedAlertWriterTimings | void;
  close(): void;
}

export interface CorrelatedAlertWriterTimings {
  writeMs: number;
  fsyncMs?: number;
}

export interface CorrelatedAlertRecordResult {
  persisted: boolean;
  fsynced: boolean;
}

export interface CorrelatedAlertRecorderOptions {
  enabled?: boolean;
  outputPath?: string;
  flushAfterEachAlert?: boolean;
  clock?: () => number;
  writerFactory?: (outputPath: string) => CorrelatedAlertRecordWriter;
  warn?: (message: string) => void;
}

class AppendOnlyCorrelatedAlertWriter implements CorrelatedAlertRecordWriter {
  private readonly fileDescriptor: number;
  private closed = false;

  public constructor(outputPath: string) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    this.fileDescriptor = openSync(outputPath, 'a');
  }

  public append(line: string, flush: boolean): CorrelatedAlertWriterTimings {
    const writeStartedAt = performance.now();
    writeFileSync(this.fileDescriptor, line, { encoding: 'utf8' });
    const writeMs = performance.now() - writeStartedAt;

    if (flush) {
      const fsyncStartedAt = performance.now();
      fsyncSync(this.fileDescriptor);
      return {
        writeMs,
        fsyncMs: performance.now() - fsyncStartedAt,
      };
    }

    return { writeMs };
  }

  public close(): void {
    if (this.closed) {
      return;
    }

    let failure: unknown;

    try {
      fsyncSync(this.fileDescriptor);
    } catch (error: unknown) {
      failure = error;
    }

    try {
      closeSync(this.fileDescriptor);
    } catch (error: unknown) {
      failure ??= error;
    } finally {
      this.closed = true;
    }

    if (failure) {
      throw failure;
    }
  }
}

export class CorrelatedAlertRecorder {
  public readonly outputPath: string;

  private readonly enabled: boolean;
  private readonly flushAfterEachAlert: boolean;
  private readonly clock: () => number;
  private readonly writerFactory: (
    outputPath: string,
  ) => CorrelatedAlertRecordWriter;
  private readonly warn: (message: string) => void;
  private readonly pendingLines: Array<{
    line: string;
    trace?: PerformanceTrace;
    result: CorrelatedAlertRecordResult;
  }> = [];

  private writer?: CorrelatedAlertRecordWriter;
  private failureWarned = false;
  private closed = false;

  public constructor(options: CorrelatedAlertRecorderOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.outputPath =
      options.outputPath ?? DEFAULT_CORRELATED_ALERT_OUTPUT_PATH;
    this.flushAfterEachAlert = options.flushAfterEachAlert ?? true;
    this.clock = options.clock ?? Date.now;
    this.writerFactory =
      options.writerFactory ??
      ((outputPath) => new AppendOnlyCorrelatedAlertWriter(outputPath));
    this.warn = options.warn ?? console.warn;

    this.validateOptions();
  }

  public record(
    alert: CorrelatedAlert,
    context: CorrelatedAlertRecordContext,
    trace?: PerformanceTrace,
  ): CorrelatedAlertRecordResult {
    const result = { persisted: false, fsynced: false };

    if (!this.enabled || this.closed) {
      return result;
    }

    if (
      !hasVersionedAlertIdentity(alert) ||
      !Number.isSafeInteger(alert.createdAt) ||
      alert.createdAt < 0 ||
      !isValidCorrelatedAlertEvaluationContext(context.evaluationContext) ||
      context.evaluationContext.instId !== alert.symbol ||
      (context.provenance !== 'LIVE' &&
        context.provenance !== 'REPLAY' &&
        context.provenance !== 'SIMULATION')
    ) {
      this.reportFailure(
        new Error('invalid version 2 correlated alert evaluation context'),
      );
      return result;
    }

    const recordedAt = this.clock();

    if (!Number.isSafeInteger(recordedAt) || recordedAt < 0) {
      this.reportFailure(
        new Error('invalid version 2 correlated alert recording timestamp'),
      );
      return result;
    }

    const evaluationContext: CorrelatedAlertEvaluationContext = {
      ...context.evaluationContext,
      sourceSignalIds:
        context.evaluationContext.sourceSignalIds === undefined
          ? undefined
          : [...context.evaluationContext.sourceSignalIds],
    };
    const record: CorrelatedAlertRecordV2 = {
      schemaVersion: CORRELATED_ALERT_SCHEMA_VERSION,
      recordedAt,
      sourceSessionId: alert.sourceSessionId,
      alertSequence: alert.alertSequence,
      semanticFingerprint: createCorrelatedAlertSemanticFingerprint(
        alert,
        evaluationContext,
      ),
      provenance: context.provenance,
      alert,
      evaluationContext,
    };

    const serialize = (): string => `${JSON.stringify(record)}\n`;
    const line = trace
      ? trace.measure('alert.serialization', serialize)
      : serialize();

    this.pendingLines.push({ line, trace, result });
    this.flushPending();
    trace?.updateDiagnostics({
      alertPersisted: result.persisted,
      recorderFsync: result.fsynced,
    });

    return result;
  }

  public close(): void {
    if (this.closed) {
      return;
    }

    if (this.enabled) {
      this.flushPending();

      if (this.writer) {
        try {
          this.writer.close();
          this.failureWarned = false;
        } catch (error: unknown) {
          this.reportFailure(error);
        }
      }
    }

    this.writer = undefined;
    this.closed = true;
  }

  private flushPending(): void {
    while (this.pendingLines.length > 0) {
      try {
        this.writer ??= this.writerFactory(this.outputPath);
        const pending = this.pendingLines[0];

        if (pending === undefined) {
          return;
        }

        const appendStartedAt = performance.now();
        const timings = this.writer.append(
          pending.line,
          this.flushAfterEachAlert,
        );
        const appendMs = performance.now() - appendStartedAt;

        pending.trace?.record('alert.persistence.total', appendMs);

        if (timings) {
          pending.trace?.record('alert.persistence.write', timings.writeMs);

          if (timings.fsyncMs !== undefined) {
            pending.trace?.record('alert.persistence.fsync', timings.fsyncMs);
          }
        }

        pending.result.persisted = true;
        pending.result.fsynced =
          this.flushAfterEachAlert &&
          (timings?.fsyncMs !== undefined || timings === undefined);
        this.pendingLines.shift();
        this.failureWarned = false;
      } catch (error: unknown) {
        this.reportFailure(error);
        return;
      }
    }
  }

  private reportFailure(error: unknown): void {
    if (this.failureWarned) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.warn(
      `Unable to record correlated alert to ${this.outputPath}: ${message}`,
    );
    this.failureWarned = true;
  }

  private validateOptions(): void {
    if (typeof this.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }

    if (
      typeof this.outputPath !== 'string' ||
      this.outputPath.trim().length === 0
    ) {
      throw new Error('outputPath must be a non-empty string');
    }

    if (!isSafeCorrelatedAlertOutputPath(this.outputPath)) {
      throw new Error('outputPath must not traverse outside the project');
    }

    if (typeof this.flushAfterEachAlert !== 'boolean') {
      throw new Error('flushAfterEachAlert must be a boolean');
    }
  }
}
