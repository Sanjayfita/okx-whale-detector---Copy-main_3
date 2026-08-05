import { describe, expect, it } from 'vitest';

import { simulateAlertPathOutcomes } from '../src/tools/simulateAlertPathOutcomes';

describe('deterministic path-outcome simulation', () => {
  it('covers agreement, contradiction, path metrics, inspection, and cleanup', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const exitCode = await simulateAlertPathOutcomes({
      log: (...values) => logs.push(values.join(' ')),
      error: (...values) => errors.push(values.join(' ')),
    });
    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(logs).toEqual(
      expect.arrayContaining([
        'Valid path records: 3',
        'Malformed records: 0',
        'Eligible cells: 45',
        'Ineligible cells: 0',
        'Ambiguous cells: 0',
        'Contradiction 1m: OKX MFE=3, External MFE=2',
        'Bullish executable 1m: MFE=2, MAE=3',
        'Duplicate IDs: 0; Duplicate units: 0',
        'MFE/MAE metrics: 30',
        'Executable metrics: 30',
        'Candle-bound paths: 15',
        'Temporary path-outcome output cleaned up.',
      ]),
    );
  });
});
