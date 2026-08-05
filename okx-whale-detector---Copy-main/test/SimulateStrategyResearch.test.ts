import { afterEach, describe, expect, it, vi } from 'vitest';

import { runStrategyResearchSimulation } from '../src/tools/simulateStrategyResearch';

describe('strategy research simulation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('verifies a deterministic robustly better research candidate', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(() => runStrategyResearchSimulation()).not.toThrow();

    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('STRATEGY RESEARCH SIMULATION');
    expect(output).toContain('Direct comparison verdict: BETTER');
    expect(output).toContain('Walk-forward verdict: ROBUSTLY_BETTER');
    expect(output).toContain('Deterministic controlled strategy research verified: true');
  });
});
