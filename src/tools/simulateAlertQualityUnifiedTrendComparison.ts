import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildAlertQualityUnifiedTrend,
  createAlertAlignmentEvaluationConfiguration,
  createTargetStopPolicy,
  generateAlertAlignmentEvaluations,
  generateAlertQualityUnifiedReport,
  generatePathOutcomeRecords,
  generateTargetStopOutcomeRecords,
  generateTerminalReturnRecords,
  prepareAlertAlignmentMarketRecording,
  type AlertQualityUnifiedReport,
  writeAlertQualityUnifiedTrends,
} from '../evaluation';
import { runAlertQualityTrendComparisonCli } from './compareAlertQualityUnifiedTrends';
import {
  createPathOutcomeSimulationAlert,
  createPathOutcomeSimulationMarketLines,
  PATH_OUTCOME_SIMULATION_NOW,
} from './simulateAlertPathOutcomes';

export interface AlertQualityTrendComparisonSimulationDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const cloneReport = (report: AlertQualityUnifiedReport): AlertQualityUnifiedReport =>
  JSON.parse(JSON.stringify(report)) as AlertQualityUnifiedReport;

export const simulateAlertQualityUnifiedTrendComparison = async (
  dependencies: AlertQualityTrendComparisonSimulationDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  const directory = mkdtempSync(path.join(tmpdir(), 'alert-quality-trend-comparison-'));
  const baselinePath = path.join(directory, 'baseline.jsonl');
  const candidatePath = path.join(directory, 'candidate.jsonl');
  const incompatiblePath = path.join(directory, 'incompatible.jsonl');

  try {
    const configuration = createAlertAlignmentEvaluationConfiguration();
    const marketRecording = prepareAlertAlignmentMarketRecording(
      createPathOutcomeSimulationMarketLines(),
      { configuration, now: PATH_OUTCOME_SIMULATION_NOW },
    );
    const evaluations = generateAlertAlignmentEvaluations({
      alerts: [
        createPathOutcomeSimulationAlert(1, 'BULLISH', 'BULLISH'),
        createPathOutcomeSimulationAlert(2, 'BEARISH', 'BEARISH'),
        createPathOutcomeSimulationAlert(3, 'BULLISH', 'BEARISH'),
      ],
      marketRecording,
      configuration,
      evaluationRunId: 'evaluation-run:trend-comparison-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const terminalReturns = generateTerminalReturnRecords({
      evaluations,
      outcomeRunId: 'terminal-return-run:trend-comparison-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const pathOutcomes = generatePathOutcomeRecords({
      evaluations,
      terminalReturns,
      marketRecording,
      pathOutcomeRunId: 'path-outcome-run:trend-comparison-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const targetStops = generateTargetStopOutcomeRecords({
      evaluations,
      terminalReturns,
      pathOutcomes,
      marketRecording,
      policy: createTargetStopPolicy({ targetPercent: 1, stopPercent: 1 }),
      targetStopRunId: 'target-stop-run:trend-comparison-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const shared = {
      terminalReturnRecords: terminalReturns,
      pathOutcomeRecords: pathOutcomes,
      targetStopRecords: targetStops,
      groupingDimensions: ['HORIZON_MS', 'SOURCE'] as const,
    };
    const createWindow = (prefix: string, offset: number): AlertQualityUnifiedReport[] =>
      [0, 1, 2].map((index) =>
        cloneReport(
          generateAlertQualityUnifiedReport({
            ...shared,
            reportRunId: `alert-quality-report:${prefix}-${index}`,
            generatedAt: PATH_OUTCOME_SIMULATION_NOW + offset + index,
          }),
        ),
      );

    const baselineReports = createWindow('trend-comparison-baseline', 0);
    const candidateReports = createWindow('trend-comparison-candidate', 10);
    const findObserved = (reports: AlertQualityUnifiedReport[]) => {
      const first = reports[0]!.terminalReturn.groups.find(
        (group) => group.coverage.eligibleRate !== null,
      )!;
      return reports.map(
        (report) =>
          report.terminalReturn.groups.find((group) => group.groupKey === first.groupKey)!,
      );
    };
    const baselineGroups = findObserved(baselineReports);
    const candidateGroups = findObserved(candidateReports);

    // Use values below 1 so clamping cannot turn the candidate window into an
    // unchanged trend when the fixture's original eligible rate is already 1.
    baselineGroups[0]!.coverage.eligibleRate = 0.8;
    baselineGroups[1]!.coverage.eligibleRate = 0.7;
    baselineGroups[2]!.coverage.eligibleRate = 0.6;
    candidateGroups[0]!.coverage.eligibleRate = 0.6;
    candidateGroups[1]!.coverage.eligibleRate = 0.7;
    candidateGroups[2]!.coverage.eligibleRate = 0.8;

    const baselineTrend = buildAlertQualityUnifiedTrend(baselineReports);
    const candidateTrend = buildAlertQualityUnifiedTrend(candidateReports);
    await writeAlertQualityUnifiedTrends(baselinePath, [baselineTrend]);
    await writeAlertQualityUnifiedTrends(candidatePath, [candidateTrend]);

    const output: string[] = [];
    const code = await runAlertQualityTrendComparisonCli(
      ['--baseline', baselinePath, '--candidate', candidatePath],
      {
        log: (...values) => {
          const line = values.map(String).join(' ');
          output.push(line);
          log(line);
        },
        error: errorLog,
      },
    );
    const reversalVerified = code === 0 && output.some((line) => line.startsWith('REVERSING |'));
    if (!reversalVerified) throw new Error('Expected reversing metric was not reported');

    const incompatibleTrend = {
      ...candidateTrend,
      groupingDimensions: Object.freeze(['SOURCE']),
    };
    await writeAlertQualityUnifiedTrends(incompatiblePath, [incompatibleTrend]);
    const expectedErrors: string[] = [];
    const incompatibleCode = await runAlertQualityTrendComparisonCli(
      ['--baseline', baselinePath, '--candidate', incompatiblePath],
      {
        log: () => undefined,
        error: (...values) => expectedErrors.push(values.map(String).join(' ')),
      },
    );
    const incompatibilityRejected =
      incompatibleCode === 1 &&
      expectedErrors.some((line) => line.includes('grouping dimensions are incompatible'));
    if (!incompatibilityRejected) throw new Error('Incompatible trend comparison was not rejected');

    log('ALERT QUALITY TREND COMPARISON SIMULATION');
    log(`Compatible comparison exit code: ${code}`);
    log(`Reversal verified: ${reversalVerified}`);
    log(`Compatibility rejection verified: ${incompatibilityRejected}`);
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality trend comparison simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    log(
      `Temporary trend comparison outputs cleaned up: ${[
        baselinePath,
        candidatePath,
        incompatiblePath,
      ].every((file) => !existsSync(file))}`,
    );
  }
};

if (require.main === module) {
  void simulateAlertQualityUnifiedTrendComparison().then((code) => {
    process.exitCode = code;
  });
}
