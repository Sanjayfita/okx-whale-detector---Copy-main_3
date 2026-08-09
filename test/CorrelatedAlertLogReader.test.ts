import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CorrelatedAlertLogReader } from '../src/recording/CorrelatedAlertLogReader';
import {
  CORRELATED_ALERT_SCHEMA_VERSION,
  CorrelatedAlertRecorder,
} from '../src/recording/CorrelatedAlertRecorder';
import { createCorrelatedAlertSemanticFingerprint } from '../src/recording/correlatedAlertEvaluationContext';
import type { VersionedCorrelatedAlert } from '../src/types/correlatedAlert';
import type { CorrelatedAlertEvaluationContext } from '../src/types/correlatedAlertEvaluation';

const createRecord = (id: string) => ({
  schemaVersion: 1,
  recordedAt: 1_000,
  alert: {
    id,
    symbol: 'BTC-USDT',
    severity: 'STRONG',
    eventType: 'AGREEMENT',
    bias: 'BULLISH',
    relationship: 'AGREEMENT',
    combinedConfidence: 74,
    okxConfidence: 81,
    externalEffectiveConfidence: 53,
    externalSignalsUsed: 2,
    ignoredExternalSignals: 0,
    reason: 'OKX and external intelligence agree.',
    createdAt: 1_000,
  },
});

const createVersionedAlert = (): VersionedCorrelatedAlert => ({
  ...createRecord('unused').alert,
  id: 'correlated-alert:test-session:1',
  sourceSessionId: 'test-session',
  alertSequence: 1,
  alertImportance: 74,
});

const createEvaluationContext = (
  overrides: Partial<CorrelatedAlertEvaluationContext> = {},
): CorrelatedAlertEvaluationContext => ({
  instId: 'BTC-USDT',
  instType: 'SPOT',
  okxBias: 'BULLISH',
  externalBias: 'BULLISH',
  sourceSignalTimestamp: 1_000,
  sourceMarketTimestamp: 1_000,
  referenceTimestamp: 1_000,
  referenceMidpoint: 100.5,
  referenceBestBid: 100,
  referenceBestAsk: 101,
  referenceSpread: 1,
  referenceSpreadPercent: (1 / 100.5) * 100,
  sourceSignalIds: ['signal-1'],
  ...overrides,
});

const createVersionedRecord = () => {
  const alert = createVersionedAlert();
  const evaluationContext = createEvaluationContext();

  return {
    schemaVersion: CORRELATED_ALERT_SCHEMA_VERSION,
    recordedAt: 1_001,
    sourceSessionId: alert.sourceSessionId,
    alertSequence: alert.alertSequence,
    semanticFingerprint: createCorrelatedAlertSemanticFingerprint(
      alert,
      evaluationContext,
    ),
    provenance: 'LIVE',
    alert,
    evaluationContext,
  };
};

describe('CorrelatedAlertLogReader', () => {
  let directory: string;
  let filePath: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'okx-alert-reader-'));
    filePath = path.join(directory, 'alerts.jsonl');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('parses valid records', async () => {
    writeFileSync(filePath, `${JSON.stringify(createRecord('one'))}\n`, 'utf8');

    const result = await new CorrelatedAlertLogReader().read(filePath);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.alert.id).toBe('one');
    expect(result.records[0]?.alert.alertImportance).toBe(74);
    expect(result.malformedLines).toEqual([]);
  });

  it('preserves an explicitly recorded alert importance', async () => {
    const record = createRecord('one');
    record.alert.alertImportance = 82;
    writeFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');

    const result = await new CorrelatedAlertLogReader().read(filePath);

    expect(result.records[0]?.alert.alertImportance).toBe(82);
    expect(result.malformedLines).toEqual([]);
  });

  it('parses a valid version 2 record', async () => {
    writeFileSync(
      filePath,
      `${JSON.stringify(createVersionedRecord())}\n`,
      'utf8',
    );

    const result = await new CorrelatedAlertLogReader().read(filePath);
    const record = result.records[0];

    expect(result.malformedLines).toEqual([]);
    expect(record?.schemaVersion).toBe(2);
    expect(
      record?.schemaVersion === 2 ? record.evaluationContext.instType : null,
    ).toBe('SPOT');
  });

  it('round trips a version 2 recorder record', async () => {
    const recorder = new CorrelatedAlertRecorder({
      outputPath: filePath,
      clock: () => 1_001,
    });

    recorder.record(createVersionedAlert(), {
      provenance: 'LIVE',
      evaluationContext: createEvaluationContext(),
    });
    recorder.close();

    const result = await new CorrelatedAlertLogReader().read(filePath);

    expect(result.records).toHaveLength(1);
    expect(result.malformedLines).toEqual([]);
    expect(result.records[0]?.schemaVersion).toBe(2);
  });

  it('rejects malformed version 2 evaluation context', async () => {
    const record = createVersionedRecord();
    record.evaluationContext.referenceBestAsk = 99;
    writeFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');

    const result = await new CorrelatedAlertLogReader().read(filePath);

    expect(result.records).toEqual([]);
    expect(result.malformedLines[0]?.message).toContain('evaluation context');
  });

  it('rejects a mismatched version 2 semantic fingerprint', async () => {
    const record = createVersionedRecord();
    record.semanticFingerprint = '0'.repeat(64);
    writeFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');

    const result = await new CorrelatedAlertLogReader().read(filePath);

    expect(result.records).toEqual([]);
    expect(result.malformedLines[0]?.message).toContain('semantic fingerprint');
  });

  it('rejects invalid alert importance values', async () => {
    const record = createRecord('one');
    record.alert.alertImportance = 101;
    writeFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');

    const result = await new CorrelatedAlertLogReader().read(filePath);

    expect(result.records).toHaveLength(0);
    expect(result.malformedLines).toHaveLength(1);
  });

  it('ignores blank lines', async () => {
    writeFileSync(
      filePath,
      `\n${JSON.stringify(createRecord('one'))}\n   \n`,
      'utf8',
    );

    const result = await new CorrelatedAlertLogReader().read(filePath);

    expect(result.records).toHaveLength(1);
    expect(result.malformedLines).toEqual([]);
  });

  it('reports malformed line numbers', async () => {
    writeFileSync(
      filePath,
      `${JSON.stringify(createRecord('one'))}\nnot-json\n{}\n`,
      'utf8',
    );

    const result = await new CorrelatedAlertLogReader().read(filePath);

    expect(result.malformedLines.map((line) => line.lineNumber)).toEqual([
      2, 3,
    ]);
  });

  it('returns valid records around malformed lines', async () => {
    writeFileSync(
      filePath,
      `${JSON.stringify(createRecord('one'))}\nbroken\n${JSON.stringify(
        createRecord('two'),
      )}\n`,
      'utf8',
    );

    const result = await new CorrelatedAlertLogReader().read(filePath);

    expect(result.records.map((record) => record.alert.id)).toEqual([
      'one',
      'two',
    ]);
    expect(result.malformedLines).toHaveLength(1);
  });

  it('stops after the maximum number of valid records', async () => {
    writeFileSync(
      filePath,
      ['one', 'two', 'three', 'four']
        .map((id) => JSON.stringify(createRecord(id)))
        .join('\n'),
      'utf8',
    );

    const result = await new CorrelatedAlertLogReader().read(filePath, {
      maximumRecords: 2,
    });

    expect(result.records.map((record) => record.alert.id)).toEqual([
      'one',
      'two',
    ]);
  });
});
