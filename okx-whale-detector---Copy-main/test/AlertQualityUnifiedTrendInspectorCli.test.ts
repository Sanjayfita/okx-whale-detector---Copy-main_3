import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildAlertQualityUnifiedTrend,
  generateAlertQualityUnifiedReport,
  writeAlertQualityUnifiedTrends,
  type AlertQualityUnifiedReport,
} from '../src/evaluation';
import { runAlertQualityTrendInspectorCli } from '../src/tools/inspectAlertQualityUnifiedTrends';
import {
  createTargetStopFixture,
  generateTargetStopFixtureRecord,
} from './helpers/targetStopFixtures';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const createTrend = () => {
  const fixture = createTargetStopFixture();
  const shared = {
    terminalReturnRecords: [fixture.terminalReturn],
    pathOutcomeRecords: [fixture.pathOutcome],
    targetStopRecords: [generateTargetStopFixtureRecord(fixture)],
    groupingDimensions: ['HORIZON_MS', 'SOURCE'] as const,
  };
  const reports = [0, 1, 2].map((index) =>
    JSON.parse(
      JSON.stringify(
        generateAlertQualityUnifiedReport({
          ...shared,
          reportRunId: `alert-quality-report:inspector-${index}`,
          generatedAt: 1_700_000_000_000 + index,
        }),
      ),
    ) as AlertQualityUnifiedReport,
  );
  const observed = reports[2]!.terminalReturn.groups.find(
    (group) => group.coverage.eligibleRate !== null,
  )!;
  observed.coverage.eligibleRate = observed.coverage.eligibleRate! - 0.01;
  return buildAlertQualityUnifiedTrend(reports);
};

describe('persisted alert-quality trend inspector CLI', () => {
  it('summarizes a valid persisted trend', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'trend-inspector-'));
    directories.push(directory);
    const filePath = path.join(directory, 'trends.jsonl');
    await writeAlertQualityUnifiedTrends(filePath, [createTrend()]);
    const logs: string[] = [];

    const code = await runAlertQualityTrendInspectorCli(['--file', filePath], {
      log: (...values) => logs.push(values.map(String).join(' ')),
    });

    expect(code).toBe(0);
    expect(logs).toContain('ALERT QUALITY TREND INSPECTION');
    expect(logs).toContain('Trends: 1');
    expect(logs).toContain('Reports: 3');
    expect(logs).toContain('Transitions: 2');
    expect(logs.some((line) => line.startsWith('Overall degraded metrics: '))).toBe(true);
    expect(logs.at(-1)).toContain('not a trading recommendation');
  });

  it('reports malformed and unsupported lines without crashing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'trend-inspector-'));
    directories.push(directory);
    const filePath = path.join(directory, 'issues.jsonl');
    await writeFile(filePath, '{bad json}\n{"schemaVersion":999}\n', 'utf8');
    const logs: string[] = [];

    const code = await runAlertQualityTrendInspectorCli(['--file', filePath], {
      log: (...values) => logs.push(values.map(String).join(' ')),
    });

    expect(code).toBe(0);
    expect(logs).toContain('Trends: 0');
    expect(logs).toContain('Malformed JSON lines: 1');
    expect(logs).toContain('Unsupported schema versions: 1');
  });

  it('returns a failure code for invalid arguments', async () => {
    const errors: string[] = [];
    const code = await runAlertQualityTrendInspectorCli([], {
      error: (...values) => errors.push(values.map(String).join(' ')),
    });

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('Usage: alerts:inspect:quality-trend');
  });

  it('returns a failure code when the file cannot be read', async () => {
    const errors: string[] = [];
    const code = await runAlertQualityTrendInspectorCli(
      ['--file', path.join(tmpdir(), 'missing-alert-quality-trend.jsonl')],
      { error: (...values) => errors.push(values.map(String).join(' ')) },
    );

    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('trend inspection failed');
  });
});
