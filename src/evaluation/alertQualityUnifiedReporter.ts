import type { NumericStatistics, ReturnStatistics } from './alertQualityReport';
import type { AlertQualityUnifiedReport } from './alertQualityUnifiedReport';

const formatNumber = (value: number | null, digits = 4): string =>
  value === null ? 'n/a' : value.toFixed(digits);

const formatRate = (value: number | null): string =>
  value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`;

const formatReturn = (label: string, statistics: ReturnStatistics): string =>
  `${label}: observations=${statistics.observationCount}, mean=${formatNumber(statistics.mean)}%, ` +
  `positive=${formatRate(statistics.positiveRate)} (${statistics.positiveCount}/${statistics.observationCount})`;

const formatExcursion = (label: string, statistics: NumericStatistics): string =>
  `${label}: observations=${statistics.observationCount}, mean=${formatNumber(statistics.mean)}%`;

const compatibilityLabel = (input: {
  evaluatorVersion: string;
  policyFingerprint: string;
}): string =>
  `evaluator=${input.evaluatorVersion}, policy=${input.policyFingerprint}`;

export const formatAlertQualityUnifiedReport = (
  report: AlertQualityUnifiedReport,
): string => {
  const lines: string[] = [
    'ALERT QUALITY SUMMARY',
    `Run ID: ${report.reportRunId}`,
    `Generated at: ${report.generatedAt}`,
    `Grouping dimensions: ${report.groupingDimensions.join(', ') || 'none'}`,
    `Input records: terminal-return=${report.inputRecordCounts.terminalReturn}, path-outcome=${report.inputRecordCounts.pathOutcome}, target-stop=${report.inputRecordCounts.targetStop}`,
    `Unique cells: terminal-return=${report.terminalReturn.uniqueCellCount}, path-outcome=${report.pathOutcome.uniqueCellCount}, target-stop=${report.targetStop.uniqueCellCount}`,
    `Exact duplicate cells: terminal-return=${report.terminalReturn.exactDuplicateCellCount}, path-outcome=${report.pathOutcome.exactDuplicateCellCount}, target-stop=${report.targetStop.exactDuplicateCellCount}`,
  ];

  const terminalOverall = report.terminalReturn.groups.filter(
    (group) => group.dimension === 'OVERALL',
  );
  lines.push('', 'TERMINAL RETURNS');
  if (terminalOverall.length === 0) lines.push('No terminal-return observations.');
  for (const group of terminalOverall) {
    lines.push(`[${compatibilityLabel(group)}]`);
    lines.push(
      `Coverage: eligible=${formatRate(group.coverage.eligibleRate)} (${group.coverage.eligibleCellCount}/${group.coverage.totalCellCount}), ` +
        `ambiguous=${formatRate(group.coverage.ambiguityRate)} (${group.coverage.ambiguousCellCount}/${group.coverage.totalCellCount})`,
    );
    lines.push(formatReturn('OKX directional return', group.returns.okxDirectionalReturnPercent));
    lines.push(
      formatReturn(
        'OKX executable directional return',
        group.returns.okxExecutableDirectionalReturnPercent,
      ),
    );
    lines.push(
      formatReturn(
        'External executable directional return',
        group.returns.externalExecutableDirectionalReturnPercent,
      ),
    );
  }

  const pathOverall = report.pathOutcome.groups.filter(
    (group) => group.dimension === 'OVERALL',
  );
  lines.push('', 'PATH OUTCOMES');
  if (pathOverall.length === 0) lines.push('No path-outcome observations.');
  for (const group of pathOverall) {
    lines.push(`[${compatibilityLabel(group)}]`);
    lines.push(
      `Coverage: eligible=${formatRate(group.coverage.eligibleRate)} (${group.coverage.eligibleCellCount}/${group.coverage.totalCellCount}), ` +
        `ambiguous=${formatRate(group.coverage.ambiguityRate)} (${group.coverage.ambiguousCellCount}/${group.coverage.totalCellCount})`,
    );
    lines.push(
      formatExcursion(
        'OKX executable MFE',
        group.metrics.executableOkx.favorableExcursionPercent,
      ),
    );
    lines.push(
      formatExcursion(
        'OKX executable MAE',
        group.metrics.executableOkx.adverseExcursionPercent,
      ),
    );
    lines.push(
      `OKX executable time to MFE: observations=${group.metrics.executableOkx.timeToFavorableMs.observationCount}, mean=${formatNumber(group.metrics.executableOkx.timeToFavorableMs.mean, 2)}ms`,
    );
  }

  const targetOverall = report.targetStop.groups.filter(
    (group) => group.dimension === 'OVERALL',
  );
  lines.push('', 'TARGET / STOP OUTCOMES');
  if (targetOverall.length === 0) lines.push('No target/stop observations.');
  for (const group of targetOverall) {
    const statistics = group.statistics;
    lines.push(`[${group.family}; ${compatibilityLabel(group)}]`);
    lines.push(
      `Resolved outcomes: ${statistics.resolvedCount}; target-first=${formatRate(statistics.targetFirstRateAmongResolved)} (${statistics.targetFirstCount}/${statistics.resolvedCount}), ` +
        `stop-first=${formatRate(statistics.stopFirstRateAmongResolved)} (${statistics.stopFirstCount}/${statistics.resolvedCount}), ` +
        `neither=${formatRate(statistics.neitherRateAmongResolved)} (${statistics.neitherCount}/${statistics.resolvedCount}), ` +
        `ties=${formatRate(statistics.tieRateAmongResolved)} (${statistics.tieCount}/${statistics.resolvedCount})`,
    );
    lines.push(
      `Eligible outcomes: ${statistics.eligibleCount}; ambiguous=${formatRate(statistics.ambiguityRateAmongEligible)} (${statistics.ambiguousCount}/${statistics.eligibleCount})`,
    );
  }

  lines.push('', 'Research output only. No trading recommendation is produced.');
  return `${lines.join('\n')}\n`;
};
