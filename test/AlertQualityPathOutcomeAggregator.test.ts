import { describe, expect, it } from 'vitest';

import {
  aggregatePathOutcomeQuality,
  createPathOutcomePolicy,
  type AlertPathOutcomeRecord,
} from '../src/evaluation';
import {
  createPathFixture,
  generatePathFixtureRecord,
  PATH_OUTCOME_NOW,
} from './helpers/pathOutcomeFixtures';

const aggregate = (
  records: readonly AlertPathOutcomeRecord[],
  groupingDimensions: Parameters<typeof aggregatePathOutcomeQuality>[0]['groupingDimensions'] = [],
) =>
  aggregatePathOutcomeQuality({
    records,
    reportRunId: 'alert-quality-path:test',
    generatedAt: PATH_OUTCOME_NOW + 1,
    groupingDimensions,
  });

describe('alert-quality path outcome aggregation', () => {
  it('returns deterministic empty output', () => {
    expect(aggregate([])).toEqual(aggregate([]));
    expect(aggregate([]).groups).toEqual([]);
  });

  it('summarizes raw, directional, and executable excursions separately', () => {
    const report = aggregate([generatePathFixtureRecord()]);
    const overall = report.groups[0]!;

    expect(overall.coverage.totalCellCount).toBe(15);
    expect(overall.metrics.raw.favorableExcursionPercent.observationCount).toBeGreaterThan(0);
    expect(overall.metrics.okxDirectional.favorableExcursionPercent.observationCount).toBeGreaterThan(0);
    expect(overall.metrics.externalDirectional.adverseExcursionPercent.observationCount).toBeGreaterThan(0);
    expect(overall.metrics.executableOkx.favorableExcursionPercent.observationCount).toBeGreaterThan(0);
    expect(overall.metrics.executableExternal.adverseExcursionPercent.observationCount).toBeGreaterThan(0);
  });

  it('keeps candle bounds separate from exact path metrics', () => {
    const report = aggregate([generatePathFixtureRecord()]);
    const overall = report.groups[0]!;

    expect(overall.metrics.candleOkx.favorableBoundPercent.observationCount).toBeGreaterThan(0);
    expect(overall.metrics.candleExternal.adverseBoundPercent.observationCount).toBeGreaterThan(0);
    expect(overall.metrics.candleOkx.favorableBoundPercent).not.toEqual(
      overall.metrics.raw.favorableExcursionPercent,
    );
  });

  it('preserves contradiction directions independently', () => {
    const record = generatePathFixtureRecord(
      createPathFixture({ okxBias: 'BULLISH', externalBias: 'BEARISH' }),
    );
    const overall = aggregate([record]).groups[0]!;

    expect(overall.metrics.okxDirectional.favorableExcursionPercent.mean).not.toBeNull();
    expect(overall.metrics.externalDirectional.favorableExcursionPercent.mean).not.toBeNull();
  });

  it('creates deterministic overall and requested groups', () => {
    const report = aggregate([generatePathFixtureRecord()], ['SOURCE', 'HORIZON_MS']);

    expect(report.groups.some((group) => group.dimension === 'OVERALL')).toBe(true);
    expect(report.groups.some((group) => group.dimension === 'SOURCE')).toBe(true);
    expect(report.groups.some((group) => group.dimension === 'HORIZON_MS')).toBe(true);
    expect(report.groups.map((group) => group.groupKey)).toEqual(
      [...report.groups.map((group) => group.groupKey)].sort(),
    );
  });

  it('does not double-count exact duplicate cells', () => {
    const record = generatePathFixtureRecord();
    const report = aggregate([record, structuredClone(record)]);

    expect(report.inputRecordCount).toBe(2);
    expect(report.uniqueCellCount).toBe(15);
    expect(report.exactDuplicateCellCount).toBe(15);
    expect(report.groups[0]!.coverage.totalCellCount).toBe(15);
  });

  it('rejects conflicting duplicate cells', () => {
    const record = generatePathFixtureRecord();
    const conflicting = structuredClone(record);
    conflicting.paths[0]!.sampleCount += 1;

    expect(() => aggregate([record, conflicting])).toThrow(
      'Conflicting duplicate path-outcome cell',
    );
  });

  it('rejects non-finite path metrics', () => {
    const record = structuredClone(generatePathFixtureRecord());
    const cell = record.paths.find((candidate) => candidate.raw !== null)!;
    cell.raw!.favorableExcursionPercent = Number.NaN;

    expect(() => aggregate([record])).toThrow('must be finite');
  });

  it('separates incompatible policy fingerprints', () => {
    const first = generatePathFixtureRecord();
    const second = structuredClone(first);
    second.pathOutcomeId = `${first.pathOutcomeId}:other`;
    second.policy = createPathOutcomePolicy({
      floatingPointPolicy: { relativeTolerance: 2e-12 },
    });

    const report = aggregate([first, second]);
    expect(report.policyFingerprints).toHaveLength(2);
    expect(report.groups.filter((group) => group.dimension === 'OVERALL')).toHaveLength(2);
  });

  it('validates metadata and grouping dimensions', () => {
    const record = generatePathFixtureRecord();
    expect(() =>
      aggregatePathOutcomeQuality({
        records: [record],
        reportRunId: 'bad id',
        generatedAt: PATH_OUTCOME_NOW,
      }),
    ).toThrow('reportRunId');
    expect(() => aggregate([record], ['SOURCE', 'SOURCE'])).toThrow('must be unique');
  });

  it('does not mutate source records', () => {
    const record = generatePathFixtureRecord();
    const before = structuredClone(record);
    aggregate([record], ['SOURCE']);
    expect(record).toEqual(before);
  });
});
