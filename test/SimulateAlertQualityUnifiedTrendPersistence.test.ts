import { describe, expect, it } from 'vitest';

import { simulateAlertQualityUnifiedTrendPersistence } from '../src/tools/simulateAlertQualityUnifiedTrendPersistence';

describe('persisted alert-quality trend simulation', () => {
  it('generates, persists, inspects, reloads, verifies deterministic bytes, and cleans up', async () => {
    const output: string[] = [];
    const errors: string[] = [];

    const code = await simulateAlertQualityUnifiedTrendPersistence({
      log: (...values) => output.push(values.map(String).join(' ')),
      error: (...values) => errors.push(values.map(String).join(' ')),
    });

    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(output).toContain('ALERT QUALITY PERSISTED TREND SIMULATION');
    expect(output).toContain('Generator exit code: 0');
    expect(output).toContain('Inspector exit code: 0');
    expect(output).toContain('Reloaded trends: 1');
    expect(output).toContain('Reloaded reports: 3');
    expect(output).toContain('Inspection verified: true');
    expect(output).toContain('Byte-identical repeat: true');
    expect(output).toContain('Temporary persisted trend outputs cleaned up: true');
  });
});
