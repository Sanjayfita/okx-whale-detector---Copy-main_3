import { describe, expect, it } from 'vitest';

import {
  calculateAnchoredReplayDelayMs,
  calculateReplayDelayMs,
  parseReplayOptions,
  parseReplaySpeed,
} from '../src/recording/replayOptions';

describe('replay options', () => {
  it('defaults to instant replay for all symbols without a report', () => {
    expect(parseReplayOptions(['session.ndjson'])).toEqual({
      filePath: 'session.ndjson',
      speed: 'instant',
      symbol: undefined,
      report: false,
      reportPath: undefined,
    });
  });

  it('parses a symbol and accelerated speed', () => {
    expect(
      parseReplayOptions([
        'session.ndjson',
        '--symbol',
        'BTC-USDT',
        '--speed',
        '10x',
      ]),
    ).toEqual({
      filePath: 'session.ndjson',
      symbol: 'BTC-USDT',
      speed: 10,
      report: false,
      reportPath: undefined,
    });
  });

  it('enables a report with the default output path', () => {
    expect(parseReplayOptions(['session.ndjson', '--report'])).toEqual({
      filePath: 'session.ndjson',
      speed: 'instant',
      symbol: undefined,
      report: true,
      reportPath: undefined,
    });
  });

  it('accepts a custom report path', () => {
    expect(
      parseReplayOptions(['session.ndjson', '--report', 'reports/custom.json']),
    ).toEqual({
      filePath: 'session.ndjson',
      speed: 'instant',
      symbol: undefined,
      report: true,
      reportPath: 'reports/custom.json',
    });
  });

  it('parses realtime speed', () => {
    expect(parseReplaySpeed('realtime')).toBe('realtime');
  });

  it('rejects an invalid speed', () => {
    expect(() => parseReplaySpeed('fast')).toThrow('Replay speed');
  });

  it('rejects an unknown option', () => {
    expect(() => parseReplayOptions(['session.ndjson', '--unknown'])).toThrow(
      'Unknown replay option',
    );
  });

  it('returns no delay for instant replay', () => {
    expect(calculateReplayDelayMs(1_000, 2_000, 'instant')).toBe(0);
  });

  it('preserves the original delay for realtime replay', () => {
    expect(calculateReplayDelayMs(1_000, 2_500, 'realtime')).toBe(1_500);
  });

  it('divides delays by an acceleration multiplier', () => {
    expect(calculateReplayDelayMs(1_000, 3_000, 10)).toBe(200);
  });

  it('anchors accelerated timing to total playback elapsed time', () => {
    expect(calculateAnchoredReplayDelayMs(1_000, 3_000, 150, 10)).toBe(50);
  });

  it('compensates for timer overshoot instead of accumulating drift', () => {
    expect(calculateAnchoredReplayDelayMs(1_000, 3_000, 240, 10)).toBe(0);
  });

  it('anchors realtime playback to the recording timeline', () => {
    expect(
      calculateAnchoredReplayDelayMs(1_000, 2_500, 1_200, 'realtime'),
    ).toBe(300);
  });
});
