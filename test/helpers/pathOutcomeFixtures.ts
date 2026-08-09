import {
  createAlertAlignmentEvaluationConfiguration,
  generateAlertAlignmentEvaluations,
  generatePathOutcomeRecords,
  generateTerminalReturnRecords,
  prepareAlertAlignmentMarketRecording,
  type AlertAlignmentEvaluationRecord,
  type AlertPathOutcomeRecord,
  type AlertTerminalReturnRecord,
  type PreparedAlertAlignmentMarketRecording,
} from '../../src/evaluation';
import {
  EVALUATION_NOW,
  EVALUATION_RECORDING_ID,
  EVALUATION_SESSION,
  createEvaluationAlert,
} from './alignmentEvaluationFixtures';

export const PATH_OUTCOME_NOW = EVALUATION_NOW + 7_200_000;

interface PathMarketOptions {
  clean?: boolean;
  endedAt?: number;
  includeGap?: boolean;
  conflictingCandle?: boolean;
  omitCandleStart?: number;
  candleHigh?: number;
  candleLow?: number;
  candleClose?: number;
  bookSamples?: readonly {
    offsetMs: number;
    bid: number;
    ask: number;
    recordedOffsetMs?: number;
  }[];
}

const defaultBookSamples = [
  { offsetMs: 30_000, bid: 103, ask: 104 },
  { offsetMs: 45_000, bid: 98, ask: 99 },
  { offsetMs: 60_000, bid: 102, ask: 103 },
] as const;

export const createPathMarketLines = (
  options: PathMarketOptions = {},
): string[] => {
  const header = {
    recordType: 'header',
    schemaVersion: 1,
    recordedAt: EVALUATION_NOW - 1_000,
    sourceSessionId: EVALUATION_SESSION,
    recordingId: EVALUATION_RECORDING_ID,
    startedAt: EVALUATION_NOW - 1_000,
    producer: { name: 'path-test', version: '1' },
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
  const data: unknown[] = [];
  let seqId = 10;
  let currentBid = 100;
  let currentAsk = 101;
  data.push({
    type: 'orderBook',
    recordedAt: EVALUATION_NOW,
    update: {
      instId: 'BTC-USDT',
      action: 'snapshot',
      bids: [[String(currentBid), '2', '0', '1']],
      asks: [[String(currentAsk), '3', '0', '1']],
      timestamp: EVALUATION_NOW,
      seqId,
      prevSeqId: -1,
    },
  });

  const samples = [
    ...(options.bookSamples ?? defaultBookSamples),
    ...[300_000, 900_000, 1_800_000, 3_600_000].map((offsetMs) => ({
      offsetMs,
      bid: 102,
      ask: 103,
    })),
  ].sort((left, right) => left.offsetMs - right.offsetMs);
  let gapInjected = false;
  for (const sample of samples) {
    const previous = seqId;
    seqId += 1;
    const prevSeqId =
      options.includeGap && !gapInjected && sample.offsetMs === 45_000
        ? previous - 1
        : previous;
    if (prevSeqId !== previous) {
      gapInjected = true;
    }
    data.push({
      type: 'orderBook',
      recordedAt: EVALUATION_NOW + (sample.recordedOffsetMs ?? sample.offsetMs),
      update: {
        instId: 'BTC-USDT',
        action: 'update',
        bids: [
          [String(currentBid), '0', '0', '1'],
          [String(sample.bid), '2', '0', '1'],
        ],
        asks: [
          [String(currentAsk), '0', '0', '1'],
          [String(sample.ask), '3', '0', '1'],
        ],
        timestamp: EVALUATION_NOW + sample.offsetMs,
        seqId,
        prevSeqId,
      },
    });
    currentBid = sample.bid;
    currentAsk = sample.ask;
    if (gapInjected && sample.offsetMs === 60_000) {
      seqId += 1;
      data.push({
        type: 'orderBook',
        recordedAt: EVALUATION_NOW + 60_000,
        update: {
          instId: 'BTC-USDT',
          action: 'snapshot',
          bids: [['102', '2', '0', '1']],
          asks: [['103', '3', '0', '1']],
          timestamp: EVALUATION_NOW + 60_000,
          seqId,
          prevSeqId: -1,
        },
      });
      currentBid = 102;
      currentAsk = 103;
    }
  }

  for (let minute = 0; minute < 60; minute += 1) {
    const intervalStart = EVALUATION_NOW + minute * 60_000;
    if (intervalStart === options.omitCandleStart) {
      continue;
    }
    const candle = {
      type: 'candle',
      recordedAt: intervalStart + 60_000,
      interval: '1m',
      candle: {
        instId: 'BTC-USDT',
        timestamp: intervalStart,
        open: 100.5,
        high: options.candleHigh ?? (minute === 0 ? 104 : 103),
        low: options.candleLow ?? (minute === 0 ? 98 : 99),
        close: options.candleClose ?? 102,
        volume: 10,
        volumeCurrency: 1_000,
        volumeCurrencyQuote: 1_000,
        confirm: true,
      },
    };
    data.push(candle);
    if (options.conflictingCandle && minute === 0) {
      data.push({
        ...candle,
        candle: { ...candle.candle, high: 105 },
      });
    }
  }
  data.sort((left, right) => {
    const leftRecord = left as {
      recordedAt: number;
      type: string;
    };
    const rightRecord = right as {
      recordedAt: number;
      type: string;
    };
    return (
      leftRecord.recordedAt - rightRecord.recordedAt ||
      leftRecord.type.localeCompare(rightRecord.type)
    );
  });
  const lines = [JSON.stringify(header), ...data.map(JSON.stringify)];
  if (options.clean ?? true) {
    const endedAt = options.endedAt ?? EVALUATION_NOW + 3_600_000;
    lines.push(
      JSON.stringify({
        recordType: 'sessionEnd',
        schemaVersion: 1,
        recordedAt: endedAt,
        sourceSessionId: EVALUATION_SESSION,
        recordingId: EVALUATION_RECORDING_ID,
        endedAt,
        status: 'CLEAN',
        counts: {
          instrumentRecords: 0,
          orderBookRecords: data.filter(
            (record) => (record as { type: string }).type === 'orderBook',
          ).length,
          candleRecords: data.filter(
            (record) => (record as { type: string }).type === 'candle',
          ).length,
        },
        finalFileRecordCount: data.length + 2,
      }),
    );
  }
  return lines;
};

export const createPathFixture = (
  options: PathMarketOptions & {
    okxBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | null;
    externalBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | null;
    sequence?: number;
    referenceTimestamp?: number;
  } = {},
): {
  evaluation: AlertAlignmentEvaluationRecord;
  terminalReturn: AlertTerminalReturnRecord;
  marketRecording: PreparedAlertAlignmentMarketRecording;
} => {
  const configuration = createAlertAlignmentEvaluationConfiguration();
  const marketRecording = prepareAlertAlignmentMarketRecording(
    createPathMarketLines(options),
    { configuration, now: PATH_OUTCOME_NOW },
  );
  const evaluation = generateAlertAlignmentEvaluations({
    alerts: [
      createEvaluationAlert({
        sequence: options.sequence ?? 1,
        referenceTimestamp: options.referenceTimestamp,
      }),
    ],
    marketRecording,
    configuration,
    evaluationRunId: 'evaluation-run:path-fixture',
    now: PATH_OUTCOME_NOW,
  })[0]!;
  evaluation.alertContext.okxBias =
    options.okxBias === undefined ? 'BULLISH' : options.okxBias;
  evaluation.alertContext.externalBias =
    options.externalBias === undefined ? 'BULLISH' : options.externalBias;
  evaluation.alertContext.relationship =
    evaluation.alertContext.okxBias !== evaluation.alertContext.externalBias
      ? 'CONTRADICTION'
      : 'AGREEMENT';
  const terminalReturn = generateTerminalReturnRecords({
    evaluations: [evaluation],
    outcomeRunId: 'terminal-return-run:path-fixture',
    now: PATH_OUTCOME_NOW,
  })[0]!;
  return { evaluation, terminalReturn, marketRecording };
};

export const generatePathFixtureRecord = (
  fixture = createPathFixture(),
  overrides: Partial<Parameters<typeof generatePathOutcomeRecords>[0]> = {},
): AlertPathOutcomeRecord =>
  generatePathOutcomeRecords({
    evaluations: [fixture.evaluation],
    terminalReturns: [fixture.terminalReturn],
    marketRecording: fixture.marketRecording,
    pathOutcomeRunId: 'path-outcome-run:test',
    now: PATH_OUTCOME_NOW,
    ...overrides,
  })[0]!;
