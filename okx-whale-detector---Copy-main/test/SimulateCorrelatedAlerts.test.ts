import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appConfig } from '../src/config/appConfig';
import { CorrelatedAlertLogReader } from '../src/recording/CorrelatedAlertLogReader';
import { CorrelatedAlertRecorder } from '../src/recording/CorrelatedAlertRecorder';
import { CorrelatedAlertReporter } from '../src/reporting/CorrelatedAlertReporter';
import {
  runCorrelatedAlertSimulationCli,
  simulateCorrelatedAlerts,
} from '../src/tools/simulateCorrelatedAlerts';

describe('correlated alert simulation', () => {
  const retainedDirectories: string[] = [];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const directory of retainedDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }

    vi.restoreAllMocks();
  });

  it('records and validates deterministic agreement and contradiction scenarios', async () => {
    const reporterSpy = vi.spyOn(CorrelatedAlertReporter.prototype, 'report');
    const recorderSpy = vi.spyOn(CorrelatedAlertRecorder.prototype, 'record');
    const closeSpy = vi.spyOn(CorrelatedAlertRecorder.prototype, 'close');
    const readerSpy = vi.spyOn(CorrelatedAlertLogReader.prototype, 'read');

    const result = await simulateCorrelatedAlerts([], {
      log: vi.fn(),
      warn: vi.fn(),
    });

    expect(result.records).toHaveLength(2);
    expect(result.malformedRecordCount).toBe(0);
    expect(result.records.map((record) => record.schemaVersion)).toEqual([
      2, 2,
    ]);
    expect(
      result.records.every(
        (record) =>
          record.schemaVersion === 2 &&
          record.provenance === 'SIMULATION' &&
          record.evaluationContext.referenceMidpoint === 100.5,
      ),
    ).toBe(true);
    expect(
      result.records.map(({ alert }) => ({
        symbol: alert.symbol,
        relationship: alert.relationship,
        severity: alert.severity,
      })),
    ).toEqual([
      {
        symbol: 'BTC-USDT',
        relationship: 'AGREEMENT',
        severity: 'CRITICAL',
      },
      {
        symbol: 'ETH-USDT',
        relationship: 'CONTRADICTION',
        severity: 'STRONG',
      },
    ]);
    expect(
      result.records.every((record) => record.alert.externalSignalsUsed === 1),
    ).toBe(true);
    const contradiction = result.records.find(
      ({ alert }) => alert.relationship === 'CONTRADICTION',
    )?.alert;

    expect(contradiction?.combinedConfidence).toBeLessThan(
      contradiction?.alertImportance ?? 0,
    );
    expect(contradiction?.alertImportance).toBeGreaterThanOrEqual(
      appConfig.correlatedAlerts.severityThresholds.strong,
    );
    expect(reporterSpy).toHaveBeenCalledTimes(2);
    expect(recorderSpy).toHaveBeenCalledTimes(2);
    expect(reporterSpy.mock.calls[0]?.[0]).toBe(recorderSpy.mock.calls[0]?.[0]);
    expect(reporterSpy.mock.calls[1]?.[0]).toBe(recorderSpy.mock.calls[1]?.[0]);
    expect(closeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      readerSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(existsSync(result.outputPath)).toBe(false);
  });

  it('produces identical alert payloads across independent runs', async () => {
    const first = await simulateCorrelatedAlerts([], {
      log: vi.fn(),
      warn: vi.fn(),
    });
    const second = await simulateCorrelatedAlerts([], {
      log: vi.fn(),
      warn: vi.fn(),
    });

    expect(second.records).toEqual(first.records);
  });

  it('retains two raw JSONL records when --keep-file is supplied', async () => {
    const result = await simulateCorrelatedAlerts(['--keep-file'], {
      log: vi.fn(),
      warn: vi.fn(),
    });
    retainedDirectories.push(path.dirname(result.outputPath));

    const lines = readFileSync(result.outputPath, 'utf8').trim().split('\n');

    expect(result.fileRetained).toBe(true);
    expect(existsSync(result.outputPath)).toBe(true);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line))).toEqual(result.records);
  });

  it('uses and cleans a non-production custom file path', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'okx-simulation-test-'));
    retainedDirectories.push(directory);
    const outputPath = path.join(directory, 'custom-alerts.jsonl');

    const result = await simulateCorrelatedAlerts(['--file', outputPath], {
      log: vi.fn(),
      warn: vi.fn(),
    });

    expect(result.outputPath).toBe(path.resolve(outputPath));
    expect(result.fileRetained).toBe(false);
    expect(existsSync(outputPath)).toBe(false);
  });

  it('refuses to modify or remove an existing custom file', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'okx-simulation-test-'));
    retainedDirectories.push(directory);
    const outputPath = path.join(directory, 'existing-alerts.jsonl');
    writeFileSync(outputPath, 'existing developer data\n', 'utf8');
    const error = vi.fn();

    const exitCode = await runCorrelatedAlertSimulationCli(
      ['--file', outputPath],
      { error, log: vi.fn(), warn: vi.fn() },
    );

    expect(exitCode).toBe(1);
    expect(readFileSync(outputPath, 'utf8')).toBe('existing developer data\n');
  });

  it('rejects the configured production alert path with a nonzero exit code', async () => {
    const error = vi.fn();
    const existedBefore = existsSync(
      appConfig.correlatedAlertRecording.outputPath,
    );

    const exitCode = await runCorrelatedAlertSimulationCli(
      ['--file', appConfig.correlatedAlertRecording.outputPath],
      { error, log: vi.fn(), warn: vi.fn() },
    );

    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'Correlated alert simulation failed:',
      expect.stringContaining('production correlated alert path'),
    );
    expect(existsSync(appConfig.correlatedAlertRecording.outputPath)).toBe(
      existedBefore,
    );
  });

  it('returns a nonzero exit code when recorder close fails', async () => {
    const originalClose = CorrelatedAlertRecorder.prototype.close;
    vi.spyOn(CorrelatedAlertRecorder.prototype, 'close').mockImplementation(
      function (this: CorrelatedAlertRecorder) {
        originalClose.call(this);
        throw new Error('simulated close failure');
      },
    );
    const error = vi.fn();

    const exitCode = await runCorrelatedAlertSimulationCli([], {
      error,
      log: vi.fn(),
      warn: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'Correlated alert simulation failed:',
      'simulated close failure',
    );
  });

  it('returns a nonzero exit code when inspection fails', async () => {
    vi.spyOn(CorrelatedAlertLogReader.prototype, 'read').mockRejectedValue(
      new Error('simulated read failure'),
    );
    const error = vi.fn();

    const exitCode = await runCorrelatedAlertSimulationCli([], {
      error,
      log: vi.fn(),
      warn: vi.fn(),
    });

    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'Correlated alert simulation failed:',
      'simulated read failure',
    );
  });
});
