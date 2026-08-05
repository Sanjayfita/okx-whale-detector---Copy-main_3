import { describe, expect, it } from 'vitest';

import { simulateAlertQualityUnifiedTrendComparison } from '../src/tools/simulateAlertQualityUnifiedTrendComparison';

describe('alert-quality trend comparison simulation', () => {
  it('compares compatible trends, verifies reversal, rejects incompatibility, and cleans up', async () => {
    const output: string[] = [];
    const code = await simulateAlertQualityUnifiedTrendComparison({
      log: (...values) => output.push(values.map(String).join(' ')),
      error: (...values) => output.push(values.map(String).join(' ')),
    });

    expect(code).toBe(0);
    expect(output).toContain('Compatible comparison exit code: 0');
    expect(output).toContain('Reversal verified: true');
    expect(output).toContain('Compatibility rejection verified: true');
    expect(output).toContain('Temporary trend comparison outputs cleaned up: true');
  });
});
