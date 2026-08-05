import { describe, expect, it } from 'vitest';

import {
  MarketRecordingParser,
  parseRecordingRecord,
  validateUtcEpochMilliseconds,
} from '../src/recording/recordingValidation';

const NOW = Date.UTC(2026, 6, 29, 12);

const createHeader = (overrides: Record<string, unknown> = {}) => ({
  recordType: 'header',
  schemaVersion: 1,
  recordedAt: NOW,
  sourceSessionId: 'runtime-session',
  recordingId: 'market-recording:runtime-session:test',
  startedAt: NOW,
  producer: {
    name: 'okx-whale-detector',
    version: '1.0.0',
  },
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
    {
      instId: 'BTC-USDT-SWAP',
      instType: 'SWAP',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 0.01,
    },
  ],
  subscriptions: {
    orderBookChannel: 'books',
    orderBookDepth: 400,
    candleIntervals: ['1m'],
  },
  ...overrides,
});

const createCandle = (overrides: Record<string, unknown> = {}) => ({
  type: 'candle',
  recordedAt: NOW + 100,
  interval: '1m',
  candle: {
    instId: 'BTC-USDT',
    timestamp: NOW,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10,
    volumeCurrency: 1_000,
    volumeCurrencyQuote: 1_000,
    confirm: true,
  },
  ...overrides,
});

const createFooter = (overrides: Record<string, unknown> = {}) => ({
  recordType: 'sessionEnd',
  schemaVersion: 1,
  recordedAt: NOW + 1_000,
  sourceSessionId: 'runtime-session',
  recordingId: 'market-recording:runtime-session:test',
  endedAt: NOW + 1_000,
  status: 'CLEAN',
  counts: {
    instrumentRecords: 0,
    orderBookRecords: 0,
    candleRecords: 0,
  },
  finalFileRecordCount: 2,
  ...overrides,
});

const createParser = (): MarketRecordingParser =>
  new MarketRecordingParser({ clock: () => NOW + 2_000 });

describe('recording validation', () => {
  it('parses an instrument record', () => {
    const record = parseRecordingRecord(
      JSON.stringify({
        type: 'instrument',
        recordedAt: 1,
        instrument: {
          instId: 'BTC-USDT',
          instType: 'SPOT',
          quoteCurrency: 'USDT',
          baseUnitsPerSize: 1,
        },
      }),
    );

    expect(record.type).toBe('instrument');
  });

  it('parses an order-book record', () => {
    const record = parseRecordingRecord(
      JSON.stringify({
        type: 'orderBook',
        recordedAt: 2,
        update: {
          instId: 'BTC-USDT',
          action: 'snapshot',
          bids: [],
          asks: [],
          timestamp: 2,
          seqId: 1,
          prevSeqId: -1,
        },
      }),
    );

    expect(record.type).toBe('orderBook');
  });

  it('parses a candle record', () => {
    const record = parseRecordingRecord(
      JSON.stringify({
        type: 'candle',
        recordedAt: 3,
        candle: {
          instId: 'BTC-USDT',
          timestamp: 3,
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 10,
          volumeCurrency: 1_000,
          volumeCurrencyQuote: 1_000,
          confirm: true,
        },
      }),
    );

    expect(record.type).toBe('candle');
  });

  it('rejects an unsupported record type', () => {
    expect(() =>
      parseRecordingRecord(JSON.stringify({ type: 'trade', recordedAt: 1 })),
    ).toThrow('record type');
  });

  it('rejects a missing timestamp', () => {
    expect(() =>
      parseRecordingRecord(
        JSON.stringify({
          type: 'instrument',
          instrument: { instId: 'BTC-USDT' },
        }),
      ),
    ).toThrow('timestamp');
  });

  it('classifies legacy recordings without inventing session metadata', () => {
    const parser = createParser();

    parser.parseLine(
      JSON.stringify({
        type: 'instrument',
        recordedAt: 1,
        instrument: {
          instId: 'BTC-USDT',
          instType: 'SPOT',
          quoteCurrency: 'USDT',
          baseUnitsPerSize: 1,
        },
      }),
    );
    parser.parseLine(
      JSON.stringify({
        type: 'candle',
        recordedAt: 2,
        candle: { instId: 'BTC-USDT' },
      }),
    );

    expect(parser.finish()).toEqual({
      formatType: 'LEGACY_UNVERSIONED',
      termination: 'INCOMPLETE',
      instruments: [
        {
          instId: 'BTC-USDT',
          instType: 'SPOT',
          quoteCurrency: 'USDT',
          baseUnitsPerSize: 1,
        },
      ],
      counts: {
        instrumentRecords: 1,
        orderBookRecords: 0,
        candleRecords: 1,
      },
      finalFileRecordCount: 2,
    });
  });

  it('validates and classifies a clean versioned stream', () => {
    const parser = createParser();

    parser.parseLine(JSON.stringify(createHeader()));
    parser.parseLine(JSON.stringify(createCandle()));
    parser.parseLine(
      JSON.stringify(
        createFooter({
          counts: {
            instrumentRecords: 0,
            orderBookRecords: 0,
            candleRecords: 1,
          },
          finalFileRecordCount: 3,
        }),
      ),
    );

    expect(parser.finish()).toMatchObject({
      formatType: 'VERSIONED_V1',
      schemaVersion: 1,
      sourceSessionId: 'runtime-session',
      recordingId: 'market-recording:runtime-session:test',
      termination: 'CLEAN',
      subscriptions: {
        orderBookChannel: 'books',
        orderBookDepth: 400,
        candleIntervals: ['1m'],
      },
      counts: {
        instrumentRecords: 0,
        orderBookRecords: 0,
        candleRecords: 1,
      },
    });
  });

  it('classifies a versioned stream without a footer as incomplete', () => {
    const parser = createParser();

    parser.parseLine(JSON.stringify(createHeader()));

    expect(parser.finish().termination).toBe('INCOMPLETE');
  });

  it('rejects records before a late versioned header', () => {
    const parser = createParser();

    parser.parseLine(
      JSON.stringify({
        type: 'instrument',
        recordedAt: 1,
        instrument: { instId: 'BTC-USDT' },
      }),
    );

    expect(() => parser.parseLine(JSON.stringify(createHeader()))).toThrow(
      'header must be first',
    );
  });

  it('rejects duplicate headers', () => {
    const parser = createParser();

    parser.parseLine(JSON.stringify(createHeader()));

    expect(() => parser.parseLine(JSON.stringify(createHeader()))).toThrow(
      'Duplicate',
    );
  });

  it('rejects duplicate footers and records after a footer', () => {
    const duplicateParser = createParser();
    duplicateParser.parseLine(JSON.stringify(createHeader()));
    duplicateParser.parseLine(JSON.stringify(createFooter()));

    expect(() =>
      duplicateParser.parseLine(JSON.stringify(createFooter())),
    ).toThrow('Duplicate');

    const trailingParser = createParser();
    trailingParser.parseLine(JSON.stringify(createHeader()));
    trailingParser.parseLine(JSON.stringify(createFooter()));

    expect(() =>
      trailingParser.parseLine(JSON.stringify(createCandle())),
    ).toThrow('after its footer');
  });

  it.each([
    ['sourceSessionId', 'other-session'],
    ['recordingId', 'market-recording:other:test'],
  ])('rejects a footer with mismatched %s', (field, value) => {
    const parser = createParser();

    parser.parseLine(JSON.stringify(createHeader()));

    expect(() =>
      parser.parseLine(JSON.stringify(createFooter({ [field]: value }))),
    ).toThrow('does not match');
  });

  it('rejects mismatched footer counts', () => {
    const parser = createParser();

    parser.parseLine(JSON.stringify(createHeader()));

    expect(() =>
      parser.parseLine(
        JSON.stringify(
          createFooter({
            counts: {
              instrumentRecords: 0,
              orderBookRecords: 1,
              candleRecords: 0,
            },
          }),
        ),
      ),
    ).toThrow('counts do not match');
  });

  it('rejects obvious seconds and unreasonable future timestamps', () => {
    expect(() =>
      validateUtcEpochMilliseconds(1_785_000_000, 'timestamp', NOW),
    ).toThrow('UTC epoch milliseconds');
    expect(() =>
      validateUtcEpochMilliseconds(
        NOW + 2 * 24 * 60 * 60 * 1_000,
        'timestamp',
        NOW,
      ),
    ).toThrow('future');
  });

  it('rejects malformed header timestamps', () => {
    const parser = createParser();

    expect(() =>
      parser.parseLine(
        JSON.stringify(createHeader({ recordedAt: 1_785_000_000 })),
      ),
    ).toThrow('UTC epoch milliseconds');
  });

  it('rejects duplicate instruments and invalid depth', () => {
    const duplicateInstrument = createHeader().instruments[0];

    expect(() =>
      createParser().parseLine(
        JSON.stringify(
          createHeader({
            instruments: [duplicateInstrument, duplicateInstrument],
          }),
        ),
      ),
    ).toThrow('Duplicate recording instrument');
    expect(() =>
      createParser().parseLine(
        JSON.stringify(
          createHeader({
            subscriptions: {
              orderBookChannel: 'books',
              orderBookDepth: 0,
              candleIntervals: ['1m'],
            },
          }),
        ),
      ),
    ).toThrow('subscription metadata');
  });

  it('rejects a candle interval not declared by the header', () => {
    const parser = createParser();

    parser.parseLine(JSON.stringify(createHeader()));

    expect(() =>
      parser.parseLine(JSON.stringify(createCandle({ interval: '5m' }))),
    ).toThrow('not declared');
  });
});
