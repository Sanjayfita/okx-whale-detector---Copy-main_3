import { readAlertQualityUnifiedTrends } from '../evaluation';

export interface AlertQualityTrendInspectorDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const countOverallChanges = (
  metrics: readonly { overallChange: string }[],
): Record<string, number> => {
  const counts: Record<string, number> = {
    IMPROVED: 0,
    DEGRADED: 0,
    UNCHANGED: 0,
    UNAVAILABLE: 0,
  };
  metrics.forEach((metric) => {
    counts[metric.overallChange] = (counts[metric.overallChange] ?? 0) + 1;
  });
  return counts;
};

export const runAlertQualityTrendInspectorCli = async (
  args: readonly string[],
  dependencies: AlertQualityTrendInspectorDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;

  try {
    if (args.length !== 2 || args[0] !== '--file' || !args[1]) {
      throw new Error('Usage: alerts:inspect:quality-trend -- --file <trend-history.jsonl>');
    }

    const result = await readAlertQualityUnifiedTrends(args[1]);
    const issueCounts = {
      malformed: result.issues.filter((issue) => issue.reason === 'MALFORMED_JSON').length,
      invalid: result.issues.filter((issue) => issue.reason === 'INVALID_TREND').length,
      unsupported: result.issues.filter(
        (issue) => issue.reason === 'UNSUPPORTED_SCHEMA_VERSION',
      ).length,
    };

    log('ALERT QUALITY TREND INSPECTION');
    log(`File: ${args[1]}`);
    log(`Trends: ${result.trends.length}`);
    log(`Exact duplicate trends: ${result.exactDuplicateCount}`);
    log(`Malformed JSON lines: ${issueCounts.malformed}`);
    log(`Invalid trends: ${issueCounts.invalid}`);
    log(`Unsupported schema versions: ${issueCounts.unsupported}`);

    result.trends.forEach((trend, index) => {
      const first = trend.reports[0]!;
      const last = trend.reports[trend.reports.length - 1]!;
      const overall = countOverallChanges(trend.metrics);
      log(`TREND ${index + 1}`);
      log(`Report range: ${first.reportRunId} @ ${first.generatedAt} -> ${last.reportRunId} @ ${last.generatedAt}`);
      log(`Reports: ${trend.reports.length}`);
      log(`Transitions: ${trend.transitions.length}`);
      log(`Grouping dimensions: ${trend.groupingDimensions.join(', ') || 'none'}`);
      log(`Metrics: ${trend.metrics.length}`);
      log(`Overall improved metrics: ${overall.IMPROVED}`);
      log(`Overall degraded metrics: ${overall.DEGRADED}`);
      log(`Overall unchanged metrics: ${overall.UNCHANGED}`);
      log(`Overall unavailable metrics: ${overall.UNAVAILABLE}`);
      log(`Improved transition metrics: ${trend.totalImprovedMetricCount}`);
      log(`Degraded transition metrics: ${trend.totalDegradedMetricCount}`);
      log(`Unchanged transition metrics: ${trend.totalUnchangedMetricCount}`);
      log(`Unavailable transition metrics: ${trend.totalUnavailableMetricCount}`);
    });

    log('Research analytics only. This output is not a trading recommendation.');
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality trend inspection failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertQualityTrendInspectorCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
