import { describe, expect, it, vi } from 'vitest';

import { runTestnetOrderIntentTrendComparisonSimulation } from '../src/tools/simulateTestnetOrderIntentTrendComparison';

describe('runTestnetOrderIntentTrendComparisonSimulation', () => {
  it('deterministically covers improved, unchanged, and worsened outcomes', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(runTestnetOrderIntentTrendComparisonSimulation()).toBe(0);
    expect(log).toHaveBeenCalledWith('IMPROVED | IMPROVED');
    expect(log).toHaveBeenCalledWith('UNCHANGED | UNCHANGED');
    expect(log).toHaveBeenCalledWith('WORSENED | WORSENED');
    expect(log).toHaveBeenCalledWith('SIMULATION PASSED');

    log.mockRestore();
  });
});
