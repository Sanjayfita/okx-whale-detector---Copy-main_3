import { describe, expect, it } from 'vitest';

import { simulateAlertQualityUnifiedComparison } from '../src/tools/simulateAlertQualityUnifiedComparison';

describe('alert-quality comparison simulation', () => {
  it('compares persisted reports, rejects incompatibility, and cleans up', async () => {
    const logs: string[] = [];
    const errors: string[] = [];

    const code = await simulateAlertQualityUnifiedComparison({
      log: (...values) => logs.push(values.map(String).join(' ')),
      error: (...values) => errors.push(values.map(String).join(' ')),
    });

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(logs).toContain('ALERT QUALITY COMPARISON SIMULATION');
    expect(logs).toContain('Compatible comparison exit code: 0');
    expect(logs).toContain('Compatibility rejection verified: true');
    expect(logs).toContain('Temporary comparison outputs cleaned up: true');
    expect(logs.some((line) => line.startsWith('Degraded metrics: '))).toBe(true);
    expect(
      logs.some((line) => line.includes('Research analytics only. This output is not a trading recommendation.')),
    ).toBe(true);
  });
});
