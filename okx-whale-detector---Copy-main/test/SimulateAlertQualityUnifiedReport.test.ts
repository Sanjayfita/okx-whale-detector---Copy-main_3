import { describe, expect, it } from 'vitest';

import { simulateAlertQualityUnifiedReport } from '../src/tools/simulateAlertQualityUnifiedReport';

describe('unified alert-quality report simulation', () => {
  it('generates, persists, inspects, verifies deterministic bytes, and cleans up', async () => {
    const logs: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const stringify = (values: unknown[]): string => values.map(String).join(' ');

    const exitCode = await simulateAlertQualityUnifiedReport({
      log: (...values) => logs.push(stringify(values)),
      warn: (...values) => warnings.push(stringify(values)),
      error: (...values) => errors.push(stringify(values)),
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(logs).toContain('UNIFIED ALERT QUALITY REPORT SIMULATION');
    expect(logs).toContain('Terminal-return records: 3');
    expect(logs).toContain('Path-outcome records: 3');
    expect(logs).toContain('Target/stop records: 3');
    expect(logs).toContain('Byte-identical repeat: true');
    expect(logs).toContain('Read issues: 0');
    expect(logs).toContain('Reports: 1');
    expect(logs).toContain('Exact duplicate reports: 0');
    expect(logs).toContain('Temporary unified quality outputs cleaned up: true');
  });
});
