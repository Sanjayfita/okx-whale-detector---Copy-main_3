import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  generateAlertQualityUnifiedReport,
  readAlertQualityUnifiedReports,
  readAlertQualityUnifiedReportsFromText,
  serializeAlertQualityUnifiedReport,
  serializeAlertQualityUnifiedReports,
  validateAlertQualityUnifiedReport,
  writeAlertQualityUnifiedReports,
} from '../src/evaluation';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const createReport = (
  overrides: { reportRunId?: string; generatedAt?: number } = {},
) => {
  const fixture = createTargetStopFixture();
  return generateAlertQualityUnifiedReport({
    terminalReturnRecords: [fixture.terminalReturn],
    pathOutcomeRecords: [fixture.pathOutcome],
    targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
    reportRunId: overrides.reportRunId ?? 'alert-quality-report:persistence',
    generatedAt: overrides.generatedAt ?? 1_700_000_000_000,
    groupingDimensions: ['SOURCE', 'HORIZON_MS'],
  });
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('unified alert-quality report persistence', () => {
  it('serializes one report canonically with one trailing newline', () => {
    const report = createReport();
    const serialized = serializeAlertQualityUnifiedReport(report);

    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized.endsWith('\n\n')).toBe(false);
    expect(JSON.parse(serialized)).toEqual(report);
  });

  it('writes and reads a report round trip', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'alert-quality-report-'));
    directories.push(directory);
    const filePath = join(directory, 'reports.jsonl');
    const report = createReport();

    await writeAlertQualityUnifiedReports(filePath, [report]);
    const result = await readAlertQualityUnifiedReports(filePath);

    expect(result.reports).toEqual([report]);
    expect(result.exactDuplicateCount).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it('produces byte-identical output for identical injected inputs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'alert-quality-report-'));
    directories.push(directory);
    const first = join(directory, 'first.jsonl');
    const second = join(directory, 'second.jsonl');
    const report = createReport();

    await writeAlertQualityUnifiedReports(first, [report]);
    await writeAlertQualityUnifiedReports(second, [clone(report)]);

    expect(await readFile(first, 'utf8')).toBe(await readFile(second, 'utf8'));
  });

  it('sorts multiple reports deterministically', () => {
    const later = createReport({ reportRunId: 'report:z', generatedAt: 2 });
    const earlier = createReport({ reportRunId: 'report:a', generatedAt: 1 });

    expect(serializeAlertQualityUnifiedReports([later, earlier])).toBe(
      serializeAlertQualityUnifiedReports([earlier, later]),
    );
  });

  it('deduplicates exact duplicate reports while reading', () => {
    const serialized = serializeAlertQualityUnifiedReport(createReport());
    const result = readAlertQualityUnifiedReportsFromText(serialized + serialized);

    expect(result.reports).toHaveLength(1);
    expect(result.exactDuplicateCount).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('rejects conflicting duplicates while serializing', () => {
    const first = createReport();
    const conflicting = clone(first);
    conflicting.inputRecordCounts.terminalReturn += 1;
    conflicting.terminalReturn.inputRecordCount += 1;

    expect(() => serializeAlertQualityUnifiedReports([first, conflicting])).toThrow(
      'Conflicting duplicate unified report',
    );
  });

  it('reports malformed JSON without discarding valid reports', () => {
    const valid = serializeAlertQualityUnifiedReport(createReport());
    const result = readAlertQualityUnifiedReportsFromText(`{broken}\n${valid}`);

    expect(result.reports).toHaveLength(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.reason).toBe('MALFORMED_JSON');
    expect(result.issues[0]?.lineNumber).toBe(1);
  });

  it('reports unsupported schema versions separately', () => {
    const report = clone(createReport()) as unknown as Record<string, unknown>;
    report.schemaVersion = 999;
    const result = readAlertQualityUnifiedReportsFromText(`${JSON.stringify(report)}\n`);

    expect(result.reports).toEqual([]);
    expect(result.issues[0]?.reason).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('rejects inconsistent section metadata', () => {
    const report = clone(createReport());
    report.pathOutcome.reportRunId = 'different-run';

    expect(() => validateAlertQualityUnifiedReport(report)).toThrow(
      'pathOutcome.reportRunId must match the unified report',
    );
  });

  it('rejects inconsistent input counts', () => {
    const report = clone(createReport());
    report.inputRecordCounts.targetStop += 1;

    expect(() => validateAlertQualityUnifiedReport(report)).toThrow(
      'targetStop input count mismatch',
    );
  });

  it('does not mutate reports during serialization or validation', () => {
    const report = createReport();
    const before = JSON.stringify(report);

    validateAlertQualityUnifiedReport(report);
    serializeAlertQualityUnifiedReports([report, report]);

    expect(JSON.stringify(report)).toBe(before);
  });
});
