import { describe, expect, it } from 'vitest';

import { simulateAlertQualityUnifiedTrend } from '../src/tools/simulateAlertQualityUnifiedTrend';

describe('alert-quality trend simulation', () => {
  it('verifies ordering, cumulative output, compatibility rejection, and cleanup', async () => {
    const logs: string[] = [];
    const errors: string[] = [];

    const code = await simulateAlertQualityUnifiedTrend({
      log: (...values) => logs.push(values.map(String).join(' ')),
      error: (...values) => errors.push(values.map(String).join(' ')),
    });

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(logs).toContain('Compatible trend exit code: 0');
    expect(logs).toContain('Chronological ordering verified: true');
    expect(logs).toContain('Cumulative trend verified: true');
    expect(logs).toContain('Compatibility rejection verified: true');
    expect(logs).toContain('Temporary trend outputs cleaned up: true');
  });
});
