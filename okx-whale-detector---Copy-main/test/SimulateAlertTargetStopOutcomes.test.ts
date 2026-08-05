import { describe, expect, it } from 'vitest';

import { simulateAlertTargetStopOutcomes } from '../src/tools/simulateAlertTargetStopOutcomes';

describe('deterministic target/stop simulation', () => {
  it('covers exact, executable, candle, contradiction, inspection, and cleanup', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const exitCode = await simulateAlertTargetStopOutcomes({
      log: (...values) => logs.push(values.join(' ')),
      error: (...values) => errors.push(values.join(' ')),
    });
    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(logs).toEqual(
      expect.arrayContaining([
        'Valid target/stop records: 3',
        'Malformed records: 0',
        'Eligible cells: 30',
        'Ineligible cells: 0',
        'Ambiguous cells: 15',
        'Target first: 30',
        'Stop first: 30',
        'Neither: 0',
        'Ties: 0',
        'Candle ambiguities: 30',
        'Duplicate IDs: 0; Duplicate units: 0',
        'Temporary target/stop output cleaned up: true',
      ]),
    );
  });
});
