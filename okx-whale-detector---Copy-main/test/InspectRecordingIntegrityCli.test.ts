import { describe, expect, it, vi } from 'vitest';

import {
  formatRecordingIntegrityReport,
  runInspectRecordingIntegrityCli,
} from '../src/tools/inspectRecordingIntegrity';
import type { RecordingIntegrityReport } from '../src/recording/recordingIntegrity';

const report = (overrides: Partial<RecordingIntegrityReport> = {}): RecordingIntegrityReport => ({
  filePath: 'C:\\recordings\\sample.jsonl',
  byteLength: 42,
  lineCount: 3,
  nonEmptyLineCount: 2,
  malformedJsonLineCount: 0,
  firstTimestamp: 100,
  lastTimestamp: 200,
  nonMonotonicTimestampCount: 0,
  sha256: 'a'.repeat(64),
  valid: true,
  ...overrides,
});

describe('recording integrity CLI', () => {
  it('prints a valid report and exits successfully', async () => {
    const writeOutput = vi.fn();
    const inspect = vi.fn(async () => report());

    const exitCode = await runInspectRecordingIntegrityCli(['--file', 'sample.jsonl'], {
      inspect,
      writeOutput,
    });

    expect(exitCode).toBe(0);
    expect(inspect).toHaveBeenCalledOnce();
    expect(writeOutput).toHaveBeenCalledWith(expect.stringContaining('Valid: true'));
    expect(writeOutput).toHaveBeenCalledWith(expect.stringContaining('SHA-256:'));
  });

  it('returns one for an invalid recording', async () => {
    const writeOutput = vi.fn();
    const exitCode = await runInspectRecordingIntegrityCli(['--file', 'bad.jsonl'], {
      inspect: async () => report({ malformedJsonLineCount: 1, valid: false }),
      writeOutput,
    });

    expect(exitCode).toBe(1);
    expect(writeOutput).toHaveBeenCalledWith(expect.stringContaining('Malformed JSON lines: 1'));
  });

  it('returns two for missing arguments and read failures', async () => {
    const writeError = vi.fn();
    expect(await runInspectRecordingIntegrityCli([], { writeError })).toBe(2);
    expect(writeError).toHaveBeenCalledWith(expect.stringContaining('Usage:'));

    writeError.mockClear();
    expect(
      await runInspectRecordingIntegrityCli(['--file', 'missing.jsonl'], {
        inspect: async () => {
          throw new Error('missing file');
        },
        writeError,
      }),
    ).toBe(2);
    expect(writeError).toHaveBeenCalledWith(
      'Recording integrity inspection failed: missing file',
    );
  });

  it('formats unavailable timestamps clearly', () => {
    const output = formatRecordingIntegrityReport(
      report({ firstTimestamp: null, lastTimestamp: null }),
    );
    expect(output).toContain('First timestamp: not found');
    expect(output).toContain('Last timestamp: not found');
  });
});
