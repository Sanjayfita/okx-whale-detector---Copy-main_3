import path from 'node:path';

import {
  compareAlertQualityUnifiedTrends,
  readAlertQualityUnifiedTrends,
  type AlertQualityTrendComparisonMetric,
  type AlertQualityUnifiedTrend,
} from '../evaluation';

export interface AlertQualityTrendComparisonCliDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const parseValues = (args: readonly string[]): Map<string, string> => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`${flag ?? 'option'} requires a value`);
    }
    values.set(flag, value);
  }
  return values;
};

const readSingleTrend = async (
  label: 'baseline' | 'candidate',
  filePath: string,
): Promise<AlertQualityUnifiedTrend> => {
  const result = await readAlertQualityUnifiedTrends(filePath);
  if (result.issues.length > 0) {
    throw new Error(`${label} trend file contains ${result.issues.length} read issue(s)`);
  }
  if (result.trends.length !== 1) {
    throw new Error(`${label} trend file must contain exactly one trend`);
  }
  return result.trends[0]!;
};

const formatNumber = (value: number | null): string =>
  value === null ? 'unavailable' : value.toFixed(6);

const printMetric = (
  metric: AlertQualityTrendComparisonMetric,
  log: (...values: unknown[]) => void,
): void => {
  log(
    `${metric.momentum} | ${metric.metricKey} | ` +
      `${metric.baselineOverallChange} -> ${metric.candidateOverallChange} | ` +
      `netDelta=${formatNumber(metric.baselineNetDelta)} -> ${formatNumber(metric.candidateNetDelta)} | ` +
      `deltaChange=${formatNumber(metric.deltaChange)}`,
  );
};

export const runAlertQualityTrendComparisonCli = async (
  args: readonly string[],
  dependencies: AlertQualityTrendComparisonCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;

  try {
    const values = parseValues(args);
    for (const required of ['--baseline', '--candidate']) {
      if (!values.has(required)) throw new Error(`${required} is required`);
    }
    for (const flag of values.keys()) {
      if (!['--baseline', '--candidate'].includes(flag)) {
        throw new Error(`Unknown trend-comparison option: ${flag}`);
      }
    }

    const baselinePath = path.resolve(values.get('--baseline')!);
    const candidatePath = path.resolve(values.get('--candidate')!);
    const normalize = (value: string): string =>
      process.platform === 'win32' ? value.toLowerCase() : value;
    if (normalize(baselinePath) === normalize(candidatePath)) {
      throw new Error('Baseline and candidate trend paths must be distinct');
    }

    const [baseline, candidate] = await Promise.all([
      readSingleTrend('baseline', baselinePath),
      readSingleTrend('candidate', candidatePath),
    ]);
    const comparison = compareAlertQualityUnifiedTrends(baseline, candidate);

    log('ALERT QUALITY TREND-TO-TREND COMPARISON');
    log(`Baseline: ${baseline.reports[0]!.reportRunId} -> ${baseline.reports.at(-1)!.reportRunId}`);
    log(`Candidate: ${candidate.reports[0]!.reportRunId} -> ${candidate.reports.at(-1)!.reportRunId}`);
    log(`Grouping dimensions: ${comparison.groupingDimensions.join(', ') || 'none'}`);
    log(`Baseline reports: ${comparison.baselineReportCount}`);
    log(`Candidate reports: ${comparison.candidateReportCount}`);
    log(`Shared metrics: ${comparison.metrics.length}`);
    log(`Accelerating metrics: ${comparison.acceleratingMetricCount}`);
    log(`Decelerating metrics: ${comparison.deceleratingMetricCount}`);
    log(`Steady metrics: ${comparison.steadyMetricCount}`);
    log(`Reversing metrics: ${comparison.reversingMetricCount}`);
    log(`Unavailable metrics: ${comparison.unavailableMetricCount}`);
    log(`Added metrics: ${comparison.addedMetricKeys.length}`);
    log(`Removed metrics: ${comparison.removedMetricKeys.length}`);

    const changed = comparison.metrics.filter(
      (metric) => metric.momentum !== 'STEADY' && metric.momentum !== 'UNAVAILABLE',
    );
    if (changed.length > 0) {
      log('MOMENTUM CHANGES');
      changed.forEach((metric) => printMetric(metric, log));
    }
    if (comparison.addedMetricKeys.length > 0) {
      log(`ADDED METRIC KEYS: ${comparison.addedMetricKeys.join(', ')}`);
    }
    if (comparison.removedMetricKeys.length > 0) {
      log(`REMOVED METRIC KEYS: ${comparison.removedMetricKeys.join(', ')}`);
    }
    log('Research analytics only. This output is not a trading recommendation.');
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality trend comparison failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertQualityTrendComparisonCli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
  );
}
