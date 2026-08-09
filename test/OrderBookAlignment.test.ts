import { describe, expect, it } from 'vitest';

import { createAlignmentConfiguration } from '../src/evaluation/alignmentConfiguration';
import {
  alignAlertsToOrderBooks,
  serializeOrderBookAlignmentResults,
} from '../src/evaluation/orderBookAlignment';
import { normalizeVersionedOrderBookRecordingLines } from '../src/evaluation/orderBookNormalization';
import {
  reconstructOrderBooks,
  type ReconstructedOrderBookRecording,
} from '../src/evaluation/orderBookReconstructor';
import { AlignmentReason } from '../src/evaluation/alignmentTypes';
import type {
  CorrelatedAlertRecordV1,
  CorrelatedAlertRecordV2,
} from '../src/recording/CorrelatedAlertRecorder';

const NOW = Date.UTC(2026, 6, 29, 12);
const SESSION = 'book-session';
const RECORDING_ID = 'market-recording:book-session:test';
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

const book = (
  instrument: string,
  action: 'snapshot' | 'update',
  seqId: number,
  prevSeqId: number,
  eventTimestamp: number,
  bids: string[][] = [],
  asks: string[][] = [],
  recordedAt = eventTimestamp,
) => ({
  type: 'orderBook',
  recordedAt,
  update: {
    instId: instrument,
    action,
    bids,
    asks,
    timestamp: eventTimestamp,
    seqId,
    prevSeqId,
  },
});

const snapshotAt = (
  eventTimestamp: number,
  instrument = SPOT.instId,
  seqId = 10,
  recordedAt = eventTimestamp,
) =>
  book(
    instrument,
    'snapshot',
    seqId,
    -1,
    eventTimestamp,
    [['100', '2', '0', '1']],
    [['101', '3', '0', '1']],
    recordedAt,
  );

const reconstruction = (
  records: readonly unknown[],
  options: {
    clean?: boolean;
    endedAt?: number;
    instruments?: readonly (typeof SPOT | typeof SWAP)[];
  } = {},
): ReconstructedOrderBookRecording => {
  const instruments = options.instruments ?? [SPOT, SWAP];
  const endedAt = options.endedAt ?? NOW + 3_700_000;
  const header = {
    recordType: 'header',
    schemaVersion: 1,
    recordedAt: NOW,
    sourceSessionId: SESSION,
    recordingId: RECORDING_ID,
    startedAt: NOW,
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
  const lines = [
    JSON.stringify(header),
    ...records.map((record) => JSON.stringify(record)),
  ];
  if (options.clean ?? true) {
    lines.push(
      JSON.stringify({
        recordType: 'sessionEnd',
        schemaVersion: 1,
        recordedAt: endedAt,
        sourceSessionId: SESSION,
        recordingId: RECORDING_ID,
        endedAt,
        status: 'CLEAN',
        counts: {
          instrumentRecords: 0,
          orderBookRecords: records.length,
          candleRecords: 0,
        },
        finalFileRecordCount: records.length + 2,
      }),
    );
  }
  const normalized = normalizeVersionedOrderBookRecordingLines(lines, {
    now: NOW + 7_200_000,
  });
  if (!normalized.valid) {
    throw new Error(normalized.primaryReason);
  }
  return reconstructOrderBooks(normalized.value);
};

const alert = (
  overrides: Partial<CorrelatedAlertRecordV2> & {
    instId?: string;
    instType?: 'SPOT' | 'SWAP';
    id?: string;
    referenceTimestamp?: number;
  } = {},
): CorrelatedAlertRecordV2 => {
  const {
    instId = SPOT.instId,
    instType = SPOT.instType,
    id = `correlated-alert:${SESSION}:1`,
    referenceTimestamp = NOW,
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
      id,
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
  alerts: readonly (CorrelatedAlertRecordV1 | CorrelatedAlertRecordV2)[],
  books: ReconstructedOrderBookRecording,
  horizonMs = 60_000,
) =>
  alignAlertsToOrderBooks({
    alertRecords: alerts,
    reconstruction: books,
    configuration: createAlignmentConfiguration({
      horizonsMs: [horizonMs],
    }),
    now: NOW + 7_200_000,
  });

describe('order-book horizon alignment', () => {
  it('emits separate exact-boundary midpoint and bid/ask results', () => {
    const result = align([alert()], reconstruction([snapshotAt(NOW + 60_000)]));

    expect(result.results).toMatchObject([
      {
        source: 'ORDER_BOOK_BID_ASK',
        completeness: 'COMPLETE',
        observationDelayMs: 0,
        selectedObservation: { bestBid: 100, bestAsk: 101 },
      },
      {
        source: 'ORDER_BOOK_MIDPOINT',
        completeness: 'COMPLETE',
        observationDelayMs: 0,
        selectedObservation: { midpoint: 100.5 },
      },
    ]);
  });

  it('selects the first sample after target and never a pre-target sample', () => {
    const result = align(
      [alert()],
      reconstruction([
        snapshotAt(NOW + 59_000),
        snapshotAt(NOW + 61_000, SPOT.instId, 20),
      ]),
    );

    expect(
      result.results.every((entry) => entry.observationDelayMs === 1_000),
    ).toBe(true);
    expect(
      result.results.every(
        (entry) => entry.selectedObservation?.eventTimestamp === NOW + 61_000,
      ),
    ).toBe(true);
  });

  it('rejects excessive event and arrival lateness', () => {
    const eventLate = align(
      [alert()],
      reconstruction([snapshotAt(NOW + 65_001)]),
    );
    const arrivalLate = align(
      [alert()],
      reconstruction([snapshotAt(NOW + 60_000, SPOT.instId, 10, NOW + 70_001)]),
    );

    expect(
      [...eventLate.results, ...arrivalLate.results].every(
        (entry) => entry.primaryReason === AlignmentReason.SAMPLE_TOO_LATE,
      ),
    ).toBe(true);
  });

  it('does not cross a sequence gap or interpolate', () => {
    const books = reconstruction([
      snapshotAt(NOW + 59_000),
      book(SPOT.instId, 'update', 12, 11, NOW + 60_000),
      snapshotAt(NOW + 61_000, SPOT.instId, 20),
    ]);
    const result = align([alert()], books);

    expect(
      result.results.every(
        (entry) => entry.primaryReason === AlignmentReason.SEQUENCE_GAP,
      ),
    ).toBe(true);
    expect(
      result.results.every((entry) => entry.selectedObservation === null),
    ).toBe(true);
  });

  it('accepts the exact recovery snapshot boundary', () => {
    const books = reconstruction([
      snapshotAt(NOW + 59_000),
      book(SPOT.instId, 'update', 12, 11, NOW + 60_000),
      snapshotAt(NOW + 61_000, SPOT.instId, 20),
    ]);
    const result = align([alert()], books, 61_000);

    expect(
      result.results.every(
        (entry) =>
          entry.completeness === 'COMPLETE' && entry.observationDelayMs === 0,
      ),
    ).toBe(true);
  });

  it('marks a later conflicting duplicate ambiguous', () => {
    const first = snapshotAt(NOW + 60_000);
    const conflict = {
      ...first,
      update: {
        ...first.update,
        bids: [['99', '1', '0', '1']],
      },
    };
    const result = align([alert()], reconstruction([first, conflict]));

    expect(
      result.results.every(
        (entry) =>
          entry.completeness === 'AMBIGUOUS' &&
          entry.primaryReason === AlignmentReason.CONFLICTING_DUPLICATE,
      ),
    ).toBe(true);
  });

  it('never falls back to candle data or another source', () => {
    const result = align([alert()], reconstruction([]));

    expect(result.results.map((entry) => entry.source)).toEqual([
      'ORDER_BOOK_BID_ASK',
      'ORDER_BOOK_MIDPOINT',
    ]);
    expect(
      result.results.every(
        (entry) =>
          entry.fallbackUsed === false &&
          entry.primaryReason === AlignmentReason.NO_INITIAL_SNAPSHOT,
      ),
    ).toBe(true);
  });
});

describe('order-book completion and linkage', () => {
  it('distinguishes a clean recording ending before the horizon', () => {
    const result = align(
      [alert()],
      reconstruction([], { endedAt: NOW + 30_000 }),
    );

    expect(
      result.results.every(
        (entry) =>
          entry.primaryReason ===
          AlignmentReason.RECORDING_ENDED_BEFORE_HORIZON,
      ),
    ).toBe(true);
  });

  it('marks valid truncated observations partial and missing ones truncated', () => {
    const present = align(
      [alert()],
      reconstruction([snapshotAt(NOW + 60_000)], { clean: false }),
    );
    const absent = align([alert()], reconstruction([], { clean: false }));

    expect(
      present.results.every(
        (entry) =>
          entry.completeness === 'PARTIAL' &&
          entry.primaryReason === AlignmentReason.RECORDING_TRUNCATED,
      ),
    ).toBe(true);
    expect(
      absent.results.every(
        (entry) =>
          entry.completeness === 'MISSING' &&
          entry.primaryReason === AlignmentReason.RECORDING_TRUNCATED,
      ),
    ).toBe(true);
  });

  it('classifies an open crossed book as invalid', () => {
    const books = reconstruction([
      book(
        SPOT.instId,
        'snapshot',
        10,
        -1,
        NOW + 30_000,
        [['102', '1', '0', '1']],
        [['101', '1', '0', '1']],
      ),
    ]);
    const result = align([alert()], books);

    expect(
      result.results.every(
        (entry) =>
          entry.completeness === 'INVALID' &&
          entry.primaryReason === AlignmentReason.BOOK_INVALID,
      ),
    ).toBe(true);
  });

  it('requires matching session and instrument metadata', () => {
    const books = reconstruction([snapshotAt(NOW + 60_000)]);
    const wrongSession = alert({
      sourceSessionId: 'other-session',
      alert: {
        ...alert().alert,
        sourceSessionId: 'other-session',
        id: 'correlated-alert:other-session:1',
      },
    });
    const absentInstrument = alert({
      instId: 'XRP-USDT',
      id: `correlated-alert:${SESSION}:2`,
    });
    const typeConflict = alert({
      instType: 'SWAP',
      id: `correlated-alert:${SESSION}:3`,
    });

    expect(align([wrongSession], books).results[0]?.primaryReason).toBe(
      AlignmentReason.NO_MATCHING_MARKET_SESSION,
    );
    expect(align([absentInstrument], books).results[0]?.primaryReason).toBe(
      AlignmentReason.INSTRUMENT_MISMATCH,
    );
    expect(align([typeConflict], books).results[0]?.primaryReason).toBe(
      AlignmentReason.INSTRUMENT_METADATA_CONFLICT,
    );
  });

  it('keeps SPOT and SWAP observations isolated', () => {
    const books = reconstruction([
      snapshotAt(NOW + 60_000),
      book(
        SWAP.instId,
        'snapshot',
        10,
        -1,
        NOW + 60_000,
        [['200', '1', '0', '1']],
        [['202', '1', '0', '1']],
      ),
    ]);
    const swapAlert = alert({
      instId: SWAP.instId,
      instType: 'SWAP',
      id: `correlated-alert:${SESSION}:2`,
      alertSequence: 2,
      alert: {
        ...alert().alert,
        id: `correlated-alert:${SESSION}:2`,
        alertSequence: 2,
        symbol: SWAP.instId,
      },
    });
    const result = align([swapAlert, alert()], books);

    expect(
      result.results.map((entry) => [
        entry.alertId,
        entry.source,
        entry.selectedObservation?.midpoint ??
          entry.selectedObservation?.bestBid,
      ]),
    ).toEqual([
      [`correlated-alert:${SESSION}:1`, 'ORDER_BOOK_BID_ASK', 100],
      [`correlated-alert:${SESSION}:1`, 'ORDER_BOOK_MIDPOINT', 100.5],
      [`correlated-alert:${SESSION}:2`, 'ORDER_BOOK_BID_ASK', 200],
      [`correlated-alert:${SESSION}:2`, 'ORDER_BOOK_MIDPOINT', 201],
    ]);
  });

  it('refuses legacy alerts without inferred linkage', () => {
    const legacy: CorrelatedAlertRecordV1 = {
      schemaVersion: 1,
      recordedAt: NOW,
      alert: {
        ...alert().alert,
        id: 'legacy-alert',
        sourceSessionId: undefined,
        alertSequence: undefined,
      },
    };

    expect(align([legacy], reconstruction([])).rejectedAlerts[0]).toMatchObject(
      {
        completeness: 'MISSING',
        primaryReason: AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
      },
    );
  });
});

describe('order-book alignment determinism', () => {
  it('produces stable ordering and byte-identical serialization', () => {
    const books = reconstruction([snapshotAt(NOW + 60_000)]);
    const first = align([alert()], books);
    const second = align([alert()], books);

    expect(serializeOrderBookAlignmentResults(first.results)).toBe(
      serializeOrderBookAlignmentResults(second.results),
    );
  });
});
