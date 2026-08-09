import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CandleUpdateHandler } from '../src/core/CandleUpdateHandler';
import { replayRecording } from '../src/tools/replayRecording';

const NOW = Date.UTC(2026, 6, 29, 12);
const INSTRUMENT = {
  instId: 'BTC-USDT',
  instType: 'SPOT',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
} as const;

describe('recording replay compatibility', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'replay-recording-test-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('replays legacy unversioned recordings as before', async () => {
    const filePath = path.join(directory, 'legacy.ndjson');
    writeFileSync(
      filePath,
      `${JSON.stringify({
        type: 'instrument',
        recordedAt: 1,
        instrument: INSTRUMENT,
      })}\n`,
      'utf8',
    );

    await expect(replayRecording([filePath])).resolves.toBeUndefined();

    expect(console.log).toHaveBeenCalledWith('Markets: 1');
    expect(console.log).toHaveBeenCalledWith('Order-book updates: 0');
    expect(console.log).toHaveBeenCalledWith('Candle updates: 0');
  });

  it('uses header instruments and ignores header/footer as market updates', async () => {
    const filePath = path.join(directory, 'versioned.ndjson');
    const records = [
      {
        recordType: 'header',
        schemaVersion: 1,
        recordedAt: NOW,
        sourceSessionId: 'replay-runtime',
        recordingId: 'market-recording:replay-runtime:test',
        startedAt: NOW,
        producer: { name: 'test', version: '1.0.0' },
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
      },
      {
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
      },
      {
        recordType: 'sessionEnd',
        schemaVersion: 1,
        recordedAt: NOW + 1_000,
        sourceSessionId: 'replay-runtime',
        recordingId: 'market-recording:replay-runtime:test',
        endedAt: NOW + 1_000,
        status: 'CLEAN',
        counts: {
          instrumentRecords: 0,
          orderBookRecords: 0,
          candleRecords: 1,
        },
        finalFileRecordCount: 3,
      },
    ];
    writeFileSync(
      filePath,
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
      'utf8',
    );
    const handle = vi.spyOn(CandleUpdateHandler.prototype, 'handle');

    await expect(replayRecording([filePath])).resolves.toBeUndefined();

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ instId: 'BTC-USDT' }),
    );
    expect(console.log).toHaveBeenCalledWith('Markets: 1');
    expect(console.log).toHaveBeenCalledWith('Order-book updates: 0');
    expect(console.log).toHaveBeenCalledWith('Candle updates: 1');
  });
});
