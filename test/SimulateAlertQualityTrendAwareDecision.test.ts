import { describe, expect, it, vi } from 'vitest';

import { runAlertQualityTrendAwareDecisionSimulation } from '../src/tools/simulateAlertQualityTrendAwareDecision';

describe('trend-aware alert-quality decision simulation', () => {
  it('persists, reloads, repeats deterministically, rejects malformed input, and cleans up', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...values) => {
      output.push(values.map(String).join(' '));
    });
    const error = vi.spyOn(console, 'error').mockImplementation((...values) => {
      errors.push(values.map(String).join(' '));
    });

    try {
      const code = await runAlertQualityTrendAwareDecisionSimulation();

      expect(code).toBe(0);
      expect(errors).toEqual([]);
      expect(output).toContain('ALERT QUALITY TREND-AWARE DECISION SIMULATION');
      expect(output).toContain('Decision: QUALIFIED');
      expect(output).toContain('Reloaded decisions: 1');
      expect(output).toContain('Read issues: 0');
      expect(output).toContain('Byte-identical repeat: true');
      expect(output).toContain('Malformed-input rejection verified: true');
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
