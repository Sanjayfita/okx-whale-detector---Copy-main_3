import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createAlertAlignmentEvaluationConfiguration,
  generateAlertAlignmentEvaluations,
  generatePathOutcomeRecords,
  generateTerminalReturnRecords,
  prepareAlertAlignmentMarketRecording,
} from '../evaluation';
import type { CorrelatedAlertRecordV2 } from '../recording/CorrelatedAlertRecorder';
import { AlertPathOutcomeReader } from '../recording/AlertPathOutcomeReader';
import { AlertPathOutcomeRecorder } from '../recording/AlertPathOutcomeRecorder';
import { runPathOutcomeInspectorCli } from './inspectAlertPathOutcomes';

export const PATH_OUTCOME_SIMULATION_REFERENCE = Date.UTC(2026, 6, 29, 12);
export const PATH_OUTCOME_SIMULATION_NOW =
  PATH_OUTCOME_SIMULATION_REFERENCE + 7_200_000;
const SESSION = 'path-outcome-simulation';
const RECORDING = 'market-recording:path-outcome-simulation:1';

export interface PathOutcomeSimulationDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

export const createPathOutcomeSimulationAlert = (
  sequence: number,
  okxBias: 'BULLISH' | 'BEARISH',
  externalBias: 'BULLISH' | 'BEARISH',
): CorrelatedAlertRecordV2 => {
  const relationship = okxBias === externalBias ? 'AGREEMENT' : 'CONTRADICTION';
  return {
    schemaVersion: 2,
    recordedAt: PATH_OUTCOME_SIMULATION_REFERENCE + sequence,
    sourceSessionId: SESSION,
    alertSequence: sequence,
    semanticFingerprint: sequence.toString(16).padStart(64, '0'),
    provenance: 'SIMULATION',
    alert: {
      id: `correlated-alert:${SESSION}:${sequence}`,
      sourceSessionId: SESSION,
      alertSequence: sequence,
      symbol: 'BTC-USDT',
      severity: 'STRONG',
      eventType: relationship,
      bias: okxBias,
      relationship,
      combinedConfidence: 80,
      alertImportance: 85,
      okxConfidence: 82,
      externalEffectiveConfidence: 75,
      externalSignalsUsed: 1,
      ignoredExternalSignals: 0,
      reason: 'deterministic path-outcome simulation',
      createdAt: PATH_OUTCOME_SIMULATION_REFERENCE,
    },
    evaluationContext: {
      instId: 'BTC-USDT',
      instType: 'SPOT',
      okxBias,
      externalBias,
      sourceSignalTimestamp: PATH_OUTCOME_SIMULATION_REFERENCE,
      sourceMarketTimestamp: PATH_OUTCOME_SIMULATION_REFERENCE,
      referenceTimestamp: PATH_OUTCOME_SIMULATION_REFERENCE,
      referenceMidpoint: 100.5,
      referenceBestBid: 100,
      referenceBestAsk: 101,
      referenceSpread: 1,
      referenceSpreadPercent: (1 / 100.5) * 100,
      sourceSignalIds: [`simulation-signal-${sequence}`],
    },
  };
};

export const createPathOutcomeSimulationMarketLines = (): string[] => {
  const data: unknown[] = [];
  let seqId = 10;
  let bid = 100;
  let ask = 101;
  data.push({
    type: 'orderBook',
    recordedAt: PATH_OUTCOME_SIMULATION_REFERENCE,
    update: {
      instId: 'BTC-USDT',
      action: 'snapshot',
      bids: [['100', '2', '0', '1']],
      asks: [['101', '3', '0', '1']],
      timestamp: PATH_OUTCOME_SIMULATION_REFERENCE,
      seqId,
      prevSeqId: -1,
    },
  });
  const samples = [
    [30_000, 103, 104],
    [45_000, 98, 99],
    [60_000, 102, 103],
    [300_000, 102, 103],
    [900_000, 102, 103],
    [1_800_000, 102, 103],
    [3_600_000, 102, 103],
  ] as const;
  for (const [offset, nextBid, nextAsk] of samples) {
    const previous = seqId;
    seqId += 1;
    data.push({
      type: 'orderBook',
      recordedAt: PATH_OUTCOME_SIMULATION_REFERENCE + offset,
      update: {
        instId: 'BTC-USDT',
        action: 'update',
        bids: [
          [String(bid), '0', '0', '1'],
          [String(nextBid), '2', '0', '1'],
        ],
        asks: [
          [String(ask), '0', '0', '1'],
          [String(nextAsk), '3', '0', '1'],
        ],
        timestamp: PATH_OUTCOME_SIMULATION_REFERENCE + offset,
        seqId,
        prevSeqId: previous,
      },
    });
    bid = nextBid;
    ask = nextAsk;
  }
  for (let minute = 0; minute < 60; minute += 1) {
    const start = PATH_OUTCOME_SIMULATION_REFERENCE + minute * 60_000;
    data.push({
      type: 'candle',
      recordedAt: start + 60_000,
      interval: '1m',
      candle: {
        instId: 'BTC-USDT',
        timestamp: start,
        open: 100.5,
        high: minute === 0 ? 104 : 103,
        low: minute === 0 ? 98 : 99,
        close: 102,
        volume: 10,
        volumeCurrency: 1_000,
        volumeCurrencyQuote: 1_000,
        confirm: true,
      },
    });
  }
  data.sort(
    (left, right) =>
      (left as { recordedAt: number }).recordedAt -
      (right as { recordedAt: number }).recordedAt,
  );
  const header = {
    recordType: 'header',
    schemaVersion: 1,
    recordedAt: PATH_OUTCOME_SIMULATION_REFERENCE - 1_000,
    sourceSessionId: SESSION,
    recordingId: RECORDING,
    startedAt: PATH_OUTCOME_SIMULATION_REFERENCE - 1_000,
    producer: { name: 'path-simulation', version: '1' },
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
  const footer = {
    recordType: 'sessionEnd',
    schemaVersion: 1,
    recordedAt: PATH_OUTCOME_SIMULATION_REFERENCE + 3_600_000,
    sourceSessionId: SESSION,
    recordingId: RECORDING,
    endedAt: PATH_OUTCOME_SIMULATION_REFERENCE + 3_600_000,
    status: 'CLEAN',
    counts: {
      instrumentRecords: 0,
      orderBookRecords: 8,
      candleRecords: 60,
    },
    finalFileRecordCount: data.length + 2,
  };
  return [
    JSON.stringify(header),
    ...data.map((record) => JSON.stringify(record)),
    JSON.stringify(footer),
  ];
};

export const simulateAlertPathOutcomes = async (
  dependencies: PathOutcomeSimulationDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  const directory = mkdtempSync(path.join(tmpdir(), 'alert-path-outcome-'));
  const outputPath = path.join(directory, 'path-outcomes.jsonl');
  try {
    const configuration = createAlertAlignmentEvaluationConfiguration();
    const marketRecording = prepareAlertAlignmentMarketRecording(
      createPathOutcomeSimulationMarketLines(),
      { configuration, now: PATH_OUTCOME_SIMULATION_NOW },
    );
    const evaluations = generateAlertAlignmentEvaluations({
      alerts: [
        createPathOutcomeSimulationAlert(1, 'BULLISH', 'BULLISH'),
        createPathOutcomeSimulationAlert(2, 'BEARISH', 'BEARISH'),
        createPathOutcomeSimulationAlert(3, 'BULLISH', 'BEARISH'),
      ],
      marketRecording,
      configuration,
      evaluationRunId: 'evaluation-run:path-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const terminalReturns = generateTerminalReturnRecords({
      evaluations,
      outcomeRunId: 'terminal-return-run:path-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const records = generatePathOutcomeRecords({
      evaluations,
      terminalReturns,
      marketRecording,
      pathOutcomeRunId: 'path-outcome-run:deterministic-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const recorder = new AlertPathOutcomeRecorder(outputPath);
    try {
      records.forEach((record) => recorder.record(record));
    } finally {
      recorder.close();
    }
    const result = await new AlertPathOutcomeReader().read(outputPath);
    const cells = result.records.flatMap((record) => record.paths);
    const contradiction = result.records.find(
      (record) => record.alertContext.relationship === 'CONTRADICTION',
    );
    const contradictionMidpoint = contradiction?.paths.find(
      (cell) =>
        cell.horizonMs === 60_000 && cell.source === 'ORDER_BOOK_MIDPOINT',
    );
    const executable = result.records[0]?.paths.find(
      (cell) =>
        cell.horizonMs === 60_000 && cell.source === 'ORDER_BOOK_BID_ASK',
    );
    log('ALERT PATH OUTCOME SIMULATION');
    log(`Valid path records: ${result.records.length}`);
    log(`Malformed records: ${result.malformedLines.length}`);
    log(
      `Eligible cells: ${cells.filter((cell) => cell.eligibility === 'ELIGIBLE').length}`,
    );
    log(
      `Ineligible cells: ${cells.filter((cell) => cell.eligibility === 'INELIGIBLE').length}`,
    );
    log(
      `Ambiguous cells: ${cells.filter((cell) => cell.eligibility === 'AMBIGUOUS').length}`,
    );
    log(
      `Contradiction 1m: OKX MFE=${contradictionMidpoint?.okxDirectional?.favorableExcursion}, External MFE=${contradictionMidpoint?.externalDirectional?.favorableExcursion}`,
    );
    log(
      `Bullish executable 1m: MFE=${executable?.executableOkx?.favorableExcursion}, MAE=${executable?.executableOkx?.adverseExcursion}`,
    );
    log(
      `Duplicate IDs: ${result.duplicatePathOutcomeIds.length}; Duplicate units: ${result.duplicateUnits.length}`,
    );
    await runPathOutcomeInspectorCli(['--file', outputPath], {
      log,
      error: errorLog,
    });
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Path-outcome simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    log('Temporary path-outcome output cleaned up.');
  }
};

export const runPathOutcomeSimulationCli = async (): Promise<number> =>
  simulateAlertPathOutcomes();

if (require.main === module) {
  void runPathOutcomeSimulationCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
