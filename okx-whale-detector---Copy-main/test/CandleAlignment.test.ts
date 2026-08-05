import { describe, expect, it } from 'vitest';

import {
  createAlignmentConfiguration,
  DEFAULT_ALIGNMENT_CONFIGURATION,
} from '../src/evaluation/alignmentConfiguration';
import {
  alignAlertsToConfirmedCandles,
  serializeCandleAlignmentResults,
} from '../src/evaluation/candleAlignment';
import {
  normalizeVersionedCandleRecordingLines,
  type NormalizedCandleRecording,
} from '../src/evaluation/candleNormalization';
import { AlignmentReason } from '../src/evaluation/alignmentTypes';
import type {
  CorrelatedAlertRecordV1,
  CorrelatedAlertRecordV2,
} from '../src/recording/CorrelatedAlertRecorder';
import type { CorrelatedAlertProvenance } from '../src/types/correlatedAlertEvaluation';

const NOW = Date.UTC(2026, 6, 29, 12);
const SESSION = 'alignment-session';
const RECORDING_ID = 'market-recording:alignment-session:test';
const SPOT = {
  instId: 'BTC-USDT',
  instType: 'SPOT',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
} as const;
const SWAP = {
  instId: 'ETH-USDT-SWAP',
  instType: 'SWAP',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 0.01,
} as const;

const header = (overrides: Record<string, unknown> = {}) => ({
  recordType: 'header',
  schemaVersion: 1,
  recordedAt: NOW,
  sourceSessionId: SESSION,
  recordingId: RECORDING_ID,
  startedAt: NOW,
  producer: { name: 'test', version: '1.0.0' },
  clockBasis: {
    eventTime: 'UTC_EPOCH_MS',
    availabilityTime: 'UTC_EPOCH_MS',
    arrivalOrder: 'FILE_ORDINAL',
  },
  instruments: [SPOT, SWAP],
  subscriptions: {
    orderBookChannel: 'books',
    orderBookDepth: 400,
    candleIntervals: ['1m'],
  },
  ...overrides,
});

const candleEndingAt = (
  intervalEnd: number,
  overrides: Record<string, unknown> = {},
) => ({
  type: 'candle',
  recordedAt: intervalEnd,
  interval: '1m',
  candle: {
    instId: SPOT.instId,
    timestamp: intervalEnd - 60_000,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 10,
    volumeCurrency: 1_000,
    volumeCurrencyQuote: 1_000,
    confirm: true,
  },
  ...overrides,
});

const normalizedRecording = (
  records: readonly unknown[],
  options: {
    clean?: boolean;
    headerOverrides?: Record<string, unknown>;
    endedAt?: number;
  } = {},
): NormalizedCandleRecording => {
  const clean = options.clean ?? true;
  const endedAt = options.endedAt ?? NOW + 3_700_000;
  const lines = [
    JSON.stringify(header(options.headerOverrides)),
    ...records.map((record) => JSON.stringify(record)),
  ];

  if (clean) {
    lines.push(
      JSON.stringify({
        recordType: 'sessionEnd',
        schemaVersion: 1,
        recordedAt: endedAt,
        sourceSessionId: options.headerOverrides?.sourceSessionId ?? SESSION,
        recordingId: options.headerOverrides?.recordingId ?? RECORDING_ID,
        endedAt,
        status: 'CLEAN',
        counts: {
          instrumentRecords: 0,
          orderBookRecords: 0,
          candleRecords: records.length,
        },
        finalFileRecordCount: records.length + 2,
      }),
    );
  }

  const result = normalizeVersionedCandleRecordingLines(lines, {
    now: NOW + 7_200_000,
  });
  if (!result.valid) {
    throw new Error(`Invalid test recording: ${result.primaryReason}`);
  }

  return result.value;
};

const versionedAlert = (
  overrides: Partial<CorrelatedAlertRecordV2> & {
    instId?: string;
    instType?: 'SPOT' | 'SWAP';
    referenceTimestamp?: number;
    alertId?: string;
  } = {},
): CorrelatedAlertRecordV2 => {
  const {
    instId = SPOT.instId,
    instType = SPOT.instType,
    referenceTimestamp = NOW,
    alertId = `correlated-alert:${SESSION}:1`,
    ...recordOverrides
  } = overrides;

  return {
    schemaVersion: 2,
    recordedAt: NOW,
    sourceSessionId: SESSION,
    alertSequence: 1,
    semanticFingerprint: 'a'.repeat(64),
    provenance: 'LIVE',
    alert: {
      id: alertId,
      sourceSessionId: SESSION,
      alertSequence: 1,
      symbol: instId,
      severity: 'STRONG',
      eventType: 'AGREEMENT',
      bias: 'BULLISH',
      relationship: 'AGREEMENT',
      combinedConfidence: 80,
      alertImportance: 85,
      okxConfidence: 80,
      externalEffectiveConfidence: 70,
      externalSignalsUsed: 1,
      ignoredExternalSignals: 0,
      reason: 'test',
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
      referenceMidpoint: 100.5,
      referenceBestBid: 100,
      referenceBestAsk: 101,
      referenceSpread: 1,
      referenceSpreadPercent: (1 / 100.5) * 100,
    },
    ...recordOverrides,
  };
};

const align = (
  alertRecords: Parameters<
    typeof alignAlertsToConfirmedCandles
  >[0]['alertRecords'],
  recording: NormalizedCandleRecording,
  overrides: Partial<Parameters<typeof alignAlertsToConfirmedCandles>[0]> = {},
) =>
  alignAlertsToConfirmedCandles({
    alertRecords,
    recording,
    configuration: DEFAULT_ALIGNMENT_CONFIGURATION,
    interval: '1m',
    now: NOW + 7_200_000,
    ...overrides,
  });

describe('terminal confirmed-candle horizon alignment', () => {
  it('aligns the default 1m, 5m, 15m, 30m, and 60m horizons', () => {
    const horizons = DEFAULT_ALIGNMENT_CONFIGURATION.horizonsMs;
    const recording = normalizedRecording(
      horizons.map((horizon) => candleEndingAt(NOW + horizon)),
    );
    const result = align([versionedAlert()], recording);

    expect(result.rejectedAlerts).toEqual([]);
    expect(result.results.map((entry) => entry.horizonMs)).toEqual(horizons);
    expect(
      result.results.map((entry) => ({
        completeness: entry.completeness,
        targetTimestamp: entry.targetTimestamp,
        eventTimestamp: entry.selectedObservation?.eventTimestamp,
        close: entry.selectedObservation?.close,
      })),
    ).toEqual(
      horizons.map((horizon) => ({
        completeness: 'COMPLETE',
        targetTimestamp: NOW + horizon,
        eventTimestamp: NOW + horizon,
        close: 101,
      })),
    );
  });

  it('uses the first confirmed close after a target and never a pre-target candle', () => {
    const configuration = createAlignmentConfiguration({
      horizonsMs: [30_000],
    });
    const recording = normalizedRecording([
      candleEndingAt(NOW),
      candleEndingAt(NOW + 60_000),
    ]);
    const result = align([versionedAlert()], recording, { configuration });

    expect(result.results[0]).toMatchObject({
      completeness: 'COMPLETE',
      targetTimestamp: NOW + 30_000,
      observationDelayMs: 30_000,
      selectedObservation: {
        eventTimestamp: NOW + 60_000,
        close: 101,
      },
    });
  });

  it('never selects a forming candle or high/low as terminal price', () => {
    const recording = normalizedRecording([
      candleEndingAt(NOW + 60_000, {
        candle: {
          ...candleEndingAt(NOW + 60_000).candle,
          close: 100,
          high: 150,
          low: 50,
          confirm: false,
        },
      }),
      candleEndingAt(NOW + 120_000, {
        candle: {
          ...candleEndingAt(NOW + 120_000).candle,
          close: 102,
          high: 160,
          low: 40,
        },
      }),
    ]);
    const result = align([versionedAlert()], recording, {
      configuration: createAlignmentConfiguration({
        horizonsMs: [60_000],
      }),
    });

    expect(result.results[0]?.selectedObservation).toMatchObject({
      close: 102,
      eventTimestamp: NOW + 120_000,
    });
    expect(result.results[0]?.selectedObservation?.close).not.toBe(160);
    expect(result.results[0]?.selectedObservation?.close).not.toBe(40);
  });

  it('tracks delayed arrival and rejects excessive arrival lateness', () => {
    const allowed = normalizedRecording([
      candleEndingAt(NOW + 60_000, {
        recordedAt: NOW + 70_000,
      }),
    ]);
    const excessive = normalizedRecording([
      candleEndingAt(NOW + 60_000, {
        recordedAt: NOW + 70_001,
      }),
    ]);
    const configuration = createAlignmentConfiguration({
      horizonsMs: [60_000],
    });

    expect(
      align([versionedAlert()], allowed, { configuration }).results[0],
    ).toMatchObject({
      completeness: 'COMPLETE',
      availabilityDelayMs: 10_000,
    });
    expect(
      align([versionedAlert()], excessive, { configuration }).results[0],
    ).toMatchObject({
      completeness: 'MISSING',
      primaryReason: AlignmentReason.SAMPLE_TOO_LATE,
      selectedObservation: null,
    });
  });

  it('rejects excessive candle event lateness', () => {
    const recording = normalizedRecording([candleEndingAt(NOW + 120_001)]);
    const result = align([versionedAlert()], recording, {
      configuration: createAlignmentConfiguration({
        horizonsMs: [60_000],
      }),
    });

    expect(result.results[0]).toMatchObject({
      completeness: 'MISSING',
      primaryReason: AlignmentReason.SAMPLE_TOO_LATE,
    });
  });

  it('returns an invalid result when target calculation overflows policy bounds', () => {
    const recording = normalizedRecording([], { clean: false });
    const configuration = createAlignmentConfiguration({
      horizonsMs: [60_000],
      maximumValidTimestampMs: NOW + 30_000,
    });
    const result = align([versionedAlert()], recording, { configuration });

    expect(result.results[0]).toMatchObject({
      completeness: 'INVALID',
      primaryReason: AlignmentReason.TIMESTAMP_RANGE_INVALID,
      targetTimestamp: null,
    });
  });

  it('marks conflicting confirmed duplicates ambiguous', () => {
    const first = candleEndingAt(NOW + 60_000);
    const recording = normalizedRecording([
      first,
      candleEndingAt(NOW + 60_000, {
        candle: { ...first.candle, close: 101.5 },
      }),
    ]);
    const result = align([versionedAlert()], recording, {
      configuration: createAlignmentConfiguration({
        horizonsMs: [60_000],
      }),
    });

    expect(result.results[0]).toMatchObject({
      completeness: 'AMBIGUOUS',
      primaryReason: AlignmentReason.CONFLICTING_DUPLICATE,
      selectedObservation: null,
    });
  });
});

describe('recording completion and linkage', () => {
  const oneMinuteConfiguration = createAlignmentConfiguration({
    horizonsMs: [60_000],
  });

  it('distinguishes clean end-before-horizon from missing samples', () => {
    const ended = normalizedRecording([], {
      endedAt: NOW + 30_000,
    });
    const noSample = normalizedRecording([], {
      endedAt: NOW + 120_000,
    });

    expect(
      align([versionedAlert()], ended, {
        configuration: oneMinuteConfiguration,
      }).results[0],
    ).toMatchObject({
      completeness: 'MISSING',
      primaryReason: AlignmentReason.RECORDING_ENDED_BEFORE_HORIZON,
    });
    expect(
      align([versionedAlert()], noSample, {
        configuration: oneMinuteConfiguration,
      }).results[0],
    ).toMatchObject({
      completeness: 'MISSING',
      primaryReason: AlignmentReason.NO_SAMPLE_AFTER_HORIZON,
    });
  });

  it('marks no-sample truncation missing and a valid truncated sample partial', () => {
    const missing = normalizedRecording([], { clean: false });
    const present = normalizedRecording([candleEndingAt(NOW + 60_000)], {
      clean: false,
    });

    expect(
      align([versionedAlert()], missing, {
        configuration: oneMinuteConfiguration,
      }).results[0],
    ).toMatchObject({
      completeness: 'MISSING',
      primaryReason: AlignmentReason.RECORDING_TRUNCATED,
    });
    expect(
      align([versionedAlert()], present, {
        configuration: oneMinuteConfiguration,
      }).results[0],
    ).toMatchObject({
      completeness: 'PARTIAL',
      primaryReason: AlignmentReason.RECORDING_TRUNCATED,
      selectedObservation: { close: 101 },
    });
  });

  it('requires matching session identity and preserves recording identity', () => {
    const recording = normalizedRecording([candleEndingAt(NOW + 60_000)]);
    const mismatch = versionedAlert({
      sourceSessionId: 'other-session',
      alert: {
        ...versionedAlert().alert,
        sourceSessionId: 'other-session',
        id: 'correlated-alert:other-session:1',
      },
    });

    expect(
      align([versionedAlert()], recording, {
        configuration: oneMinuteConfiguration,
      }).results[0],
    ).toMatchObject({
      completeness: 'COMPLETE',
      sourceSessionId: SESSION,
      recordingId: RECORDING_ID,
    });
    expect(
      align([mismatch], recording, {
        configuration: oneMinuteConfiguration,
      }).results[0],
    ).toMatchObject({
      completeness: 'MISSING',
      primaryReason: AlignmentReason.NO_MATCHING_MARKET_SESSION,
    });
  });

  it('rejects instrument and SPOT/SWAP metadata mismatches', () => {
    const recording = normalizedRecording([candleEndingAt(NOW + 60_000)]);
    const absent = versionedAlert({
      instId: 'XRP-USDT',
      alertId: `correlated-alert:${SESSION}:2`,
    });
    const typeConflict = versionedAlert({
      instType: 'SWAP',
      alertId: `correlated-alert:${SESSION}:3`,
    });

    expect(
      align([absent], recording, {
        configuration: oneMinuteConfiguration,
      }).results[0],
    ).toMatchObject({
      primaryReason: AlignmentReason.INSTRUMENT_MISMATCH,
    });
    expect(
      align([typeConflict], recording, {
        configuration: oneMinuteConfiguration,
      }).results[0],
    ).toMatchObject({
      completeness: 'AMBIGUOUS',
      primaryReason: AlignmentReason.INSTRUMENT_METADATA_CONFLICT,
    });
  });

  it('refuses schema v1 alerts and undeclared intervals without inference', () => {
    const legacy: CorrelatedAlertRecordV1 = {
      schemaVersion: 1,
      recordedAt: NOW,
      alert: {
        ...versionedAlert().alert,
        id: 'legacy-alert',
        sourceSessionId: undefined,
        alertSequence: undefined,
      },
    };
    const recording = normalizedRecording([candleEndingAt(NOW + 60_000)]);

    expect(align([legacy], recording).rejectedAlerts[0]).toMatchObject({
      completeness: 'MISSING',
      primaryReason: AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
    });
    expect(
      align([versionedAlert()], recording, { interval: '5m' })
        .rejectedAlerts[0],
    ).toMatchObject({
      completeness: 'INVALID',
      primaryReason: AlignmentReason.CANDLE_INTERVAL_UNKNOWN,
    });
  });
});

describe('determinism and provenance', () => {
  it.each<CorrelatedAlertProvenance>(['LIVE', 'SIMULATION', 'REPLAY'])(
    'supports parsed v2 %s provenance',
    (provenance) => {
      const recording = normalizedRecording([candleEndingAt(NOW + 60_000)]);
      const result = align([versionedAlert({ provenance })], recording, {
        configuration: createAlignmentConfiguration({
          horizonsMs: [60_000],
        }),
      });

      expect(result.results[0]?.completeness).toBe('COMPLETE');
    },
  );

  it('isolates multiple alerts and instruments with deterministic serialization', () => {
    const swapCandle = candleEndingAt(NOW + 60_000, {
      candle: {
        ...candleEndingAt(NOW + 60_000).candle,
        instId: SWAP.instId,
        open: 200,
        high: 202,
        low: 199,
        close: 201,
      },
    });
    const recording = normalizedRecording([
      swapCandle,
      candleEndingAt(NOW + 60_000),
    ]);
    const alerts = [
      versionedAlert({
        instId: SWAP.instId,
        instType: 'SWAP',
        alertId: `correlated-alert:${SESSION}:2`,
        alertSequence: 2,
        alert: {
          ...versionedAlert().alert,
          id: `correlated-alert:${SESSION}:2`,
          alertSequence: 2,
          symbol: SWAP.instId,
        },
      }),
      versionedAlert(),
    ];
    const configuration = createAlignmentConfiguration({
      horizonsMs: [60_000],
    });
    const first = align(alerts, recording, { configuration });
    const second = align(alerts, recording, { configuration });

    expect(
      first.results.map((result) => [
        result.alertId,
        result.instrument.instId,
        result.selectedObservation?.close,
      ]),
    ).toEqual([
      [`correlated-alert:${SESSION}:1`, SPOT.instId, 101],
      [`correlated-alert:${SESSION}:2`, SWAP.instId, 201],
    ]);
    expect(serializeCandleAlignmentResults(first.results)).toBe(
      serializeCandleAlignmentResults(second.results),
    );
  });
});
