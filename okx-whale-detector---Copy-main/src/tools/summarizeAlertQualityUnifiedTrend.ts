import {
  buildAlertQualityUnifiedTrend,
  readAlertQualityUnifiedReports,
  type AlertQualityTrendMetricSummary,
} from '../evaluation';

export interface AlertQualityTrendCliDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const formatValue = (value: number | null): string =>
  value === null ? 'n/a' : Number.isInteger(value) ? String(value) : value.toFixed(6);

const formatMetric = (entry: AlertQualityTrendMetricSummary): string => {
  const family = entry.family === null ? '' : ` | ${entry.family}`;
  return [
    `${entry.overallChange} | ${entry.section}${family}`,
    entry.metricKey,
    `${formatValue(entry.firstObservedValue)} -> ${formatValue(entry.lastObservedValue)}`,
    `netDelta=${formatValue(entry.netDelta)}`,
    `transitions=${entry.observedTransitionCount}`,
    `improved=${entry.improvedCount}`,
    `degraded=${entry.degradedCount}`,
    `unchanged=${entry.unchangedCount}`,
    `unavailable=${entry.unavailableCount}`,
  ].join(' | ');
};

export const runAlertQualityTrendCli = async (
  args: readonly string[],
  dependencies: AlertQualityTrendCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;

  try {
    if (args.length !== 2 || args[0] !== '--file' || !args[1]) {
      throw new Error('Usage: alerts:trend:quality -- --file <quality-history.jsonl>');
    }

    const read = await readAlertQualityUnifiedReports(args[1]);
    if (read.issues.length > 0) {
      throw new Error(`Trend report file contains ${read.issues.length} read issue(s)`);
    }

    const trend = buildAlertQualityUnifiedTrend(read.reports);
    log('ALERT QUALITY TREND HISTORY');
    log(`Reports: ${trend.reports.length}`);
    log(`Transitions: ${trend.transitions.length}`);
    log(`Grouping dimensions: ${trend.groupingDimensions.join(', ') || 'none'}`);
    log(`Improved transition metrics: ${trend.totalImprovedMetricCount}`);
    log(`Degraded transition metrics: ${trend.totalDegradedMetricCount}`);
    log(`Unchanged transition metrics: ${trend.totalUnchangedMetricCount}`);
    log(`Unavailable transition metrics: ${trend.totalUnavailableMetricCount}`);

    log('REPORT POINTS');
    trend.reports.forEach((report, index) => {
      log(
        `${index + 1}. ${report.reportRunId} @ ${report.generatedAt} | terminal=${report.inputRecordCounts.terminalReturn}, path=${report.inputRecordCounts.pathOutcome}, target/stop=${report.inputRecordCounts.targetStop}`,
      );
    });

    log('TRANSITIONS');
    trend.transitions.forEach((transition, index) => {
      const comparison = transition.comparison;
      log(
        `${index + 1}. ${transition.baselineReportRunId} -> ${transition.candidateReportRunId} | improved=${comparison.improvedMetricCount}, degraded=${comparison.degradedMetricCount}, unchanged=${comparison.unchangedMetricCount}, unavailable=${comparison.unavailableMetricCount}`,
      );
    });

    const changed = trend.metrics.filter(
      (metric) => metric.overallChange === 'IMPROVED' || metric.overallChange === 'DEGRADED',
    );
    log('LONG-TERM CHANGED METRICS');
    if (changed.length === 0) {
      log('none');
    } else {
      changed.forEach((metric) => log(formatMetric(metric)));
    }

    log('Research analytics only. This output is not a trading recommendation.');
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality trend failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertQualityTrendCli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
  );
}
