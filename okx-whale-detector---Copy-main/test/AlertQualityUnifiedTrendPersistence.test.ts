import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildAlertQualityUnifiedTrend,
  generateAlertQualityUnifiedReport,
  readAlertQualityUnifiedTrends,
  readAlertQualityUnifiedTrendsFromText,
  serializeAlertQualityUnifiedTrend,
  serializeAlertQualityUnifiedTrends,
  validateAlertQualityUnifiedTrend,
  writeAlertQualityUnifiedTrends,
  type AlertQualityUnifiedReport,
  type AlertQualityUnifiedTrend,
} from '../src/evaluation';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const directories: string[] = [];
afterEach(() => {
  directories.splice(0).forEach((directory) =>
    rmSync(directory, { recursive: true, force: true }),
  );
});

const createTrend = (): AlertQualityUnifiedTrend => {
  const fixture = createTargetStopFixture();
  const input = {
    terminalReturnRecords: [fixture.terminalReturn],
    pathOutcomeRecords: [fixture.pathOutcome],
    targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
    groupingDimensions: ['HORIZON_MS', 'SOURCE'] as const,
  };
  const reports = [0, 1, 2].map((index) =>
    generateAlertQualityUnifiedReport({
      ...input,
      reportRunId: `alert-quality-report:persistence-${index}`,
      generatedAt: 1_700_000_000_000 + index,
    }),
  ) as AlertQualityUnifiedReport[];
  return buildAlertQualityUnifiedTrend(reports);
};

const clone = (trend: AlertQualityUnifiedTrend): AlertQualityUnifiedTrend =>
  JSON.parse(JSON.stringify(trend)) as AlertQualityUnifiedTrend;

describe('alert-quality unified trend persistence', () => {
  it('serializes deterministically with one trailing newline', () => {
    const trend = createTrend();
    const first = serializeAlertQualityUnifiedTrend(trend);
    const second = serializeAlertQualityUnifiedTrend(clone(trend));

    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
    expect(first.endsWith('\n\n')).toBe(false);
  });

  it('round-trips persisted trends without changing material', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'trend-persistence-'));
    directories.push(directory);
    const filePath = path.join(directory, 'trends.jsonl');
    const trend = createTrend();

    await writeAlertQualityUnifiedTrends(filePath, [trend]);
    const read = await readAlertQualityUnifiedTrends(filePath);

    expect(read.issues).toEqual([]);
    expect(read.exactDuplicateCount).toBe(0);
    expect(read.trends).toHaveLength(1);
    expect(serializeAlertQualityUnifiedTrend(read.trends[0]!)).toBe(
      readFileSync(filePath, 'utf8'),
    );
  });

  it('deduplicates exact repeats and sorts trend identities deterministically', () => {
    const first = createTrend();
    const second = clone(first);
    second.reports[0]!.reportRunId = 'alert-quality-report:aaa';
    const serialized = serializeAlertQualityUnifiedTrends([first, second, first]);
    const read = readAlertQualityUnifiedTrendsFromText(serialized + serializeAlertQualityUnifiedTrend(first));

    expect(read.trends).toHaveLength(2);
    expect(read.exactDuplicateCount).toBe(1);
    expect(read.issues).toEqual([]);
  });

  it('reports malformed JSON, unsupported schemas, and invalid trends independently', () => {
    const trend = createTrend();
    const unsupported = { ...clone(trend), schemaVersion: 999 };
    const invalid = clone(trend);
    invalid.transitions = [];
    const text = [
      '{not json',
      JSON.stringify(unsupported),
      JSON.stringify(invalid),
      serializeAlertQualityUnifiedTrend(trend).trim(),
    ].join('\n');

    const read = readAlertQualityUnifiedTrendsFromText(text);
    expect(read.trends).toHaveLength(1);
    expect(read.issues.map((issue) => issue.reason)).toEqual([
      'MALFORMED_JSON',
      'UNSUPPORTED_SCHEMA_VERSION',
      'INVALID_TREND',
    ]);
  });

  it('rejects conflicting duplicate trend identities', () => {
    const first = createTrend();
    const conflicting = clone(first);
    conflicting.totalImprovedMetricCount += 1;

    expect(() => serializeAlertQualityUnifiedTrends([first, conflicting])).toThrow(
      'Conflicting duplicate unified trend',
    );
  });

  it('validates required counts, report identities, and metric keys', () => {
    const trend = createTrend();
    expect(validateAlertQualityUnifiedTrend(trend)).toBe(true);

    const duplicateReport = clone(trend);
    duplicateReport.reports[1]!.generatedAt = duplicateReport.reports[0]!.generatedAt;
    duplicateReport.reports[1]!.reportRunId = duplicateReport.reports[0]!.reportRunId;
    expect(() => validateAlertQualityUnifiedTrend(duplicateReport)).toThrow(
      'identities must be unique',
    );

    const duplicateMetric = clone(trend);
    duplicateMetric.metrics = [duplicateMetric.metrics[0]!, duplicateMetric.metrics[0]!];
    expect(() => validateAlertQualityUnifiedTrend(duplicateMetric)).toThrow(
      'metric keys must be unique',
    );
  });
});
