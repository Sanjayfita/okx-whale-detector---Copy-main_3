import { describe, expect, it } from 'vitest';

import { aggregateTerminalReturnQuality } from '../src/evaluation';
import {
  createReturnEvaluation,
  createTerminalReturnRecord,
} from './helpers/terminalReturnFixtures';

const aggregate = (
  records = [createTerminalReturnRecord()],
  groupingDimensions: Parameters<
    typeof aggregateTerminalReturnQuality
  >[0]['groupingDimensions'] = [],
) =>
  aggregateTerminalReturnQuality({
    records,
    reportRunId: 'alert-quality-run:test',
    generatedAt: 1_700_000_000_000,
    groupingDimensions,
  });

describe('terminal-return alert-quality aggregation', () => {
  it('creates one compatibility-partitioned overall group', () => {
    const report = aggregate();

    expect(report.inputRecordCount).toBe(1);
    expect(report.uniqueCellCount).toBe(15);
    expect(report.exactDuplicateCellCount).toBe(0);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.dimension).toBe('OVERALL');
    expect(report.groups[0]?.coverage.totalCellCount).toBe(15);
  });

  it('keeps eligibility and alignment-quality counts explicit', () => {
    const record = createTerminalReturnRecord();
    record.returns[0]!.eligibility = 'AMBIGUOUS';
    record.returns[0]!.alignmentCompleteness = 'AMBIGUOUS';
    record.returns[1]!.eligibility = 'INELIGIBLE';
    record.returns[1]!.alignmentCompleteness = 'MISSING';
    record.returns[2]!.eligibility = 'INELIGIBLE';
    record.returns[2]!.alignmentCompleteness = 'PARTIAL';
    record.returns[3]!.eligibility = 'INELIGIBLE';
    record.returns[3]!.alignmentCompleteness = 'INVALID';

    const coverage = aggregate([record]).groups[0]!.coverage;

    expect(coverage.ambiguousCellCount).toBe(1);
    expect(coverage.ineligibleCellCount).toBe(3);
    expect(coverage.missingCellCount).toBe(1);
    expect(coverage.partialCellCount).toBe(1);
    expect(coverage.invalidCellCount).toBe(1);
  });

  it('summarizes raw and directional return families separately', () => {
    const record = createTerminalReturnRecord(
      createReturnEvaluation({
        relationship: 'CONTRADICTION',
        okxBias: 'BULLISH',
        externalBias: 'BEARISH',
      }),
    );

    const returns = aggregate([record]).groups[0]!.returns;

    expect(returns.rawReturnPercent.observationCount).toBeGreaterThan(0);
    expect(returns.okxDirectionalReturnPercent.mean).not.toBe(
      returns.externalDirectionalReturnPercent.mean,
    );
    expect(returns.okxExecutableDirectionalReturnPercent.observationCount).toBe(
      returns.externalExecutableDirectionalReturnPercent.observationCount,
    );
  });

  it('creates deterministic independent dimension groups', () => {
    const report = aggregate([createTerminalReturnRecord()], [
      'SOURCE',
      'HORIZON_MS',
    ]);

    expect(report.groups.filter((group) => group.dimension === 'SOURCE')).toHaveLength(
      3,
    );
    expect(
      report.groups.filter((group) => group.dimension === 'HORIZON_MS'),
    ).toHaveLength(5);
    expect(report.groups.map((group) => group.groupKey)).toEqual(
      [...report.groups.map((group) => group.groupKey)].sort(),
    );
  });

  it('deduplicates exact immutable cells without double-counting', () => {
    const record = createTerminalReturnRecord();
    const report = aggregate([record, record]);

    expect(report.inputRecordCount).toBe(2);
    expect(report.uniqueCellCount).toBe(15);
    expect(report.exactDuplicateCellCount).toBe(15);
    expect(report.groups[0]?.coverage.totalCellCount).toBe(15);
  });

  it('rejects conflicting duplicate immutable cells', () => {
    const original = createTerminalReturnRecord();
    const conflicting = structuredClone(original);
    conflicting.returns[0]!.rawReturnPercent = 999;

    expect(() => aggregate([original, conflicting])).toThrow(
      'Conflicting duplicate terminal-return cell',
    );
  });

  it('does not collapse different outcome identities', () => {
    const first = createTerminalReturnRecord(createReturnEvaluation({ sequence: 1 }));
    const second = createTerminalReturnRecord(createReturnEvaluation({ sequence: 2 }));
    const report = aggregate([first, second]);

    expect(report.uniqueCellCount).toBe(30);
    expect(report.groups[0]?.coverage.totalCellCount).toBe(30);
  });

  it('returns deeply identical reports for identical injected inputs', () => {
    const record = createTerminalReturnRecord();
    const first = aggregate([record], ['SOURCE', 'INSTRUMENT_ID']);
    const second = aggregate([record], ['INSTRUMENT_ID', 'SOURCE']);

    expect(second).toEqual(first);
  });

  it('returns null rates and empty metrics for empty input', () => {
    const report = aggregate([]);

    expect(report.groups).toEqual([]);
    expect(report.uniqueCellCount).toBe(0);
    expect(report.evaluatorVersions).toEqual([]);
    expect(report.policyFingerprints).toEqual([]);
  });

  it('rejects non-finite metric values', () => {
    const record = createTerminalReturnRecord();
    record.returns[0]!.rawReturnPercent = Number.NaN;

    expect(() => aggregate([record])).toThrow(
      'rawReturnPercent must be finite when present',
    );
  });

  it('rejects duplicate grouping dimensions', () => {
    expect(() => aggregate([], ['SOURCE', 'SOURCE'])).toThrow(
      'groupingDimensions must be unique',
    );
  });
});
