import path from 'node:path';

import {
  compareAlertQualityUnifiedReports,
  readAlertQualityUnifiedReports,
  type AlertQualityMetricDelta,
} from '../evaluation';

export interface AlertQualityComparisonCliDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const readSingleReport = async (filePath: string, label: string) => {
  const result = await readAlertQualityUnifiedReports(filePath);
  if (result.issues.length > 0) {
    throw new Error(`${label} report file contains ${result.issues.length} read issue(s)`);
  }
  if (result.reports.length !== 1) {
    throw new Error(`${label} report file must contain exactly one unique report`);
  }
  return result.reports[0]!;
};

const formatValue = (value: number | null): string =>
  value === null ? 'n/a' : Number.isInteger(value) ? String(value) : value.toFixed(6);

const formatMetric = (entry: AlertQualityMetricDelta): string => {
  const family = entry.family === null ? '' : ` | ${entry.family}`;
  return [
    `${entry.change} | ${entry.section}${family}`,
    `${entry.dimension}=${String(entry.value ?? 'OVERALL')}`,
    entry.metric,
    `${formatValue(entry.baseline)} -> ${formatValue(entry.candidate)}`,
    `delta=${formatValue(entry.delta)}`,
  ].join(' | ');
};

export const runAlertQualityComparisonCli = async (
  args: readonly string[],
  dependencies: AlertQualityComparisonCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  try {
    if (
      args.length !== 4 ||
      args[0] !== '--baseline' ||
      !args[1] ||
      args[2] !== '--candidate' ||
      !args[3]
    ) {
      throw new Error(
        'Usage: alerts:compare:quality -- --baseline <baseline.jsonl> --candidate <candidate.jsonl>',
      );
    }
    const baselinePath = path.resolve(args[1]);
    const candidatePath = path.resolve(args[3]);
    if (
      (process.platform === 'win32' ? baselinePath.toLowerCase() : baselinePath) ===
      (process.platform === 'win32' ? candidatePath.toLowerCase() : candidatePath)
    ) {
      throw new Error('Baseline and candidate report paths must be distinct');
    }

    const [baseline, candidate] = await Promise.all([
      readSingleReport(baselinePath, 'Baseline'),
      readSingleReport(candidatePath, 'Candidate'),
    ]);
    const comparison = compareAlertQualityUnifiedReports(baseline, candidate);

    log('ALERT QUALITY HISTORICAL COMPARISON');
    log(`Baseline: ${comparison.baselineReportRunId} @ ${comparison.baselineGeneratedAt}`);
    log(`Candidate: ${comparison.candidateReportRunId} @ ${comparison.candidateGeneratedAt}`);
    log(`Grouping dimensions: ${comparison.groupingDimensions.join(', ') || 'none'}`);
    log(
      `Matched groups: terminal=${comparison.matchedGroupCounts.terminalReturn}, path=${comparison.matchedGroupCounts.pathOutcome}, target/stop=${comparison.matchedGroupCounts.targetStop}`,
    );
    log(`Added groups: ${comparison.addedGroupKeys.length}`);
    log(`Removed groups: ${comparison.removedGroupKeys.length}`);
    log(`Improved metrics: ${comparison.improvedMetricCount}`);
    log(`Degraded metrics: ${comparison.degradedMetricCount}`);
    log(`Unchanged metrics: ${comparison.unchangedMetricCount}`);
    log(`Unavailable metrics: ${comparison.unavailableMetricCount}`);

    const changed = comparison.metrics.filter(
      (entry) => entry.change === 'IMPROVED' || entry.change === 'DEGRADED',
    );
    log('CHANGED METRICS');
    if (changed.length === 0) {
      log('none');
    } else {
      changed.forEach((entry) => log(formatMetric(entry)));
    }
    comparison.addedGroupKeys.forEach((key) => log(`ADDED GROUP | ${key}`));
    comparison.removedGroupKeys.forEach((key) => log(`REMOVED GROUP | ${key}`));
    log('Research analytics only. This output is not a trading recommendation.');
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality comparison failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertQualityComparisonCli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
  );
}
