import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CorrelatedAlertRecorder,
  type CorrelatedAlertRecord,
  type CorrelatedAlertRecordWriter,
} from '../src/recording/CorrelatedAlertRecorder';
import { PerformanceTrace } from '../src/core/PerformanceTrace';
import { PipelineProfiler } from '../src/core/PipelineProfiler';

import type { CorrelatedAlert } from '../src/types/correlatedAlert';
import type { CorrelatedAlertRecordContext } from '../src/types/correlatedAlertEvaluation';

const createAlert = (
  overrides: Partial<CorrelatedAlert> = {},
): CorrelatedAlert => {
  const sourceSessionId = overrides.sourceSessionId ?? 'test-session';
  const alertSequence = overrides.alertSequence ?? 1;

  return {
    id: `correlated-alert:${sourceSessionId}:${alertSequence}`,
    sourceSessionId,
    alertSequence,
    symbol: 'BTC-USDT',
    severity: 'STRONG',
    eventType: 'AGREEMENT',
    bias: 'BULLISH',
    relationship: 'AGREEMENT',
    combinedConfidence: 74,
    alertImportance: 74,
    okxConfidence: 81,
    externalEffectiveConfidence: 53,
    externalSignalsUsed: 2,
    ignoredExternalSignals: 0,
    reason: 'OKX and external intelligence agree.',
    createdAt: 1_785_200_000_000,
    ...overrides,
  };
};

const createContext = (
  overrides: Partial<CorrelatedAlertRecordContext['evaluationContext']> = {},
): CorrelatedAlertRecordContext => ({
  provenance: 'LIVE',
  evaluationContext: {
    instId: 'BTC-USDT',
    instType: 'SPOT',
    okxBias: 'BULLISH',
    externalBias: 'BULLISH',
    sourceSignalTimestamp: 1_785_200_000_000,
    sourceMarketTimestamp: 1_785_200_000_000,
    referenceTimestamp: 1_785_200_000_000,
    referenceMidpoint: 100.5,
    referenceBestBid: 100,
    referenceBestAsk: 101,
    referenceSpread: 1,
    referenceSpreadPercent: (1 / 100.5) * 100,
    sourceSignalIds: ['signal-1'],
    ...overrides,
  },
});

describe('CorrelatedAlertRecorder', () => {
  let directory: string;
  let outputPath: string;

  beforeEach(() => {
    directory = mkdtempSync(
      path.join(tmpdir(), 'okx-correlated-alert-recorder-'),
    );
    outputPath = path.join(directory, 'nested', 'alerts.jsonl');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('appends one valid JSON object per line', () => {
    const recorder = new CorrelatedAlertRecorder({
      outputPath,
      clock: () => 1_785_200_000_100,
    });

    recorder.record(createAlert(), createContext());
    recorder.close();

    const lines = readFileSync(outputPath, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[0] ?? '') as CorrelatedAlertRecord;

    expect(lines).toHaveLength(1);
    expect(record).toEqual({
      schemaVersion: 2,
      recordedAt: 1_785_200_000_100,
      sourceSessionId: 'test-session',
      alertSequence: 1,
      semanticFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      provenance: 'LIVE',
      alert: createAlert(),
      evaluationContext: createContext().evaluationContext,
    });
  });

  it('creates a missing parent directory', () => {
    const recorder = new CorrelatedAlertRecorder({ outputPath });

    expect(existsSync(path.dirname(outputPath))).toBe(false);

    recorder.record(createAlert(), createContext());
    recorder.close();

    expect(existsSync(outputPath)).toBe(true);
  });

  it('preserves existing records after restart', () => {
    const first = new CorrelatedAlertRecorder({ outputPath });
    first.record(createAlert(), createContext());
    first.close();

    const second = new CorrelatedAlertRecorder({ outputPath });
    second.record(createAlert({ alertSequence: 2 }), createContext());
    second.close();

    const records = readFileSync(outputPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as CorrelatedAlertRecord);

    expect(records.map((record) => record.alert.id)).toEqual([
      'correlated-alert:test-session:1',
      'correlated-alert:test-session:2',
    ]);
  });

  it('records multiple alerts in order', () => {
    const recorder = new CorrelatedAlertRecorder({ outputPath });

    recorder.record(createAlert({ alertSequence: 1 }), createContext());
    recorder.record(createAlert({ alertSequence: 2 }), createContext());
    recorder.record(createAlert({ alertSequence: 3 }), createContext());
    recorder.close();

    const ids = readFileSync(outputPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as CorrelatedAlertRecord).alert.id);

    expect(ids).toEqual([
      'correlated-alert:test-session:1',
      'correlated-alert:test-session:2',
      'correlated-alert:test-session:3',
    ]);
  });

  it('serializes an immutable snapshot of the supplied context', () => {
    const recorder = new CorrelatedAlertRecorder({ outputPath });
    const context = createContext();

    recorder.record(createAlert(), context);
    context.evaluationContext.referenceBestBid = 50;
    (context.evaluationContext.sourceSignalIds as string[]).push(
      'later-signal',
    );
    recorder.close();

    const record = JSON.parse(
      readFileSync(outputPath, 'utf8').trim(),
    ) as CorrelatedAlertRecord;

    expect(
      record.schemaVersion === 2
        ? record.evaluationContext.referenceBestBid
        : undefined,
    ).toBe(100);
    expect(
      record.schemaVersion === 2
        ? record.evaluationContext.sourceSignalIds
        : undefined,
    ).toEqual(['signal-1']);
  });

  it('creates no file when disabled', () => {
    const recorder = new CorrelatedAlertRecorder({
      enabled: false,
      outputPath,
    });

    recorder.record(createAlert(), createContext());
    recorder.close();

    expect(existsSync(outputPath)).toBe(false);
  });

  it('does not throw when a write fails', () => {
    const warn = vi.fn();
    const recorder = new CorrelatedAlertRecorder({
      outputPath,
      warn,
      writerFactory: () => ({
        append: () => {
          throw new Error('disk unavailable');
        },
        close: vi.fn(),
      }),
    });

    expect(() => recorder.record(createAlert(), createContext())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`${outputPath}: disk unavailable`),
    );
  });

  it('warns only once during repeated failures', () => {
    const warn = vi.fn();
    const recorder = new CorrelatedAlertRecorder({
      outputPath,
      warn,
      writerFactory: () => ({
        append: () => {
          throw new Error('disk unavailable');
        },
        close: vi.fn(),
      }),
    });

    recorder.record(createAlert({ alertSequence: 1 }), createContext());
    recorder.record(createAlert({ alertSequence: 2 }), createContext());
    recorder.record(createAlert({ alertSequence: 3 }), createContext());

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('retries retained records after a later successful write', () => {
    const written: CorrelatedAlertRecord[] = [];
    let shouldFail = true;
    const writer: CorrelatedAlertRecordWriter = {
      append: (line) => {
        if (shouldFail) {
          throw new Error('temporary failure');
        }
        written.push(JSON.parse(line) as CorrelatedAlertRecord);
      },
      close: vi.fn(),
    };
    const recorder = new CorrelatedAlertRecorder({
      outputPath,
      writerFactory: () => writer,
      warn: vi.fn(),
    });

    recorder.record(createAlert(), createContext());
    shouldFail = false;
    recorder.record(createAlert({ alertSequence: 2 }), createContext());

    expect(written.map((record) => record.alert.id)).toEqual([
      'correlated-alert:test-session:1',
      'correlated-alert:test-session:2',
    ]);
  });

  it('closes safely when no file was opened', () => {
    const writerFactory = vi.fn();
    const recorder = new CorrelatedAlertRecorder({
      outputPath,
      writerFactory,
    });

    expect(() => recorder.close()).not.toThrow();
    expect(writerFactory).not.toHaveBeenCalled();
  });

  it('flushes writer-managed pending data on close', () => {
    const persisted: string[] = [];
    const pending: string[] = [];
    const writer: CorrelatedAlertRecordWriter = {
      append: (line, flush) => {
        if (flush) {
          persisted.push(line);
        } else {
          pending.push(line);
        }
      },
      close: () => {
        persisted.push(...pending);
        pending.length = 0;
      },
    };
    const recorder = new CorrelatedAlertRecorder({
      outputPath,
      flushAfterEachAlert: false,
      writerFactory: () => writer,
    });

    recorder.record(createAlert(), createContext());

    expect(persisted).toHaveLength(0);

    recorder.close();

    expect(persisted).toHaveLength(1);
  });

  it('attributes serialization, persistence, and measurable fsync', () => {
    const profiler = new PipelineProfiler();
    const trace = new PerformanceTrace(profiler, true);
    const recorder = new CorrelatedAlertRecorder({
      outputPath,
      writerFactory: () => ({
        append: () => ({ writeMs: 2, fsyncMs: 3 }),
        close: vi.fn(),
      }),
    });

    expect(recorder.record(createAlert(), createContext(), trace)).toEqual({
      persisted: true,
      fsynced: true,
    });

    expect(profiler.getRecentStage('alert.serialization')?.count).toBe(1);
    expect(profiler.getRecentStage('alert.persistence.total')?.count).toBe(1);
    expect(profiler.getRecentStage('alert.persistence.write')?.latestMs).toBe(
      2,
    );
    expect(profiler.getRecentStage('alert.persistence.fsync')?.latestMs).toBe(
      3,
    );
    expect(trace.getSnapshot()).toMatchObject({
      alertPersisted: true,
      recorderFsync: true,
    });
  });
});
