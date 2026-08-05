import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CorrelatedAlertEngine } from '../src/alerts/CorrelatedAlertEngine';
import {
  MarketDataRecorder,
  type MarketDataRecordWriter,
} from '../src/recording/MarketDataRecorder';
import type {
  MarketRecordingHeaderRecord,
  MarketRecordingSessionEndRecord,
  VersionedCandleRecordingRecord,
} from '../src/recording/marketRecordingFormat';
import { MarketRecordingParser } from '../src/recording/recordingValidation';
import type { MarketInstrumentConfig } from '../src/types/instrument';
import type { MarketEvaluation } from '../src/types/marketEvaluation';

const STARTED_AT = Date.UTC(2026, 6, 29, 12);
const SPOT: MarketInstrumentConfig = {
  instId: 'BTC-USDT',
  instType: 'SPOT',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
};
const SWAP: MarketInstrumentConfig = {
  instId: 'ETH-USDT-SWAP',
  instType: 'SWAP',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 0.01,
};

const createOptions = () => ({
  sourceSessionId: 'shared-runtime-session',
  recordingId: 'market-recording:shared-runtime-session:test',
  startedAt: STARTED_AT,
  clock: () => STARTED_AT + 1_000,
  orderBookChannel: 'books',
  orderBookDepth: 400,
  candleIntervals: ['1m'],
  producer: { name: 'test-producer', version: '1.2.3' },
});

describe('MarketDataRecorder', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'market-recorder-test-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('writes a complete versioned stream with authoritative metadata', async () => {
    const recorder = new MarketDataRecorder(
      directory,
      [SPOT, SWAP],
      createOptions(),
    );

    recorder.recordOrderBook({
      instId: SPOT.instId,
      action: 'snapshot',
      bids: [['100', '2', '0', '1']],
      asks: [['101', '3', '0', '1']],
      timestamp: STARTED_AT + 100,
      seqId: 1,
      prevSeqId: -1,
    });
    recorder.recordCandle(
      {
        instId: SWAP.instId,
        timestamp: STARTED_AT,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 10,
        volumeCurrency: 1_000,
        volumeCurrencyQuote: 1_000,
        confirm: true,
      },
      '1m',
    );
    await recorder.close('SIGINT');

    const lines = readFileSync(recorder.filePath, 'utf8').trim().split('\n');
    const records = lines.map((line) => JSON.parse(line) as unknown);
    const header = records[0] as MarketRecordingHeaderRecord;
    const candle = records[4] as VersionedCandleRecordingRecord;
    const footer = records[5] as MarketRecordingSessionEndRecord;
    const parser = new MarketRecordingParser({
      clock: () => STARTED_AT + 2_000,
    });

    for (const line of lines) {
      parser.parseLine(line);
    }

    expect(header).toEqual({
      recordType: 'header',
      schemaVersion: 1,
      recordedAt: STARTED_AT + 1_000,
      sourceSessionId: 'shared-runtime-session',
      recordingId: 'market-recording:shared-runtime-session:test',
      startedAt: STARTED_AT,
      producer: { name: 'test-producer', version: '1.2.3' },
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
    });
    expect(candle.interval).toBe('1m');
    expect(footer).toMatchObject({
      recordType: 'sessionEnd',
      schemaVersion: 1,
      sourceSessionId: header.sourceSessionId,
      recordingId: header.recordingId,
      status: 'CLEAN',
      shutdownReason: 'SIGINT',
      counts: {
        instrumentRecords: 2,
        orderBookRecords: 1,
        candleRecords: 1,
      },
      finalFileRecordCount: 6,
    });
    expect(parser.finish()).toMatchObject({
      formatType: 'VERSIONED_V1',
      termination: 'CLEAN',
      sourceSessionId: header.sourceSessionId,
      recordingId: header.recordingId,
      counts: footer.counts,
    });
  });

  it('writes the header before instrument records and snapshots metadata', async () => {
    const instrument = { ...SPOT };
    const recorder = new MarketDataRecorder(
      directory,
      [instrument],
      createOptions(),
    );

    instrument.baseUnitsPerSize = 99;
    await recorder.close();

    const records = readFileSync(recorder.filePath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(records.map((record) => record.recordType ?? record.type)).toEqual([
      'header',
      'instrument',
      'sessionEnd',
    ]);
    expect(
      (records[0]?.instruments as MarketInstrumentConfig[])[0]
        ?.baseUnitsPerSize,
    ).toBe(1);
  });

  it('shares the injected application runtime identity with alert generation', async () => {
    const sourceSessionId = 'shared-alert-and-market-runtime';
    const alertEngine = new CorrelatedAlertEngine({ sourceSessionId });
    const recorder = new MarketDataRecorder(directory, [SPOT], {
      ...createOptions(),
      sourceSessionId,
      recordingId: `market-recording:${sourceSessionId}:test`,
    });
    const evaluation: MarketEvaluation = {
      marketSignal: {
        bias: 'BULLISH',
        confidence: 80,
        reason: 'test',
        bidPressure: 80,
        askPressure: 20,
        netPressure: 60,
        timestamp: STARTED_AT,
      },
      correlatedSignal: {
        symbol: 'BTC-USDT',
        bias: 'BULLISH',
        confidence: 80,
        alertImportance: 80,
        okxBias: 'BULLISH',
        okxConfidence: 80,
        externalBias: 'BULLISH',
        externalConfidence: 80,
        agreement: 'AGREEMENT',
        bullishExternalScore: 80,
        bearishExternalScore: 0,
        neutralExternalSignals: 0,
        consideredSignals: 1,
        ignoredSignals: 0,
        contributions: [],
        reason: 'test',
        timestamp: STARTED_AT,
      },
    };

    await recorder.close();

    expect(alertEngine.sourceSessionId).toBe(sourceSessionId);
    expect(alertEngine.evaluate(evaluation)).toMatchObject({
      id: `correlated-alert:${sourceSessionId}:1`,
      sourceSessionId,
    });
    expect(recorder.header.sourceSessionId).toBe(sourceSessionId);
  });

  it('appends the clean footer once and rejects post-footer writes', async () => {
    const recorder = new MarketDataRecorder(directory, [SPOT], createOptions());

    const firstClose = recorder.close();
    const secondClose = recorder.close();

    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(() =>
      recorder.recordOrderBook({
        instId: SPOT.instId,
        action: 'update',
        bids: [],
        asks: [],
        timestamp: STARTED_AT + 1_000,
        seqId: 2,
        prevSeqId: 1,
      }),
    ).toThrow('already closed');

    const sessionEnds = readFileSync(recorder.filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(
        (line) =>
          (JSON.parse(line) as { recordType?: string }).recordType ===
          'sessionEnd',
      );
    expect(sessionEnds).toHaveLength(1);
  });

  it('creates distinct recording IDs without using the filename as identity', async () => {
    const writers: string[][] = [];
    const createWriter = (): MarketDataRecordWriter => {
      const lines: string[] = [];
      writers.push(lines);
      return {
        write: (line) => lines.push(line),
        close: async () => undefined,
      };
    };
    const baseOptions = createOptions();
    const first = new MarketDataRecorder(directory, [SPOT], {
      ...baseOptions,
      recordingId: undefined,
      writerFactory: createWriter,
    });
    const second = new MarketDataRecorder(directory, [SPOT], {
      ...baseOptions,
      recordingId: undefined,
      writerFactory: createWriter,
    });

    await Promise.all([first.close(), second.close()]);

    expect(first.sourceSessionId).toBe(second.sourceSessionId);
    expect(first.recordingId).not.toBe(second.recordingId);
    expect(first.recordingId).toMatch(
      /^market-recording:shared-runtime-session:/,
    );
    expect(writers).toHaveLength(2);
  });

  it('rejects undeclared candle intervals', async () => {
    const recorder = new MarketDataRecorder(directory, [SPOT], createOptions());

    expect(() =>
      recorder.recordCandle(
        {
          instId: SPOT.instId,
          timestamp: STARTED_AT,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
          volumeCurrency: 1,
          volumeCurrencyQuote: 1,
          confirm: false,
        },
        '5m',
      ),
    ).toThrow('not declared');

    await recorder.close();
  });

  it('rejects obvious seconds in injected startup timestamps', () => {
    expect(
      () =>
        new MarketDataRecorder(directory, [SPOT], {
          ...createOptions(),
          startedAt: 1_785_000_000,
        }),
    ).toThrow('UTC epoch milliseconds');
  });

  it('surfaces writer flush failures from close', async () => {
    const recorder = new MarketDataRecorder(directory, [SPOT], {
      ...createOptions(),
      writerFactory: () => ({
        write: () => undefined,
        close: async () => {
          throw new Error('flush failed');
        },
      }),
    });

    await expect(recorder.close()).rejects.toThrow('flush failed');
  });
});
