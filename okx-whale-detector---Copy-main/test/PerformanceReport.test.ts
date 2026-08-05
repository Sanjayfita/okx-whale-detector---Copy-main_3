import { describe, expect, it, vi } from 'vitest';

import {
  runFormattingBenchmark,
  runPerformanceReport,
  runSummaryEmissionBenchmark,
} from '../src/tools/performanceReport';

describe('performance report', () => {
  it('benchmarks bounded summary formatting samples by scored-whale count', () => {
    const results = runFormattingBenchmark();

    expect(results.map((result) => result.scoredWhales)).toEqual([
      0, 10, 100, 200,
    ]);
    expect(results.every((result) => result.samples === 100)).toBe(true);
    expect(results.every((result) => result.medianMs >= 0)).toBe(true);
    expect(results.every((result) => result.p95Ms >= result.medianMs)).toBe(
      true,
    );
  });

  it('compares legacy and block emission with buffered and captured loggers', () => {
    const results = runSummaryEmissionBenchmark();

    expect(results).toHaveLength(8);
    expect(
      results.map(({ scoredWhales, logger }) => [scoredWhales, logger]),
    ).toEqual([
      [0, 'buffered'],
      [0, 'captured-console'],
      [10, 'buffered'],
      [10, 'captured-console'],
      [100, 'buffered'],
      [100, 'captured-console'],
      [200, 'buffered'],
      [200, 'captured-console'],
    ]);

    for (const result of results) {
      expect(result.legacyCalls).toBe(19 + result.scoredWhales);
      expect(result.blockCalls).toBe(1);
      expect(result.legacyBytes).toBe(result.blockBytes);
      expect(result.legacy.samples).toBe(100);
      expect(result.block.samples).toBe(100);
      expect(result.legacy.p95Ms).toBeGreaterThanOrEqual(result.legacy.p50Ms);
      expect(result.legacy.p99Ms).toBeGreaterThanOrEqual(result.legacy.p95Ms);
      expect(result.block.p95Ms).toBeGreaterThanOrEqual(result.block.p50Ms);
      expect(result.block.p99Ms).toBeGreaterThanOrEqual(result.block.p95Ms);
    }
  });

  it('runs a deterministic multi-symbol burst and prints percentiles', async () => {
    const output: string[] = [];
    const logger = vi
      .spyOn(console, 'log')
      .mockImplementation((message: unknown) => {
        output.push(String(message));
      });

    await runPerformanceReport(['9']);

    logger.mockRestore();

    const report = output.join('\n');

    expect(report).toContain('LIVE PERFORMANCE ATTRIBUTION REPORT');
    expect(report).toContain('Symbols=3 updates=9 burst=100');
    expect(report).toContain('core/no-attribution');
    expect(report).toContain('core/attribution');
    expect(report).toContain('summary/buffered-console');
    expect(report).toMatch(/p50=.*p95=.*p99=/);
    expect(report).toContain('Attribution throughput impact:');
    expect(report).toContain('SUMMARY FORMATTING BENCHMARK');
    expect(report).toContain('SUMMARY EMISSION BENCHMARK');
    expect(report).toContain('logger=buffered');
    expect(report).toContain('logger=captured-console');
    expect(report).toContain('calls=19->1');
    expect(report).toContain('scoredWhales=  0 n=100');
    expect(report).toContain('scoredWhales=200 n=100');
    expect(report).toContain('do not prove CPU ownership');
  });
});
