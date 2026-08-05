import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createAlertAlignmentEvaluationConfiguration,
  generateAlertAlignmentEvaluations,
  prepareAlertAlignmentMarketRecording,
} from '../evaluation';
import { createCorrelatedAlertSemanticFingerprint } from '../recording/correlatedAlertEvaluationContext';
import { AlertAlignmentEvaluationReader } from '../recording/AlertAlignmentEvaluationReader';
import { AlertAlignmentEvaluationRecorder } from '../recording/AlertAlignmentEvaluationRecorder';
import type { CorrelatedAlertRecordV2 } from '../recording/CorrelatedAlertRecorder';
import { runAlertAlignmentInspectorCli } from './inspectAlertAlignmentEvaluations';

const NOW = Date.UTC(2026, 6, 29, 12);
const SESSION = 'alignment-evaluation-simulation';
const RECORDING_ID = 'market-recording:alignment-evaluation-simulation:1';
const RUN_ID = 'alignment-run:deterministic-simulation';

export interface AlertAlignmentSimulationDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const createAlert = (): CorrelatedAlertRecordV2 => {
  const record: CorrelatedAlertRecordV2 = {
    schemaVersion: 2,
    recordedAt: NOW + 1,
    sourceSessionId: SESSION,
    alertSequence: 1,
    semanticFingerprint: '',
    provenance: 'SIMULATION',
    alert: {
      id: `correlated-alert:${SESSION}:1`,
      sourceSessionId: SESSION,
      alertSequence: 1,
      symbol: 'BTC-USDT',
      severity: 'STRONG',
      eventType: 'AGREEMENT',
      bias: 'BULLISH',
      relationship: 'AGREEMENT',
      combinedConfidence: 80,
      alertImportance: 85,
      okxConfidence: 82,
      externalEffectiveConfidence: 75,
      externalSignalsUsed: 1,
      ignoredExternalSignals: 0,
      reason: 'deterministic Phase D simulation',
      createdAt: NOW,
    },
    evaluationContext: {
      instId: 'BTC-USDT',
      instType: 'SPOT',
      okxBias: 'BULLISH',
      externalBias: 'BULLISH',
      sourceSignalTimestamp: NOW,
      sourceMarketTimestamp: NOW,
      referenceTimestamp: NOW,
      referenceMidpoint: 100.5,
      referenceBestBid: 100,
      referenceBestAsk: 101,
      referenceSpread: 1,
      referenceSpreadPercent: (1 / 100.5) * 100,
      sourceSignalIds: ['simulation-signal'],
    },
  };
  record.semanticFingerprint = createCorrelatedAlertSemanticFingerprint(
    record.alert,
    record.evaluationContext,
  );
  return record;
};

const createMarketLines = (): string[] => {
  const target = NOW + 60_000;
  const header = {
    recordType: 'header',
    schemaVersion: 1,
    recordedAt: NOW - 1_000,
    sourceSessionId: SESSION,
    recordingId: RECORDING_ID,
    startedAt: NOW - 1_000,
    producer: { name: 'phase-d-simulation', version: '1' },
    clockBasis: {
      eventTime: 'UTC_EPOCH_MS',
      availabilityTime: 'UTC_EPOCH_MS',
      arrivalOrder: 'FILE_ORDINAL',
    },
    instruments: [
      {
        instId: 'BTC-USDT',
        instType: 'SPOT',
        quoteCurrency: 'USDT',
        baseUnitsPerSize: 1,
      },
    ],
    subscriptions: {
      orderBookChannel: 'books',
      orderBookDepth: 400,
      candleIntervals: ['1m'],
    },
  };
  const snapshot = {
    type: 'orderBook',
    recordedAt: target,
    update: {
      instId: 'BTC-USDT',
      action: 'snapshot',
      bids: [['100', '2', '0', '1']],
      asks: [['101', '3', '0', '1']],
      timestamp: target,
      seqId: 1,
      prevSeqId: -1,
    },
  };
  const candle = (close: number) => ({
    type: 'candle',
    recordedAt: target,
    interval: '1m',
    candle: {
      instId: 'BTC-USDT',
      timestamp: NOW,
      open: 100,
      high: 103,
      low: 99,
      close,
      volume: 10,
      volumeCurrency: 1_000,
      volumeCurrencyQuote: 1_000,
      confirm: true,
    },
  });
  const endedAt = target + 1_000;
  const footer = {
    recordType: 'sessionEnd',
    schemaVersion: 1,
    recordedAt: endedAt,
    sourceSessionId: SESSION,
    recordingId: RECORDING_ID,
    endedAt,
    status: 'CLEAN',
    counts: {
      instrumentRecords: 0,
      orderBookRecords: 1,
      candleRecords: 2,
    },
    finalFileRecordCount: 5,
  };

  return [header, snapshot, candle(101), candle(102), footer].map((record) =>
    JSON.stringify(record),
  );
};

export const simulateAlertAlignmentEvaluations = async (
  dependencies: AlertAlignmentSimulationDependencies = {},
): Promise<void> => {
  const log = dependencies.log ?? console.log;
  const directory = mkdtempSync(
    path.join(tmpdir(), 'alert-alignment-evaluation-'),
  );
  const outputPath = path.join(directory, 'evaluations.jsonl');

  try {
    const configuration = createAlertAlignmentEvaluationConfiguration();
    const marketRecording = prepareAlertAlignmentMarketRecording(
      createMarketLines(),
      { configuration: { alignment: undefined }, now: NOW + 7_200_000 },
    );
    const records = generateAlertAlignmentEvaluations({
      alerts: [createAlert()],
      marketRecording,
      configuration,
      evaluationRunId: RUN_ID,
      now: NOW + 7_200_000,
    });
    const recorder = new AlertAlignmentEvaluationRecorder(outputPath);
    try {
      records.forEach((record) => recorder.record(record));
    } finally {
      recorder.close();
    }
    const read = await new AlertAlignmentEvaluationReader().read(outputPath);
    const alignments = read.records.flatMap((record) => record.alignments);
    const count = (status: string): number =>
      alignments.filter((alignment) => alignment.completeness === status)
        .length;

    if (
      read.records.length !== 1 ||
      read.malformedLines.length !== 0 ||
      count('COMPLETE') !== 2 ||
      count('AMBIGUOUS') !== 1 ||
      count('MISSING') !== 12
    ) {
      throw new Error('Unexpected deterministic Phase D simulation result');
    }

    log('ALERT ALIGNMENT EVALUATION SIMULATION');
    log(`Valid evaluation records: ${read.records.length}`);
    log(`Malformed records: ${read.malformedLines.length}`);
    log(`COMPLETE: ${count('COMPLETE')}`);
    log(`AMBIGUOUS: ${count('AMBIGUOUS')}`);
    log(`MISSING: ${count('MISSING')}`);
    await runAlertAlignmentInspectorCli(['--file', outputPath], {
      log,
      error: dependencies.error,
    });
    log('Temporary evaluation output cleaned up.');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

export const runAlertAlignmentSimulationCli = async (
  dependencies: AlertAlignmentSimulationDependencies = {},
): Promise<number> => {
  try {
    await simulateAlertAlignmentEvaluations(dependencies);
    return 0;
  } catch (error: unknown) {
    const errorLog = dependencies.error ?? console.error;
    errorLog(
      'Alert alignment evaluation simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertAlignmentSimulationCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
