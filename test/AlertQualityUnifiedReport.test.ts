import { describe, expect, it } from 'vitest';

import { generateAlertQualityUnifiedReport } from '../src/evaluation';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const createInput = () => {
  const fixture = createTargetStopFixture();
  return {
    terminalReturnRecords: [fixture.terminalReturn],
    pathOutcomeRecords: [fixture.pathOutcome],
    targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
    reportRunId: 'alert-quality-report:test',
    generatedAt: 1_700_000_000_000,
  } as const;
};

describe('unified alert-quality report', () => {
  it('combines terminal-return, path, and target-stop reports', () => {
    const report = generateAlertQualityUnifiedReport(createInput());

    expect(report.inputRecordCounts).toEqual({
      terminalReturn: 1,
      pathOutcome: 1,
      targetStop: 1,
    });
    expect(report.terminalReturn.inputRecordCount).toBe(1);
    expect(report.pathOutcome.inputRecordCount).toBe(1);
    expect(report.targetStop.inputRecordCount).toBe(1);
  });

  it('uses the same injected identity and timestamp for every section', () => {
    const report = generateAlertQualityUnifiedReport(createInput());

    expect(report.reportRunId).toBe('alert-quality-report:test');
    expect(report.generatedAt).toBe(1_700_000_000_000);
    expect(report.terminalReturn.reportRunId).toBe(report.reportRunId);
    expect(report.pathOutcome.reportRunId).toBe(report.reportRunId);
    expect(report.targetStop.reportRunId).toBe(report.reportRunId);
    expect(report.terminalReturn.generatedAt).toBe(report.generatedAt);
    expect(report.pathOutcome.generatedAt).toBe(report.generatedAt);
    expect(report.targetStop.generatedAt).toBe(report.generatedAt);
  });

  it('forwards one deterministic dimension set to every section', () => {
    const report = generateAlertQualityUnifiedReport({
      ...createInput(),
      groupingDimensions: ['SOURCE', 'HORIZON_MS'],
    });

    expect(report.groupingDimensions).toEqual(['SOURCE', 'HORIZON_MS']);
    expect(report.terminalReturn.groupingDimensions).toEqual([
      'HORIZON_MS',
      'SOURCE',
    ]);
    expect(report.pathOutcome.groupingDimensions).toEqual([
      'HORIZON_MS',
      'SOURCE',
    ]);
    expect(report.targetStop.groupingDimensions).toEqual([
      'HORIZON_MS',
      'SOURCE',
    ]);
  });

  it('supports an empty report without invented observations', () => {
    const report = generateAlertQualityUnifiedReport({
      terminalReturnRecords: [],
      pathOutcomeRecords: [],
      targetStopRecords: [],
      reportRunId: 'alert-quality-report:empty',
      generatedAt: 0,
    });

    expect(report.inputRecordCounts).toEqual({
      terminalReturn: 0,
      pathOutcome: 0,
      targetStop: 0,
    });
    expect(report.terminalReturn.groups).toEqual([]);
    expect(report.pathOutcome.groups).toEqual([]);
    expect(report.targetStop.groups).toEqual([]);
  });

  it('preserves exact duplicate accounting inside each section', () => {
    const input = createInput();
    const report = generateAlertQualityUnifiedReport({
      ...input,
      terminalReturnRecords: [
        input.terminalReturnRecords[0],
        input.terminalReturnRecords[0],
      ],
      pathOutcomeRecords: [input.pathOutcomeRecords[0], input.pathOutcomeRecords[0]],
      targetStopRecords: [input.targetStopRecords[0], input.targetStopRecords[0]],
    });

    expect(report.terminalReturn.exactDuplicateCellCount).toBeGreaterThan(0);
    expect(report.pathOutcome.exactDuplicateCellCount).toBeGreaterThan(0);
    expect(report.targetStop.exactDuplicateCellCount).toBeGreaterThan(0);
  });

  it('rejects an invalid report run ID', () => {
    expect(() =>
      generateAlertQualityUnifiedReport({
        ...createInput(),
        reportRunId: 'invalid report id',
      }),
    ).toThrow('reportRunId must be a valid durable identifier');
  });

  it('rejects an invalid generation timestamp', () => {
    expect(() =>
      generateAlertQualityUnifiedReport({
        ...createInput(),
        generatedAt: Number.NaN,
      }),
    ).toThrow('generatedAt must be a non-negative safe integer');
  });

  it('delegates duplicate dimension validation consistently', () => {
    expect(() =>
      generateAlertQualityUnifiedReport({
        ...createInput(),
        groupingDimensions: ['SOURCE', 'SOURCE'],
      }),
    ).toThrow('groupingDimensions must be unique');
  });

  it('does not mutate source records or caller-owned dimension arrays', () => {
    const input = createInput();
    const dimensions = ['SOURCE'] as const;
    const before = JSON.stringify(input);

    generateAlertQualityUnifiedReport({
      ...input,
      groupingDimensions: dimensions,
    });

    expect(JSON.stringify(input)).toBe(before);
    expect(dimensions).toEqual(['SOURCE']);
  });
});
