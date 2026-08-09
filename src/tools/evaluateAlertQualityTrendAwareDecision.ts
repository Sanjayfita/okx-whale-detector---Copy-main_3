import {
  compareAlertQualityUnifiedTrends,
  evaluateAlertQualityTrendAwareDecision,
  readAlertQualityThresholdEvaluations,
  readAlertQualityUnifiedTrends,
  type AlertQualityThresholdReport,
} from '../evaluation';

export interface AlertQualityTrendAwareDecisionCliDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const parseOptions = (args: readonly string[]): Map<string, string> => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`${flag ?? 'option'} requires a value`);
    }
    if (values.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    values.set(flag, value);
  }
  return values;
};

export const runAlertQualityTrendAwareDecisionCli = async (
  args: readonly string[],
  dependencies: AlertQualityTrendAwareDecisionCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;

  try {
    const values = parseOptions(args);
    const allowed = new Set(['--policy', '--trend', '--baseline-trend']);
    for (const flag of values.keys()) {
      if (!allowed.has(flag)) throw new Error(`Unknown trend-aware decision option: ${flag}`);
    }
    if (!values.has('--policy')) throw new Error('--policy is required');
    if (!values.has('--trend')) throw new Error('--trend is required');

    const policyRead = await readAlertQualityThresholdEvaluations(values.get('--policy')!);
    if (policyRead.issues.length > 0) {
      throw new Error(`Threshold evaluation file contains ${policyRead.issues.length} read issue(s)`);
    }
    if (policyRead.evaluations.length !== 1) {
      throw new Error('Threshold evaluation file must contain exactly one evaluation');
    }

    const trendRead = await readAlertQualityUnifiedTrends(values.get('--trend')!);
    if (trendRead.issues.length > 0) {
      throw new Error(`Trend file contains ${trendRead.issues.length} read issue(s)`);
    }
    if (trendRead.trends.length !== 1) {
      throw new Error('Trend file must contain exactly one trend');
    }

    const persisted = policyRead.evaluations[0]!;
    const thresholdReport: AlertQualityThresholdReport = {
      reportRunId: persisted.sourceReportRunId,
      generatedAt: persisted.sourceReportGeneratedAt,
      policy: persisted.policy,
      evaluations: persisted.evaluations,
      passedCount: persisted.passedCount,
      failedCount: persisted.failedCount,
      insufficientDataCount: persisted.insufficientDataCount,
    };

    let trendComparison;
    if (values.has('--baseline-trend')) {
      const baselineRead = await readAlertQualityUnifiedTrends(values.get('--baseline-trend')!);
      if (baselineRead.issues.length > 0) {
        throw new Error(
          `Baseline trend file contains ${baselineRead.issues.length} read issue(s)`,
        );
      }
      if (baselineRead.trends.length !== 1) {
        throw new Error('Baseline trend file must contain exactly one trend');
      }
      trendComparison = compareAlertQualityUnifiedTrends(
        baselineRead.trends[0]!,
        trendRead.trends[0]!,
      );
    }

    const report = evaluateAlertQualityTrendAwareDecision({
      thresholdReport,
      trend: trendRead.trends[0]!,
      trendComparison,
    });

    log('ALERT QUALITY TREND-AWARE DECISION');
    log(`Decision: ${report.decision}`);
    log(`Source report: ${report.sourceReportRunId} @ ${report.sourceReportGeneratedAt}`);
    log(`Reasons: ${report.reasons.join(', ') || 'none'}`);
    log(
      `Thresholds: passed=${report.thresholdCounts.passed}, failed=${report.thresholdCounts.failed}, insufficient=${report.thresholdCounts.insufficientData}`,
    );
    log(
      `Trend: improved=${report.trendCounts.improved}, degraded=${report.trendCounts.degraded}, unchanged=${report.trendCounts.unchanged}, unavailable=${report.trendCounts.unavailable}`,
    );
    if (report.comparisonCounts) {
      log(
        `Momentum: accelerating=${report.comparisonCounts.accelerating}, decelerating=${report.comparisonCounts.decelerating}, steady=${report.comparisonCounts.steady}, reversing=${report.comparisonCounts.reversing}, unavailable=${report.comparisonCounts.unavailable}`,
      );
    } else {
      log('Momentum: not provided');
    }
    log('Research analytics only. This output is not a trading recommendation.');
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality trend-aware decision failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertQualityTrendAwareDecisionCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
