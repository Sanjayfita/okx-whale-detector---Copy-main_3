import { describe, expect, it } from 'vitest';

import { normalizeVersionedOrderBookRecordingLines } from '../src/evaluation/orderBookNormalization';
import { AlignmentReason } from '../src/evaluation/alignmentTypes';

const NOW = Date.UTC(2026, 6, 29, 12);
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
  sourceSessionId: 'book-session',
  recordingId: 'market-recording:book-session:test',
  startedAt: NOW,
  producer: { name: 'test', version: '1' },
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

const book = (overrides: Record<string, unknown> = {}) => ({
  type: 'orderBook',
  recordedAt: NOW + 1_000,
  update: {
    instId: SPOT.instId,
    action: 'snapshot',
    bids: [['100', '2', '0', '1']],
    asks: [['101', '3', '0', '1']],
    timestamp: NOW + 1_000,
    seqId: 10,
    prevSeqId: -1,
  },
  ...overrides,
});

const footer = (
  orderBookRecords: number,
  finalFileRecordCount = orderBookRecords + 2,
  overrides: Record<string, unknown> = {},
) => ({
  recordType: 'sessionEnd',
  schemaVersion: 1,
  recordedAt: NOW + 3_600_000,
  sourceSessionId: 'book-session',
  recordingId: 'market-recording:book-session:test',
  endedAt: NOW + 3_600_000,
  status: 'CLEAN',
  counts: {
    instrumentRecords: 0,
    orderBookRecords,
    candleRecords: 0,
  },
  finalFileRecordCount,
  ...overrides,
});

const normalize = (
  records: readonly unknown[],
  clean = true,
  headerOverrides: Record<string, unknown> = {},
) =>
  normalizeVersionedOrderBookRecordingLines(
    [
      JSON.stringify(header(headerOverrides)),
      ...records.map((record) => JSON.stringify(record)),
      ...(clean
        ? [JSON.stringify(footer(records.length, records.length + 2))]
        : []),
    ],
    { now: NOW + 7_200_000 },
  );

describe('versioned order-book normalization', () => {
  it('normalizes a valid snapshot with authoritative timing and identity', () => {
    expect(normalize([book()])).toMatchObject({
      valid: true,
      value: {
        termination: 'CLEAN',
        entries: [
          {
            valid: true,
            record: {
              instrument: { instId: 'BTC-USDT', instType: 'SPOT' },
              action: 'snapshot',
              eventTimestamp: NOW + 1_000,
              availabilityTimestamp: NOW + 1_000,
              recordOrdinal: 2,
              sourceSessionId: 'book-session',
              recordingId: 'market-recording:book-session:test',
              bids: [{ price: 100, size: 2 }],
              asks: [{ price: 101, size: 3 }],
            },
          },
        ],
      },
    });
  });

  it('normalizes updates and retains zero-size deletions', () => {
    const result = normalize([
      book({
        update: {
          ...book().update,
          action: 'update',
          seqId: 11,
          prevSeqId: 10,
          bids: [['100', '0', '0', '0']],
        },
      }),
    ]);

    expect(result).toMatchObject({
      valid: true,
      value: {
        records: [
          {
            action: 'update',
            seqId: 11,
            prevSeqId: 10,
            bids: [{ price: 100, size: 0 }],
          },
        ],
      },
    });
  });

  it('preserves SWAP identity from header metadata', () => {
    const result = normalize([
      book({
        update: {
          ...book().update,
          instId: SWAP.instId,
        },
      }),
    ]);

    expect(result).toMatchObject({
      valid: true,
      value: {
        records: [
          {
            instrument: {
              instId: 'ETH-USDT-SWAP',
              instType: 'SWAP',
            },
          },
        ],
      },
    });
  });

  it.each([
    { bids: [['-1', '2', '0', '1']] },
    { bids: [['NaN', '2', '0', '1']] },
    { bids: [['100', '-1', '0', '1']] },
  ])('retains an auditable invalid entry for malformed levels', ({ bids }) => {
    const result = normalize([
      book({
        update: { ...book().update, bids },
      }),
    ]);

    expect(result).toMatchObject({
      valid: true,
      value: {
        records: [],
        entries: [
          {
            valid: false,
            instrument: { instId: SPOT.instId, instType: 'SPOT' },
            failure: { primaryReason: AlignmentReason.BOOK_INVALID },
          },
        ],
      },
    });
  });

  it.each([
    { seqId: -1, prevSeqId: -1 },
    { seqId: 11, prevSeqId: -1, action: 'update' },
  ])('retains invalid sequence metadata as a typed entry', (sequence) => {
    const result = normalize([
      book({
        update: { ...book().update, ...sequence },
      }),
    ]);

    expect(result).toMatchObject({
      valid: true,
      value: {
        entries: [
          {
            valid: false,
            failure: {
              primaryReason: AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
            },
          },
        ],
      },
    });
  });

  it('reports an instrument mismatch without suffix inference', () => {
    const result = normalize([
      book({
        update: { ...book().update, instId: 'XRP-USDT' },
      }),
    ]);

    expect(result).toMatchObject({
      valid: false,
      completeness: 'MISSING',
      primaryReason: AlignmentReason.INSTRUMENT_MISMATCH,
    });
  });

  it('rejects impossible exchange/local timestamp ordering', () => {
    expect(
      normalize([
        book({
          recordedAt: NOW + 1_000,
          update: {
            ...book().update,
            timestamp: NOW + 6_001,
          },
        }),
      ]),
    ).toMatchObject({
      valid: true,
      value: {
        entries: [
          {
            valid: false,
            failure: {
              primaryReason: AlignmentReason.CLOCK_SKEW_INVALID,
            },
          },
        ],
      },
    });
  });

  it('classifies clean and truncated streams without sorting records', () => {
    const first = book();
    const second = book({
      recordedAt: NOW + 2_000,
      update: {
        ...book().update,
        action: 'update',
        timestamp: NOW + 2_000,
        seqId: 11,
        prevSeqId: 10,
      },
    });

    expect(normalize([first, second])).toMatchObject({
      valid: true,
      value: {
        termination: 'CLEAN',
        records: [{ recordOrdinal: 2 }, { recordOrdinal: 3 }],
      },
    });
    expect(normalize([first, second], false)).toMatchObject({
      valid: true,
      value: { termination: 'TRUNCATED' },
    });
  });

  it('rejects footer identity mismatch and records after footer', () => {
    expect(
      normalizeVersionedOrderBookRecordingLines(
        [
          JSON.stringify(header()),
          JSON.stringify(footer(0, 2, { sourceSessionId: 'other-session' })),
        ],
        { now: NOW + 7_200_000 },
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.NO_MATCHING_MARKET_SESSION,
    });

    expect(
      normalizeVersionedOrderBookRecordingLines(
        [
          JSON.stringify(header()),
          JSON.stringify(footer(0, 2)),
          JSON.stringify(book()),
        ],
        { now: NOW + 7_200_000 },
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
    });
  });

  it('refuses legacy unversioned recordings', () => {
    expect(
      normalizeVersionedOrderBookRecordingLines([JSON.stringify(book())], {
        now: NOW + 7_200_000,
      }),
    ).toMatchObject({
      valid: false,
      completeness: 'MISSING',
      primaryReason: AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
    });
  });
});
