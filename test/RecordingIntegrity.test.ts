import { describe, expect, it } from 'vitest';

import { inspectRecordingIntegrityFromText } from '../src/recording/recordingIntegrity';

describe('recording integrity', () => {
  it('reports deterministic integrity metadata for a valid recording', () => {
    const text = [
      JSON.stringify({ timestamp: 1000, type: 'snapshot' }),
      JSON.stringify({ timestamp: 2000, type: 'update' }),
      '',
    ].join('\n');

    const first = inspectRecordingIntegrityFromText({ filePath: 'recording.jsonl', text });
    const second = inspectRecordingIntegrityFromText({ filePath: 'recording.jsonl', text });

    expect(first).toEqual(second);
    expect(first.valid).toBe(true);
    expect(first.nonEmptyLineCount).toBe(2);
    expect(first.malformedJsonLineCount).toBe(0);
    expect(first.firstTimestamp).toBe(1000);
    expect(first.lastTimestamp).toBe(2000);
    expect(first.nonMonotonicTimestampCount).toBe(0);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('detects malformed JSON and non-monotonic timestamps', () => {
    const text = [
      JSON.stringify({ ts: 2000 }),
      '{bad json',
      JSON.stringify({ recordedAt: 1000 }),
    ].join('\n');

    const report = inspectRecordingIntegrityFromText({ filePath: 'broken.jsonl', text });

    expect(report.valid).toBe(false);
    expect(report.malformedJsonLineCount).toBe(1);
    expect(report.nonMonotonicTimestampCount).toBe(1);
    expect(report.firstTimestamp).toBe(2000);
    expect(report.lastTimestamp).toBe(1000);
  });

  it('rejects an empty recording', () => {
    const report = inspectRecordingIntegrityFromText({ filePath: 'empty.jsonl', text: '' });
    expect(report.valid).toBe(false);
    expect(report.nonEmptyLineCount).toBe(0);
  });
});
