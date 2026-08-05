import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  formatReplaySpeed,
  resolveReplayReportPath,
} from '../src/recording/replayReport';

describe('replay report', () => {
  it('creates a default report path from the recording name', () => {
    expect(resolveReplayReportPath('data/recordings/3rd.ndjson')).toBe(
      path.join('data', 'reports', '3rd-replay-report.json'),
    );
  });

  it('preserves a requested report path', () => {
    expect(
      resolveReplayReportPath(
        'data/recordings/3rd.ndjson',
        'custom/report.json',
      ),
    ).toBe('custom/report.json');
  });

  it('formats numeric replay multipliers', () => {
    expect(formatReplaySpeed(20)).toBe('20x');
    expect(formatReplaySpeed('instant')).toBe('instant');
  });
});
