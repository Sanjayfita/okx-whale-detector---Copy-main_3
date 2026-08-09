import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AlignmentReason,
  createAlertAlignmentEvaluationConfiguration,
  createAlertAlignmentEvaluationId,
  generateTerminalReturnRecords,
  type AlertAlignmentEvaluationRecord,
  type PersistedAlignmentResult,
  type PriceSource,
} from '../evaluation';
import type { MarketBias } from '../types/signal';
import { AlertTerminalReturnReader } from '../recording/AlertTerminalReturnReader';
import { AlertTerminalReturnRecorder } from '../recording/AlertTerminalReturnRecorder';
import { runTerminalReturnInspectorCli } from './inspectAlertTerminalReturns';

const NOW = Date.UTC(2026, 6, 29, 12);
const EVALUATION_NOW = NOW + 3_600_000;
const SESSION = 'terminal-return-simulation';
const RECORDING_ID = 'market-recording:terminal-return-simulation:1';
const SOURCES: readonly PriceSource[] = [
  'ORDER_BOOK_MIDPOINT',
  'ORDER_BOOK_BID_ASK',
  'CONFIRMED_CANDLE_CLOSE',
];

type CellMode = 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'AMBIGUOUS';

export interface TerminalReturnSimulationDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const alignmentConfiguration = createAlertAlignmentEvaluationConfiguration({
  alignment: {
    version: 'alignment-v1',
    horizonsMs: [60_000, 300_000],
    sourceFallback: 'NONE',
    orderBookMaximumEventLatenessMs: 5_000,
    candleMaximumEventLatenessMs: 60_000,
    localArrivalAllowanceMs: 5_000,
    allowedClockSkewMs: 5_000,
    legacyReferenceMaximumAgeMs: 5_000,
    minimumValidTimestampMs: Date.UTC(2000, 0, 1),
    maximumValidTimestampMs: Date.UTC(2100, 0, 1),
    maximumFutureOffsetMs: 86_400_000,
  },
});

const createObservation = (
  source: PriceSource,
  eventTimestamp: number,
  ordinal: number,
  terminal: number,
) => ({
  instrument: { instId: 'BTC-USDT', instType: 'SPOT' as const },
  source,
  eventTimestamp,
  availabilityTimestamp: eventTimestamp,
  recordOrdinal: ordinal,
  ...(source === 'ORDER_BOOK_MIDPOINT'
    ? { midpoint: terminal }
    : source === 'ORDER_BOOK_BID_ASK'
      ? { bestBid: terminal - 1, bestAsk: terminal + 1 }
      : {
          close: terminal,
          intervalStart: eventTimestamp - 60_000,
          intervalEnd: eventTimestamp,
        }),
  recordingId: RECORDING_ID,
  sourceSessionId: SESSION,
});

const createAlignment = (input: {
  alertId: string;
  source: PriceSource;
  horizonMs: number;
  ordinal: number;
  terminal: number;
  mode: CellMode;
}): PersistedAlignmentResult => {
  const targetTimestamp = NOW + input.horizonMs;
  const hasObservation = input.mode === 'COMPLETE' || input.mode === 'PARTIAL';
  const reason =
    input.mode === 'PARTIAL'
      ? AlignmentReason.RECORDING_TRUNCATED
      : input.mode === 'MISSING'
        ? AlignmentReason.NO_SAMPLE_AFTER_HORIZON
        : input.mode === 'AMBIGUOUS'
          ? AlignmentReason.CONFLICTING_DUPLICATE
          : null;
  const observation = hasObservation
    ? createObservation(
        input.source,
        targetTimestamp,
        input.ordinal,
        input.terminal,
      )
    : null;
  return {
    alignmentSchemaVersion: 1,
    evaluationConfigVersion: `${alignmentConfiguration.version}:${alignmentConfiguration.fingerprint}`,
    alertId: input.alertId,
    instrument: { instId: 'BTC-USDT', instType: 'SPOT' },
    source: input.source,
    horizonMs: input.horizonMs,
    reference: {
      provenance: 'CAPTURED_ALERT_CONTEXT',
      referenceTimestamp: NOW,
      midpoint: 100.5,
      bestBid: 100,
      bestAsk: 101,
    },
    targetTimestamp,
    selectedObservation: observation,
    observationDelayMs: observation ? 0 : null,
    availabilityDelayMs: observation ? 0 : null,
    completeness: input.mode,
    primaryReason: reason,
    reasons: reason ? [reason] : [],
    sourceSessionId: SESSION,
    recordingId: RECORDING_ID,
    validityGaps: [],
    fallbackUsed: false,
    fallbackReason: null,
  };
};

const createEvaluation = (input: {
  sequence: number;
  okxBias: MarketBias;
  externalBias: MarketBias;
  relationship: AlertAlignmentEvaluationRecord['alertContext']['relationship'];
  terminal: number;
  modes?: readonly CellMode[];
}): AlertAlignmentEvaluationRecord => {
  const alertId = `correlated-alert:${SESSION}:${input.sequence}`;
  const alertIdentity = {
    alertId,
    sourceSessionId: SESSION,
    alertSequence: input.sequence,
    semanticFingerprint: input.sequence.toString(16).padStart(64, '0'),
    alertSchemaVersion: 2 as const,
    alertRecordedAt: NOW + input.sequence,
  };
  const alignments: PersistedAlignmentResult[] = [];
  let ordinal = 1;
  let modeIndex = 0;
  for (const horizonMs of alignmentConfiguration.horizonsMs) {
    for (const source of SOURCES) {
      alignments.push(
        createAlignment({
          alertId,
          source,
          horizonMs,
          ordinal,
          terminal: input.terminal,
          mode: input.modes?.[modeIndex] ?? 'COMPLETE',
        }),
      );
      ordinal += 1;
      modeIndex += 1;
    }
  }
  return {
    recordType: 'alertAlignmentEvaluation',
    schemaVersion: 1,
    recordedAt: EVALUATION_NOW,
    evaluationId: createAlertAlignmentEvaluationId({
      alertIdentity,
      recordingId: RECORDING_ID,
      configurationFingerprint: alignmentConfiguration.fingerprint,
    }),
    evaluationRunId: 'alignment-run:terminal-return-simulation',
    alertIdentity,
    instrument: { instId: 'BTC-USDT', instType: 'SPOT' },
    provenance: {
      alertProvenance: 'SIMULATION',
      marketRecordingFormat: 'VERSIONED_V1',
      marketSourceSessionId: SESSION,
      recordingId: RECORDING_ID,
      recordingStartedAt: NOW - 1_000,
      recordingEndedAt: NOW + 600_000,
      recordingTermination: 'CLEAN',
      evaluatorVersion: 'alignment-evaluator-v1',
    },
    reference: {
      referenceTimestamp: NOW,
      sourceMarketTimestamp: NOW,
      sourceSignalTimestamp: NOW,
      midpoint: 100.5,
      bestBid: 100,
      bestAsk: 101,
      spread: 1,
      spreadPercent: (1 / 100.5) * 100,
      provenance: 'CAPTURED_ALERT_CONTEXT',
    },
    alertContext: {
      eventType:
        input.relationship === 'CONTRADICTION' ? 'CONTRADICTION' : 'AGREEMENT',
      bias: input.okxBias,
      okxBias: input.okxBias,
      externalBias: input.externalBias,
      relationship: input.relationship,
      severity: 'STRONG',
      combinedConfidence: 75,
      alertImportance: 80,
      okxConfidence: 80,
      externalEffectiveConfidence: 75,
    },
    configuration: alignmentConfiguration,
    alignments,
  };
};

export const simulateAlertTerminalReturns = async (
  dependencies: TerminalReturnSimulationDependencies = {},
): Promise<void> => {
  const log = dependencies.log ?? console.log;
  const directory = mkdtempSync(path.join(tmpdir(), 'alert-terminal-return-'));
  const outputPath = path.join(directory, 'returns.jsonl');

  try {
    const evaluations = [
      createEvaluation({
        sequence: 1,
        okxBias: 'BULLISH',
        externalBias: 'BULLISH',
        relationship: 'AGREEMENT',
        terminal: 110,
      }),
      createEvaluation({
        sequence: 2,
        okxBias: 'BEARISH',
        externalBias: 'BEARISH',
        relationship: 'AGREEMENT',
        terminal: 90,
      }),
      createEvaluation({
        sequence: 3,
        okxBias: 'BULLISH',
        externalBias: 'BEARISH',
        relationship: 'CONTRADICTION',
        terminal: 110,
      }),
      createEvaluation({
        sequence: 4,
        okxBias: 'NEUTRAL',
        externalBias: 'NEUTRAL',
        relationship: 'NEUTRAL',
        terminal: 100.5,
        modes: [
          'COMPLETE',
          'PARTIAL',
          'AMBIGUOUS',
          'MISSING',
          'MISSING',
          'MISSING',
        ],
      }),
    ];
    const records = generateTerminalReturnRecords({
      evaluations,
      outcomeRunId: 'terminal-return-run:deterministic-simulation',
      now: EVALUATION_NOW,
    });
    const recorder = new AlertTerminalReturnRecorder(outputPath);
    try {
      records.forEach((record) => recorder.record(record));
    } finally {
      recorder.close();
    }
    const read = await new AlertTerminalReturnReader().read(outputPath);
    const cells = read.records.flatMap((record) => record.returns);
    const eligible = cells.filter(
      (cell) => cell.eligibility === 'ELIGIBLE',
    ).length;
    const ineligible = cells.filter(
      (cell) => cell.eligibility === 'INELIGIBLE',
    ).length;
    const ambiguous = cells.filter(
      (cell) => cell.eligibility === 'AMBIGUOUS',
    ).length;
    const contradiction = read.records.find(
      (record) => record.alertContext.relationship === 'CONTRADICTION',
    )!;
    const contradictionMidpoint = contradiction.returns.find(
      (cell) => cell.source === 'ORDER_BOOK_MIDPOINT',
    )!;
    const bullishBook = read.records[0]!.returns.find(
      (cell) => cell.source === 'ORDER_BOOK_BID_ASK',
    )!;
    const bearishBook = read.records[1]!.returns.find(
      (cell) => cell.source === 'ORDER_BOOK_BID_ASK',
    )!;

    if (
      read.records.length !== 4 ||
      read.malformedLines.length !== 0 ||
      eligible !== 19 ||
      ineligible !== 4 ||
      ambiguous !== 1 ||
      contradictionMidpoint.okxDirectionalReturn !== 9.5 ||
      contradictionMidpoint.externalDirectionalReturn !== -9.5 ||
      bullishBook.okxExecutable?.rawReturn !== 8 ||
      bearishBook.okxExecutable?.rawReturn !== 9
    ) {
      throw new Error('Unexpected deterministic Phase E simulation result');
    }

    log('ALERT TERMINAL RETURN SIMULATION');
    log(`Valid return records: ${read.records.length}`);
    log(`Malformed records: ${read.malformedLines.length}`);
    log(`Eligible cells: ${eligible}`);
    log(`Ineligible cells: ${ineligible}`);
    log(`Ambiguous cells: ${ambiguous}`);
    log(
      `Contradiction directions: OKX=${contradictionMidpoint.okxDirectionalReturn}, External=${contradictionMidpoint.externalDirectionalReturn}`,
    );
    log(`Bullish executable return: ${bullishBook.okxExecutable.rawReturn}`);
    log(`Bearish executable return: ${bearishBook.okxExecutable.rawReturn}`);
    await runTerminalReturnInspectorCli(['--file', outputPath], {
      log,
      error: dependencies.error,
    });
    log('Temporary terminal-return output cleaned up.');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

export const runTerminalReturnSimulationCli = async (
  dependencies: TerminalReturnSimulationDependencies = {},
): Promise<number> => {
  try {
    await simulateAlertTerminalReturns(dependencies);
    return 0;
  } catch (error: unknown) {
    const errorLog = dependencies.error ?? console.error;
    errorLog(
      'Terminal-return simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runTerminalReturnSimulationCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
