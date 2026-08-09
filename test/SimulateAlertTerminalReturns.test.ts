import { describe, expect, it } from 'vitest';

import { runTerminalReturnSimulationCli } from '../src/tools/simulateAlertTerminalReturns';

describe('deterministic terminal-return simulation', () => {
  it('covers directional, executable, and ineligible Phase E cases', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const exitCode = await runTerminalReturnSimulationCli({
      log: (...values) => output.push(values.join(' ')),
      error: (...values) => errors.push(values.join(' ')),
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(output).toContain('Valid return records: 4');
    expect(output).toContain('Malformed records: 0');
    expect(output).toContain('Eligible cells: 19');
    expect(output).toContain('Ineligible cells: 4');
    expect(output).toContain('Ambiguous cells: 1');
    expect(output).toContain(
      'Contradiction directions: OKX=9.5, External=-9.5',
    );
    expect(output).toContain('Bullish executable return: 8');
    expect(output).toContain('Bearish executable return: 9');
    expect(output).toContain('Temporary terminal-return output cleaned up.');
  });
});
