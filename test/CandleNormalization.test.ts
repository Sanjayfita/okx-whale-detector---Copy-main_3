import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAlignmentConfiguration } from '../src/evaluation/alignmentConfiguration';
import {
  ConfirmedCandleRecordingReader,
  normalizeVersionedCandleRecordingLines,
  parseConfirmedCandleInterval,
} from '../src/evaluation/candleNormalization';
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
  sourceSessionId: 'alignment-session',
  recordingId: 'market-recording:alignment-session:test',
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

const candle = (overrides: Record<string, unknown> = {}) => ({
  type: 'candle',
  recordedAt: NOW + 60_000,
  interval: '1m',
  candle: {
    instId: SPOT.instId,
    timestamp: NOW,
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

const footer = (
  candleRecords: number,
  finalFileRecordCount = candleRecords + 2,
  overrides: Record<string, unknown> = {},
) => ({
  recordType: 'sessionEnd',
  schemaVersion: 1,
  recordedAt: NOW + 3_600_000,
  sourceSessionId: 'alignment-session',
  recordingId: 'market-recording:alignment-session:test',
  endedAt: NOW + 3_600_000,
  status: 'CLEAN',
  counts: {
    instrumentRecords: 0,
    orderBookRecords: 0,
    candleRecords,
  },
  finalFileRecordCount,
  ...overrides,
});

const normalize = (
  records: readonly unknown[],
  clean = true,
  options: Parameters<typeof normalizeVersionedCandleRecordingLines>[1] = {},
) =>
  normalizeVersionedCandleRecordingLines(
    [
      JSON.stringify(header()),
      ...records.map((record) => JSON.stringify(record)),
      ...(clean
        ? [JSON.stringify(footer(records.length, records.length + 2))]
        : []),
    ],
    { now: NOW + 7_200_000, ...options },
  );

describe('confirmed candle interval parsing', () => {
  it('supports an explicit 1m interval', () => {
    expect(parseConfirmedCandleInterval('1m')).toEqual({
      valid: true,
      value: { interval: '1m', durationMs: 60_000 },
    });
  });

  it.each([undefined, '', '0m', '-1m', '1', '5m', 'candle1m'])(
    'rejects missing, malformed, or unsupported interval %j',
    (interval) => {
      expect(parseConfirmedCandleInterval(interval)).toMatchObject({
        valid: false,
        primaryReason: AlignmentReason.CANDLE_INTERVAL_UNKNOWN,
      });
    },
  );
});

describe('versioned confirmed candle normalization', () => {
  it('normalizes a confirmed SPOT candle using interval end as event time', () => {
    const result = normalize([candle()]);

    expect(result).toMatchObject({
      valid: true,
      value: {
        termination: 'CLEAN',
        formingCandleCount: 0,
        confirmedCandles: [
          {
            instrument: { instId: 'BTC-USDT', instType: 'SPOT' },
            interval: '1m',
            intervalStart: NOW,
            intervalEnd: NOW + 60_000,
            eventTimestamp: NOW + 60_000,
            availabilityTimestamp: NOW + 60_000,
            recordOrdinal: 2,
            close: 101,
          },
        ],
      },
    });
  });

  it('normalizes authoritative SWAP metadata without suffix inference', () => {
    const result = normalize([
      candle({
        candle: {
          ...candle().candle,
          instId: SWAP.instId,
        },
      }),
    ]);

    expect(result).toMatchObject({
      valid: true,
      value: {
        confirmedCandles: [
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

  it('keeps forming updates audit-only', () => {
    const result = normalize([
      candle({
        candle: { ...candle().candle, confirm: false },
      }),
    ]);

    expect(result).toMatchObject({
      valid: true,
      value: {
        confirmedCandles: [],
        formingCandleCount: 1,
      },
    });
  });

  it.each([
    { open: 0 },
    { close: Number.NaN },
    { high: 100, close: 101 },
    { low: 101, open: 100 },
  ])('rejects invalid OHLC values %j', (ohlc) => {
    const result = normalize([
      candle({
        candle: { ...candle().candle, ...ohlc },
      }),
    ]);

    expect(result).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.BOOK_INVALID,
    });
  });

  it('rejects undeclared and missing intervals without inference', () => {
    expect(normalize([candle({ interval: '5m' })])).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.CANDLE_INTERVAL_UNKNOWN,
    });
    expect(normalize([candle({ interval: undefined })])).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.CANDLE_INTERVAL_UNKNOWN,
    });
  });

  it('rejects interval-end overflow', () => {
    const configuration = createAlignmentConfiguration({
      maximumValidTimestampMs: NOW + 30_000,
    });
    const result = normalize([candle()], false, { configuration });

    expect(result).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.TIMESTAMP_RANGE_INVALID,
    });
  });

  it('sets availability to the later of recorded arrival and interval end', () => {
    const result = normalize([
      candle({ recordedAt: NOW + 65_000 }),
      candle({
        recordedAt: NOW + 1_000,
        candle: {
          ...candle().candle,
          timestamp: NOW + 60_000,
        },
      }),
    ]);

    expect(result.valid && result.value.confirmedCandles).toMatchObject([
      {
        intervalEnd: NOW + 60_000,
        availabilityTimestamp: NOW + 65_000,
      },
      {
        intervalEnd: NOW + 120_000,
        availabilityTimestamp: NOW + 120_000,
      },
    ]);
  });

  it('coalesces identical confirmed duplicates using first-arrival authority', () => {
    const result = normalize([candle(), candle({ recordedAt: NOW + 61_000 })]);

    expect(result).toMatchObject({
      valid: true,
      value: {
        identicalDuplicateCount: 1,
        confirmedCandles: [
          {
            recordOrdinal: 2,
            availabilityTimestamp: NOW + 60_000,
          },
        ],
        duplicateGroups: [
          {
            identicalDuplicateCount: 1,
            conflictingRecordOrdinals: [],
          },
        ],
      },
    });
  });

  it('records conflicting confirmed duplicates without replacing the first', () => {
    const result = normalize([
      candle(),
      candle({
        candle: { ...candle().candle, close: 101.5 },
      }),
    ]);

    expect(result).toMatchObject({
      valid: true,
      value: {
        confirmedCandles: [{ close: 101, recordOrdinal: 2 }],
        duplicateGroups: [
          {
            firstRecordOrdinal: 2,
            conflictingRecordOrdinals: [3],
          },
        ],
      },
    });
  });

  it('handles forming-then-confirmed and confirmed-then-forming state', () => {
    const forming = candle({
      candle: { ...candle().candle, confirm: false },
    });
    const first = normalize([forming, candle()]);
    const second = normalize([candle(), forming]);

    expect(first).toMatchObject({
      valid: true,
      value: {
        formingCandleCount: 1,
        confirmedCandles: [{ recordOrdinal: 3 }],
      },
    });
    expect(second).toMatchObject({
      valid: true,
      value: {
        formingCandleCount: 1,
        confirmedCandles: [{ recordOrdinal: 2 }],
      },
    });
  });

  it('classifies clean and truncated recordings', () => {
    expect(normalize([candle()])).toMatchObject({
      valid: true,
      value: { termination: 'CLEAN', footer: { status: 'CLEAN' } },
    });
    expect(normalize([candle()], false)).toMatchObject({
      valid: true,
      value: { termination: 'TRUNCATED', footer: null },
    });
  });

  it('rejects records after a footer', () => {
    const lines = [
      JSON.stringify(header()),
      JSON.stringify(footer(0, 2)),
      JSON.stringify(candle()),
    ];

    expect(
      normalizeVersionedCandleRecordingLines(lines, {
        now: NOW + 7_200_000,
      }),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
    });
  });

  it('reads and normalizes a versioned JSONL file', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'candle-normalizer-'));
    const filePath = path.join(directory, 'market.jsonl');
    const lines = [
      JSON.stringify(header()),
      JSON.stringify(candle()),
      JSON.stringify(footer(1, 3)),
    ];

    try {
      writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');

      const result = await new ConfirmedCandleRecordingReader().read(filePath, {
        now: NOW + 7_200_000,
      });

      expect(result).toMatchObject({
        valid: true,
        value: {
          termination: 'CLEAN',
          confirmedCandles: [{ close: 101 }],
        },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns typed metadata conflict for an invalid header declaration', () => {
    const duplicate = {
      ...SPOT,
      instType: 'SWAP',
    };

    expect(
      normalizeVersionedCandleRecordingLines(
        [JSON.stringify(header({ instruments: [SPOT, duplicate] }))],
        { now: NOW + 7_200_000 },
      ),
    ).toMatchObject({
      valid: false,
      primaryReason: AlignmentReason.INSTRUMENT_METADATA_CONFLICT,
    });
  });

  it('refuses legacy unversioned recordings', () => {
    expect(
      normalizeVersionedCandleRecordingLines(
        [JSON.stringify(candle({ interval: undefined }))],
        { now: NOW + 7_200_000 },
      ),
    ).toMatchObject({
      valid: false,
      completeness: 'MISSING',
      primaryReason: AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
    });
  });
});
