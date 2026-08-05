import {
  createAlertAlignmentEvaluationConfiguration,
  prepareAlertAlignmentMarketRecording,
  type AlertAlignmentEvaluationConfiguration,
  type PreparedAlertAlignmentMarketRecording,
} from '../../src/evaluation';
import type { CorrelatedAlertRecordV2 } from '../../src/recording/CorrelatedAlertRecorder';

export const EVALUATION_NOW = Date.UTC(2026, 6, 29, 12);
export const EVALUATION_SESSION = 'alignment-evaluation-session';
export const EVALUATION_RECORDING_ID =
  'market-recording:alignment-evaluation-session:test';

export const createEvaluationAlert = (
  overrides: {
    sequence?: number;
    sourceSessionId?: string;
    instId?: string;
    instType?: 'SPOT' | 'SWAP';
    referenceTimestamp?: number;
    referenceMidpoint?: number;
    referenceBestBid?: number;
    referenceBestAsk?: number;
    referenceSpread?: number;
    referenceSpreadPercent?: number;
  } = {},
): CorrelatedAlertRecordV2 => {
  const sequence = overrides.sequence ?? 1;
  const sourceSessionId = overrides.sourceSessionId ?? EVALUATION_SESSION;
  const instId = overrides.instId ?? 'BTC-USDT';
  const instType = overrides.instType ?? 'SPOT';
  const referenceTimestamp = overrides.referenceTimestamp ?? EVALUATION_NOW;
  const bestBid = overrides.referenceBestBid ?? 100;
  const bestAsk = overrides.referenceBestAsk ?? 101;
  const midpoint = overrides.referenceMidpoint ?? 100.5;
  const spread = overrides.referenceSpread ?? bestAsk - bestBid;
  const spreadPercent =
    overrides.referenceSpreadPercent ?? (spread / midpoint) * 100;

  return {
    schemaVersion: 2,
    recordedAt: referenceTimestamp + 1,
    sourceSessionId,
    alertSequence: sequence,
    semanticFingerprint: sequence.toString(16).padStart(64, '0'),
    provenance: 'SIMULATION',
    alert: {
      id: `correlated-alert:${sourceSessionId}:${sequence}`,
      sourceSessionId,
      alertSequence: sequence,
      symbol: instId,
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
      reason: 'deterministic evaluation fixture',
      createdAt: referenceTimestamp,
    },
    evaluationContext: {
      instId,
      instType,
      okxBias: 'BULLISH',
      externalBias: 'BULLISH',
      sourceSignalTimestamp: referenceTimestamp,
      sourceMarketTimestamp: referenceTimestamp,
      referenceTimestamp,
      referenceMidpoint: midpoint,
      referenceBestBid: bestBid,
      referenceBestAsk: bestAsk,
      referenceSpread: spread,
      referenceSpreadPercent: spreadPercent,
      sourceSignalIds: ['fixture-signal'],
    },
  };
};

export const createEvaluationMarketLines = (
  overrides: {
    sourceSessionId?: string;
    recordingId?: string;
    clean?: boolean;
    instruments?: readonly {
      instId: string;
      instType: 'SPOT' | 'SWAP';
      quoteCurrency: 'USDT';
      baseUnitsPerSize: number;
    }[];
  } = {},
): string[] => {
  const sourceSessionId = overrides.sourceSessionId ?? EVALUATION_SESSION;
  const recordingId = overrides.recordingId ?? EVALUATION_RECORDING_ID;
  const instruments = overrides.instruments ?? [
    {
      instId: 'BTC-USDT',
      instType: 'SPOT',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 1,
    },
  ];
  const horizons = [60_000, 300_000, 900_000, 1_800_000, 3_600_000];
  const data: unknown[] = [];
  let seqId = 10;

  data.push({
    type: 'orderBook',
    recordedAt: EVALUATION_NOW,
    update: {
      instId: instruments[0]?.instId,
      action: 'snapshot',
      bids: [['100', '2', '0', '1']],
      asks: [['101', '3', '0', '1']],
      timestamp: EVALUATION_NOW,
      seqId,
      prevSeqId: -1,
    },
  });

  for (const horizon of horizons) {
    const previous = seqId;
    seqId += 1;
    data.push({
      type: 'orderBook',
      recordedAt: EVALUATION_NOW + horizon,
      update: {
        instId: instruments[0]?.instId,
        action: 'update',
        bids: [],
        asks: [],
        timestamp: EVALUATION_NOW + horizon,
        seqId,
        prevSeqId: previous,
      },
    });
    data.push({
      type: 'candle',
      recordedAt: EVALUATION_NOW + horizon,
      interval: '1m',
      candle: {
        instId: instruments[0]?.instId,
        timestamp: EVALUATION_NOW + horizon - 60_000,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 10,
        volumeCurrency: 1_000,
        volumeCurrencyQuote: 1_000,
        confirm: true,
      },
    });
  }

  const header = {
    recordType: 'header',
    schemaVersion: 1,
    recordedAt: EVALUATION_NOW - 1_000,
    sourceSessionId,
    recordingId,
    startedAt: EVALUATION_NOW - 1_000,
    producer: { name: 'test', version: '1' },
    clockBasis: {
      eventTime: 'UTC_EPOCH_MS',
      availabilityTime: 'UTC_EPOCH_MS',
      arrivalOrder: 'FILE_ORDINAL',
    },
    instruments,
    subscriptions: {
      orderBookChannel: 'books',
      orderBookDepth: 400,
      candleIntervals: ['1m'],
    },
  };
  const lines = [JSON.stringify(header), ...data.map(JSON.stringify)];

  if (overrides.clean ?? true) {
    const orderBookRecords = data.filter(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        'type' in record &&
        record.type === 'orderBook',
    ).length;
    const candleRecords = data.length - orderBookRecords;
    const endedAt = EVALUATION_NOW + 3_600_000;
    lines.push(
      JSON.stringify({
        recordType: 'sessionEnd',
        schemaVersion: 1,
        recordedAt: endedAt,
        sourceSessionId,
        recordingId,
        endedAt,
        status: 'CLEAN',
        counts: {
          instrumentRecords: 0,
          orderBookRecords,
          candleRecords,
        },
        finalFileRecordCount: data.length + 2,
      }),
    );
  }

  return lines;
};

export const createPreparedEvaluationMarket = (
  lines = createEvaluationMarketLines(),
  configuration?: AlertAlignmentEvaluationConfiguration,
): PreparedAlertAlignmentMarketRecording =>
  prepareAlertAlignmentMarketRecording(lines, {
    configuration: configuration
      ? {
          alignment: {
            version: configuration.version,
            horizonsMs: configuration.horizonsMs,
            sourceFallback: configuration.sourceFallback,
            orderBookMaximumEventLatenessMs:
              configuration.orderBookMaximumEventLatenessMs,
            candleMaximumEventLatenessMs:
              configuration.candleMaximumEventLatenessMs,
            localArrivalAllowanceMs: configuration.localArrivalAllowanceMs,
            allowedClockSkewMs: configuration.allowedClockSkewMs,
            legacyReferenceMaximumAgeMs:
              configuration.legacyReferenceMaximumAgeMs,
            minimumValidTimestampMs: configuration.minimumValidTimestampMs,
            maximumValidTimestampMs: configuration.maximumValidTimestampMs,
            maximumFutureOffsetMs: configuration.maximumFutureOffsetMs,
          },
          requestedSources: configuration.requestedSources,
          floatingPointTolerance: configuration.floatingPointTolerance,
        }
      : undefined,
    now: EVALUATION_NOW + 7_200_000,
  });

export const createDefaultEvaluationConfiguration =
  (): AlertAlignmentEvaluationConfiguration =>
    createAlertAlignmentEvaluationConfiguration();
