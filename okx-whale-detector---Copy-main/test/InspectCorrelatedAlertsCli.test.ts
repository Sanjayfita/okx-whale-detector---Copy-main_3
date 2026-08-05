import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCorrelatedAlertInspectionCli } from '../src/tools/inspectCorrelatedAlerts';
import { createCorrelatedAlertSemanticFingerprint } from '../src/recording/correlatedAlertEvaluationContext';
import type { VersionedCorrelatedAlert } from '../src/types/correlatedAlert';
import type { CorrelatedAlertEvaluationContext } from '../src/types/correlatedAlertEvaluation';

const createRecord = () => ({
  schemaVersion: 1,
  recordedAt: 1_000,
  alert: {
    id: 'alert-1',
    symbol: 'BTC-USDT',
    severity: 'STRONG',
    eventType: 'AGREEMENT',
    bias: 'BULLISH',
    relationship: 'AGREEMENT',
    combinedConfidence: 74,
    alertImportance: 82,
    okxConfidence: 81,
    externalEffectiveConfidence: 53,
    externalSignalsUsed: 2,
    ignoredExternalSignals: 0,
    reason: 'OKX and external intelligence agree.',
    createdAt: 1_000,
  },
});

const createVersionedRecord = () => {
  const alert: VersionedCorrelatedAlert = {
    ...createRecord().alert,
    id: 'correlated-alert:inspect-session:7',
    sourceSessionId: 'inspect-session',
    alertSequence: 7,
  };
  const evaluationContext: CorrelatedAlertEvaluationContext = {
    instId: 'BTC-USDT-SWAP',
    instType: 'SWAP',
    okxBias: 'BULLISH',
    externalBias: 'BEARISH',
    sourceSignalTimestamp: 1_000,
    sourceMarketTimestamp: 1_000,
    referenceTimestamp: 1_000,
    referenceMidpoint: 100.5,
    referenceBestBid: 100,
    referenceBestAsk: 101,
    referenceSpread: 1,
    referenceSpreadPercent: (1 / 100.5) * 100,
    sourceSignalIds: ['signal-1'],
  };

  alert.symbol = evaluationContext.instId;
  alert.relationship = 'CONTRADICTION';
  alert.eventType = 'CONTRADICTION';

  return {
    schemaVersion: 2,
    recordedAt: 1_001,
    sourceSessionId: alert.sourceSessionId,
    alertSequence: alert.alertSequence,
    semanticFingerprint: createCorrelatedAlertSemanticFingerprint(
      alert,
      evaluationContext,
    ),
    provenance: 'SIMULATION',
    alert,
    evaluationContext,
  };
};

describe('correlated alert inspection CLI', () => {
  let directory: string;
  let defaultFilePath: string;
  let log: ReturnType<typeof vi.fn>;
  let warn: ReturnType<typeof vi.fn>;
  let error: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'okx-alert-inspector-'));
    defaultFilePath = path.join(directory, 'default-alerts.jsonl');
    log = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('treats a missing default file as an empty not-yet-created log', async () => {
    const exitCode = await runCorrelatedAlertInspectionCli([], {
      defaultFilePath,
      log,
      warn,
      error,
    });
    const output = log.mock.calls.flat().join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('No correlated alert log exists yet.');
    expect(output).toContain(`Expected file: ${path.resolve(defaultFilePath)}`);
    expect(output).toContain('created lazily after the first correlated alert');
    expect(error).not.toHaveBeenCalled();
  });

  it('treats a missing explicitly supplied file the same way', async () => {
    const customFilePath = path.join(directory, 'custom-alerts.jsonl');

    const exitCode = await runCorrelatedAlertInspectionCli(
      ['--file', customFilePath],
      {
        defaultFilePath,
        log,
        warn,
        error,
      },
    );

    expect(exitCode).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain(
      `Expected file: ${path.resolve(customFilePath)}`,
    );
  });

  it('does not create an empty file while inspecting a missing path', async () => {
    await runCorrelatedAlertInspectionCli([], {
      defaultFilePath,
      log,
      warn,
      error,
    });

    expect(existsSync(defaultFilePath)).toBe(false);
  });

  it('retains a nonzero exit code for unexpected filesystem errors', async () => {
    const permissionError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });

    const exitCode = await runCorrelatedAlertInspectionCli([], {
      defaultFilePath,
      reader: {
        read: async () => {
          throw permissionError;
        },
      },
      log,
      warn,
      error,
    });

    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'Correlated alert inspection failed:',
      'permission denied',
    );
  });

  it('preserves existing valid-file output', async () => {
    writeFileSync(
      defaultFilePath,
      `${JSON.stringify(createRecord())}\n`,
      'utf8',
    );

    const exitCode = await runCorrelatedAlertInspectionCli([], {
      defaultFilePath,
      log,
      warn,
      error,
    });
    const output = log.mock.calls.flat().join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('Valid alerts: 1');
    expect(output).toContain('STRONG: 1');
    expect(output).toContain('AGREEMENT: 1');
    expect(output).toContain('BTC-USDT: 1');
    expect(output).toContain('Average alert importance: 82.0%');
    expect(output).toContain('Highest alert importance: 82.0%');
    expect(output).toContain('Schema v1 | Alert ID: alert-1');
    expect(output).toContain('Evaluation context: unavailable');
    expect(error).not.toHaveBeenCalled();
  });

  it('prints version 2 evaluation identity and reference context', async () => {
    writeFileSync(
      defaultFilePath,
      `${JSON.stringify(createVersionedRecord())}\n`,
      'utf8',
    );

    const exitCode = await runCorrelatedAlertInspectionCli([], {
      defaultFilePath,
      log,
      warn,
      error,
    });
    const output = log.mock.calls.flat().join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('Schema v2');
    expect(output).toContain('Alert ID: correlated-alert:inspect-session:7');
    expect(output).toContain('Session: inspect-session | Sequence: 7');
    expect(output).toContain('Instrument: BTC-USDT-SWAP (SWAP)');
    expect(output).toContain('OKX Bias: BULLISH');
    expect(output).toContain('External Bias: BEARISH');
    expect(output).toContain('Provenance: SIMULATION');
    expect(output).toContain('Reference: midpoint 100.5 | bid 100 | ask 101');
    expect(output).toContain('Evaluation context: available');
  });
});
