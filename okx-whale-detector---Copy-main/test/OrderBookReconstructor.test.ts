import { describe, expect, it } from 'vitest';

import { normalizeVersionedOrderBookRecordingLines } from '../src/evaluation/orderBookNormalization';
import {
  reconstructOrderBooks,
  type ReconstructedOrderBookRecording,
} from '../src/evaluation/orderBookReconstructor';
import { AlignmentReason } from '../src/evaluation/alignmentTypes';

const NOW = Date.UTC(2026, 6, 29, 12);
const INSTRUMENT = {
  instId: 'BTC-USDT',
  instType: 'SPOT',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
} as const;

const header = {
  recordType: 'header',
  schemaVersion: 1,
  recordedAt: NOW,
  sourceSessionId: 'book-session',
  recordingId: 'market-recording:book-session:test',
  startedAt: NOW,
  producer: { name: 'test', version: '1' },
  clockBasis: {
    eventTime: 'UTC_EPOCH_MS',
    availabilityTime: 'UTC_EPOCH_MS',
    arrivalOrder: 'FILE_ORDINAL',
  },
  instruments: [INSTRUMENT],
  subscriptions: {
    orderBookChannel: 'books',
    orderBookDepth: 400,
    candleIntervals: ['1m'],
  },
};

const record = (
  action: 'snapshot' | 'update',
  seqId: number,
  prevSeqId: number,
  offset: number,
  bids: string[][] = [],
  asks: string[][] = [],
  overrides: Record<string, unknown> = {},
) => ({
  type: 'orderBook',
  recordedAt: NOW + offset,
  update: {
    instId: INSTRUMENT.instId,
    action,
    bids,
    asks,
    timestamp: NOW + offset,
    seqId,
    prevSeqId,
  },
  ...overrides,
});

const snapshot = (
  offset = 1_000,
  seqId = 10,
  bids: string[][] = [['100', '2', '0', '1']],
  asks: string[][] = [['101', '3', '0', '1']],
) => record('snapshot', seqId, -1, offset, bids, asks);

const reconstruct = (
  records: readonly unknown[],
  clean = true,
): ReconstructedOrderBookRecording => {
  const endedAt = NOW + 3_600_000;
  const lines = [
    JSON.stringify(header),
    ...records.map((entry) => JSON.stringify(entry)),
  ];
  if (clean) {
    lines.push(
      JSON.stringify({
        recordType: 'sessionEnd',
        schemaVersion: 1,
        recordedAt: endedAt,
        sourceSessionId: header.sourceSessionId,
        recordingId: header.recordingId,
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

const midpointObservations = (result: ReconstructedOrderBookRecording) =>
  result.observations.filter(
    (observation) => observation.source === 'ORDER_BOOK_MIDPOINT',
  );

describe('offline order-book snapshot reconstruction', () => {
  it('establishes synchronization and emits correct independent observations', () => {
    const result = reconstruct([snapshot()]);

    expect(result.finalStates[0]).toMatchObject({
      transportState: 'SYNCHRONIZED',
      priceValidity: 'VALID',
      lastSeqId: 10,
      sawValidSnapshot: true,
    });
    expect(result.observations).toMatchObject([
      {
        source: 'ORDER_BOOK_BID_ASK',
        bestBid: 100,
        bestAsk: 101,
      },
      {
        source: 'ORDER_BOOK_MIDPOINT',
        midpoint: 100.5,
      },
    ]);
  });

  it('atomically replaces snapshot state and retains complete depth', () => {
    const deepBids = Array.from({ length: 401 }, (_, index) => [
      String(100 - index / 100),
      '1',
      '0',
      '1',
    ]);
    const result = reconstruct([
      snapshot(1_000, 10, deepBids, [['101', '1', '0', '1']]),
      snapshot(2_000, 20, [['90', '1', '0', '1']], [['91', '1', '0', '1']]),
    ]);

    expect(result.finalStates[0]).toMatchObject({
      retainedBidLevels: 1,
      retainedAskLevels: 1,
      lastSeqId: 20,
    });
    expect(midpointObservations(result).map((value) => value.midpoint)).toEqual(
      [100.5, 90.5],
    );

    const retained = reconstruct([
      snapshot(1_000, 10, deepBids, [['101', '1', '0', '1']]),
    ]);
    expect(retained.finalStates[0]?.retainedBidLevels).toBe(401);
  });

  it('marks malformed snapshots invalid and recovers only on a valid snapshot', () => {
    const malformed = snapshot(1_000, 10, [['-1', '1', '0', '1']]);
    const ignoredDelta = record('update', 11, 10, 2_000, [
      ['100', '1', '0', '1'],
    ]);
    const recovery = snapshot(3_000, 20);
    const result = reconstruct([malformed, ignoredDelta, recovery]);

    expect(midpointObservations(result)).toHaveLength(1);
    expect(midpointObservations(result)[0]?.eventTimestamp).toBe(NOW + 3_000);
    expect(result.validityGaps[0]).toMatchObject({
      reason: AlignmentReason.BOOK_INVALID,
      startTimestamp: NOW + 1_000,
      endTimestamp: NOW + 3_000,
    });
  });

  it.each([
    [[], [['101', '1', '0', '1']], 'EMPTY_SIDE'],
    [[['102', '1', '0', '1']], [['101', '1', '0', '1']], 'CROSSED'],
  ])(
    'emits no observation for %s/%s snapshot sides',
    (bids, asks, validity) => {
      const result = reconstruct([snapshot(1_000, 10, bids, asks)]);

      expect(result.observations).toEqual([]);
      expect(result.finalStates[0]?.priceValidity).toBe(validity);
    },
  );

  it('accepts a zero-spread snapshot', () => {
    const result = reconstruct([
      snapshot(1_000, 10, [['100', '1', '0', '1']], [['100', '1', '0', '1']]),
    ]);

    expect(midpointObservations(result)[0]?.midpoint).toBe(100);
    expect(result.finalStates[0]?.priceValidity).toBe('VALID');
  });
});

describe('offline order-book delta reconstruction', () => {
  it('applies insertions, replacements, removals, and untouched levels', () => {
    const result = reconstruct([
      snapshot(
        1_000,
        10,
        [
          ['100', '1', '0', '1'],
          ['99', '1', '0', '1'],
        ],
        [
          ['101', '1', '0', '1'],
          ['102', '1', '0', '1'],
        ],
      ),
      record(
        'update',
        11,
        10,
        2_000,
        [
          ['100', '0', '0', '0'],
          ['99', '3', '0', '1'],
          ['100.5', '2', '0', '1'],
        ],
        [['101', '0', '0', '0']],
      ),
    ]);

    expect(result.finalStates[0]).toMatchObject({
      transportState: 'SYNCHRONIZED',
      retainedBidLevels: 2,
      retainedAskLevels: 1,
      lastSeqId: 11,
    });
    expect(result.observations.slice(-2)).toMatchObject([
      { source: 'ORDER_BOOK_BID_ASK', bestBid: 100.5, bestAsk: 102 },
      { source: 'ORDER_BOOK_MIDPOINT', midpoint: 101.25 },
    ]);
  });

  it('allows a later delta to repair a crossed book', () => {
    const result = reconstruct([
      snapshot(1_000, 10, [['102', '1', '0', '1']], [['101', '1', '0', '1']]),
      record('update', 11, 10, 2_000, [
        ['102', '0', '0', '0'],
        ['100', '1', '0', '1'],
      ]),
    ]);

    expect(midpointObservations(result)).toHaveLength(1);
    expect(result.validityGaps[0]).toMatchObject({
      reason: AlignmentReason.BOOK_INVALID,
      startTimestamp: NOW + 1_000,
      endTimestamp: NOW + 2_000,
    });
  });

  it('opens a sequence gap, ignores deltas, and resumes at recovery snapshot', () => {
    const result = reconstruct([
      snapshot(),
      record('update', 12, 11, 2_000),
      record('update', 13, 12, 3_000, [['105', '1', '0', '1']]),
      snapshot(4_000, 20),
    ]);

    expect(
      midpointObservations(result).map((value) => value.eventTimestamp),
    ).toEqual([NOW + 1_000, NOW + 4_000]);
    expect(result.validityGaps[0]).toMatchObject({
      reason: AlignmentReason.SEQUENCE_GAP,
      startTimestamp: NOW + 2_000,
      endTimestamp: NOW + 4_000,
    });
  });

  it('ignores a delta before the first snapshot', () => {
    const result = reconstruct([
      record('update', 11, 10, 1_000),
      snapshot(2_000, 20),
    ]);

    expect(midpointObservations(result)).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      reason: AlignmentReason.NO_INITIAL_SNAPSHOT,
      startTimestamp: NOW + 1_000,
      endTimestamp: NOW + 2_000,
    });
  });

  it.each([
    [10, 10, AlignmentReason.EVENT_TIME_OUT_OF_ORDER],
    [11, 9, AlignmentReason.SEQUENCE_GAP],
  ])(
    'stops on invalid continuity seq=%s prev=%s',
    (seqId, prevSeqId, reason) => {
      const result = reconstruct([
        snapshot(),
        record('update', seqId, prevSeqId, 2_000),
      ]);

      expect(result.finalStates[0]?.transportState).toBe('GAP_DETECTED');
      expect(result.validityGaps[0]?.reason).toBe(reason);
    },
  );
});

describe('duplicate and arrival-order handling', () => {
  it('coalesces exact duplicate snapshots and deltas', () => {
    const update = record('update', 11, 10, 2_000, [['100.5', '1', '0', '1']]);
    const result = reconstruct([snapshot(), snapshot(), update, update]);

    expect(result.exactDuplicateCount).toBe(2);
    expect(midpointObservations(result)).toHaveLength(2);
  });

  it.each(['snapshot', 'update'] as const)(
    'marks conflicting duplicate %s records ambiguous',
    (action) => {
      const first =
        action === 'snapshot'
          ? snapshot()
          : record('update', 11, 10, 2_000, [['100.5', '1', '0', '1']]);
      const conflict = {
        ...first,
        update: {
          ...first.update,
          bids: [['105', '1', '0', '1']],
        },
      };
      const result = reconstruct([
        ...(action === 'update' ? [snapshot()] : []),
        first,
        conflict,
      ]);

      expect(result.finalStates[0]?.transportState).toBe('INVALID');
      expect(result.issues.at(-1)).toMatchObject({
        reason: AlignmentReason.CONFLICTING_DUPLICATE,
        completeness: 'AMBIGUOUS',
      });
    },
  );

  it('does not reorder an advancing sequence with regressing event time', () => {
    const result = reconstruct([
      snapshot(2_000, 10),
      record('update', 11, 10, 1_500),
    ]);

    expect(midpointObservations(result)).toHaveLength(1);
    expect(result.validityGaps[0]).toMatchObject({
      reason: AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
      startTimestamp: NOW + 1_500,
    });
  });

  it('orders same-event observations by availability and ordinal', () => {
    const second = record('update', 11, 10, 1_000, [], [], {
      recordedAt: NOW + 1_100,
    });
    const result = reconstruct([snapshot(), second]);

    expect(
      midpointObservations(result).map((value) => [
        value.availabilityTimestamp,
        value.recordOrdinal,
      ]),
    ).toEqual([
      [NOW + 1_000, 2],
      [NOW + 1_100, 3],
    ]);
  });

  it('leaves an open-ended truncation gap at file end', () => {
    const result = reconstruct([snapshot()], false);

    expect(result.validityGaps.at(-1)).toMatchObject({
      reason: AlignmentReason.RECORDING_TRUNCATED,
      startTimestamp: NOW + 1_001,
    });
  });
});
