import { describe, expect, it } from 'vitest';

import { runAlertAlignmentSimulationCli } from '../src/tools/simulateAlertAlignmentEvaluations';

describe('deterministic alert alignment evaluation simulation', () => {
  it('generates, validates, inspects, and cleans up the Phase D fixture', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const exitCode = await runAlertAlignmentSimulationCli({
      log: (...values) => output.push(values.join(' ')),
      error: (...values) => errors.push(values.join(' ')),
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(output).toContain('Valid evaluation records: 1');
    expect(output).toContain('Malformed records: 0');
    expect(output).toContain('COMPLETE: 2');
    expect(output).toContain('AMBIGUOUS: 1');
    expect(output).toContain('MISSING: 12');
    expect(output).toContain('Returns/outcomes: not present');
    expect(output).toContain('Temporary evaluation output cleaned up.');
  });
});
