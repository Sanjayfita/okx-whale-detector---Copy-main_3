import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketDataRecorder } from '../src/recording/MarketDataRecorder';
import { runMarketRecordingInspectorCli } from '../src/tools/inspectMarketRecording';

const NOW = Date.UTC(2026, 6, 29, 12);

describe('market recording inspector CLI', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'recording-inspector-test-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('prints versioned identity, subscription, count, and termination metadata', async () => {
    const recorder = new MarketDataRecorder(
      directory,
      [
        {
          instId: 'BTC-USDT',
          instType: 'SPOT',
          quoteCurrency: 'USDT',
          baseUnitsPerSize: 1,
        },
      ],
      {
        sourceSessionId: 'inspector-runtime',
        recordingId: 'market-recording:inspector-runtime:test',
        startedAt: NOW,
        clock: () => NOW + 1_000,
        orderBookChannel: 'books',
        orderBookDepth: 400,
        candleIntervals: ['1m'],
      },
    );
    await recorder.close('SIGTERM');
    const log = vi.fn();

    const exitCode = await runMarketRecordingInspectorCli(
      ['--file', recorder.filePath],
      { log, error: vi.fn() },
    );
    const output = log.mock.calls.flat().join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('Format: VERSIONED_V1');
    expect(output).toContain('Schema version: 1');
    expect(output).toContain('Source session ID: inspector-runtime');
    expect(output).toContain(
      'Recording ID: market-recording:inspector-runtime:test',
    );
    expect(output).toContain('Termination: CLEAN');
    expect(output).toContain('BTC-USDT (SPOT)');
    expect(output).toContain('Candle intervals: 1m');
    expect(output).toContain(
      'Records: instruments=1, orderBooks=0, candles=0, fileTotal=3',
    );
    expect(output).toContain('Validation errors: none');
  });

  it('reports legacy identity and candle interval as unavailable', async () => {
    const filePath = path.join(directory, 'legacy.ndjson');
    writeFileSync(
      filePath,
      `${JSON.stringify({
        type: 'instrument',
        recordedAt: 1,
        instrument: {
          instId: 'BTC-USDT',
          instType: 'SPOT',
          quoteCurrency: 'USDT',
          baseUnitsPerSize: 1,
        },
      })}\n`,
      'utf8',
    );
    const log = vi.fn();

    const exitCode = await runMarketRecordingInspectorCli(
      ['--file', filePath],
      { log, error: vi.fn() },
    );
    const output = log.mock.calls.flat().join('\n');

    expect(exitCode).toBe(0);
    expect(output).toContain('Format: LEGACY_UNVERSIONED');
    expect(output).toContain('Source session ID: unavailable');
    expect(output).toContain('Recording ID: unavailable');
    expect(output).toContain('Candle intervals: unknown');
    expect(output).toContain('Termination: INCOMPLETE');
    expect(readFileSync(filePath, 'utf8')).not.toContain('sourceSessionId');
  });

  it('returns a failure and reports validation errors', async () => {
    const filePath = path.join(directory, 'invalid.ndjson');
    writeFileSync(
      filePath,
      `${JSON.stringify({
        recordType: 'header',
        schemaVersion: 1,
        recordedAt: 1_785_000_000,
      })}\n`,
      'utf8',
    );
    const error = vi.fn();

    const exitCode = await runMarketRecordingInspectorCli(
      ['--file', filePath],
      { log: vi.fn(), error },
    );

    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'Market recording inspection failed:',
      expect.stringContaining('UTC epoch milliseconds'),
    );
  });
});
