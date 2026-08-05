import { describe, expect, it } from 'vitest';

import {
  aggregateTargetStopQuality,
  createTargetStopPolicy,
} from '../src/evaluation';
import { generateTargetStopFixtureRecord } from './helpers/targetStopFixtures';

const generate = (
  records = [generateTargetStopFixtureRecord()],
  groupingDimensions: Parameters<typeof aggregateTargetStopQuality>[0]['groupingDimensions'] = [],
) =>
  aggregateTargetStopQuality({
    records,
    reportRunId: 'alert-quality-target-stop:test',
    generatedAt: 1_700_000_000_000,
    groupingDimensions,
  });

const overall = (
  report: ReturnType<typeof generate>,
  family: ReturnType<typeof generate>['groups'][number]['family'],
) => report.groups.find((group) => group.dimension === 'OVERALL' && group.family === family)!;

describe('target/stop quality aggregation', () => {
  it('returns an empty deterministic report', () => {
    const report = generate([]);
    expect(report.uniqueCellCount).toBe(0);
    expect(report.groups).toEqual([]);
  });

  it('creates separate result families', () => {
    const report = generate();
    expect(new Set(report.groups.map((group) => group.family))).toEqual(
      new Set([
        'OKX',
        'EXTERNAL',
        'EXECUTABLE_OKX',
        'EXECUTABLE_EXTERNAL',
        'CANDLE_OKX',
        'CANDLE_EXTERNAL',
      ]),
    );
  });

  it('uses resolved outcomes as the first-hit denominator', () => {
    const statistics = overall(generate(), 'OKX').statistics;
    expect(statistics.resolvedCount).toBe(
      statistics.targetFirstCount +
        statistics.stopFirstCount +
        statistics.neitherCount +
        statistics.tieCount,
    );
    if (statistics.resolvedCount > 0) {
      expect(statistics.targetFirstRateAmongResolved).toBe(
        statistics.targetFirstCount / statistics.resolvedCount,
      );
    }
  });

  it('does not treat ambiguous candle outcomes as losses', () => {
    const statistics = overall(generate(), 'CANDLE_OKX').statistics;
    expect(statistics.stopFirstCount).toBeLessThanOrEqual(statistics.resolvedCount);
    expect(statistics.ambiguousCount).toBeGreaterThanOrEqual(
      statistics.candleAmbiguityCount,
    );
  });

  it('keeps OKX and external contradiction hypotheses separate', () => {
    const record = generateTargetStopFixtureRecord(undefined, undefined, {});
    record.alertContext.okxBias = 'BULLISH';
    record.alertContext.externalBias = 'BEARISH';
    record.alertContext.relationship = 'CONTRADICTION';
    const report = generate([record]);
    expect(overall(report, 'OKX').groupKey).not.toBe(
      overall(report, 'EXTERNAL').groupKey,
    );
  });

  it('creates deterministic requested groups', () => {
    const first = generate(undefined, ['SOURCE', 'HORIZON_MS']);
    const second = generate(undefined, ['HORIZON_MS', 'SOURCE']);
    expect(first).toEqual(second);
    expect(first.groupingDimensions).toEqual(['HORIZON_MS', 'SOURCE']);
  });

  it('detects exact duplicate cells without double-counting', () => {
    const record = generateTargetStopFixtureRecord();
    const report = generate([record, record]);
    expect(report.exactDuplicateCellCount).toBe(record.outcomes.length);
    expect(report.uniqueCellCount).toBe(record.outcomes.length);
  });

  it('rejects conflicting duplicate cells', () => {
    const first = generateTargetStopFixtureRecord();
    const second = structuredClone(first);
    second.outcomes[0]!.targetPercent += 0.5;
    expect(() => generate([first, second])).toThrow(
      'Conflicting duplicate target/stop cell',
    );
  });

  it('separates policy fingerprints', () => {
    const first = generateTargetStopFixtureRecord();
    const second = generateTargetStopFixtureRecord(
      undefined,
      createTargetStopPolicy({ targetPercent: 2, stopPercent: 1 }),
    );
    const report = generate([first, second]);
    expect(report.policyFingerprints).toHaveLength(2);
    expect(report.groups.filter((group) => group.dimension === 'OVERALL')).toHaveLength(12);
  });

  it('rejects non-finite target/stop percentages', () => {
    const record = generateTargetStopFixtureRecord();
    record.outcomes[0]!.targetPercent = Number.NaN;
    expect(() => generate([record])).toThrow(
      'Target/stop percentages must be finite',
    );
  });

  it('does not mutate source records', () => {
    const record = generateTargetStopFixtureRecord();
    const before = structuredClone(record);
    generate([record], ['SOURCE']);
    expect(record).toEqual(before);
  });
});
