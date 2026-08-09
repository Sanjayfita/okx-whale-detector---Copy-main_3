import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createAlertAlignmentEvaluationConfiguration,
  createTargetStopPolicy,
  generateAlertAlignmentEvaluations,
  generateAlertQualityUnifiedReport,
  generatePathOutcomeRecords,
  generateTargetStopOutcomeRecords,
  generateTerminalReturnRecords,
  prepareAlertAlignmentMarketRecording,
  type AlertQualityUnifiedReport,
  writeAlertQualityUnifiedReports,
} from '../evaluation';
import { runAlertQualityTrendCli } from './summarizeAlertQualityUnifiedTrend';
import {
  createPathOutcomeSimulationAlert,
  createPathOutcomeSimulationMarketLines,
  PATH_OUTCOME_SIMULATION_NOW,
} from './simulateAlertPathOutcomes';

export interface AlertQualityTrendSimulationDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const cloneReport = (report: AlertQualityUnifiedReport): AlertQualityUnifiedReport =>
  JSON.parse(JSON.stringify(report)) as AlertQualityUnifiedReport;

export const simulateAlertQualityUnifiedTrend = async (
  dependencies: AlertQualityTrendSimulationDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  const directory = mkdtempSync(path.join(tmpdir(), 'alert-quality-trend-'));
  const historyPath = path.join(directory, 'history.jsonl');
  const incompatiblePath = path.join(directory, 'incompatible-history.jsonl');

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
      evaluationRunId: 'evaluation-run:quality-trend-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const terminalReturns = generateTerminalReturnRecords({
      evaluations,
      outcomeRunId: 'terminal-return-run:quality-trend-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const pathOutcomes = generatePathOutcomeRecords({
      evaluations,
      terminalReturns,
      marketRecording,
      pathOutcomeRunId: 'path-outcome-run:quality-trend-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const targetStops = generateTargetStopOutcomeRecords({
      evaluations,
      terminalReturns,
      pathOutcomes,
      marketRecording,
      policy: createTargetStopPolicy({ targetPercent: 1, stopPercent: 1 }),
      targetStopRunId: 'target-stop-run:quality-trend-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const shared = {
      terminalReturnRecords: terminalReturns,
      pathOutcomeRecords: pathOutcomes,
      targetStopRecords: targetStops,
      groupingDimensions: ['HORIZON_MS', 'SOURCE'] as const,
    };
    const reports = [0, 1, 2].map((index) =>
      cloneReport(
        generateAlertQualityUnifiedReport({
          ...shared,
          reportRunId: `alert-quality-report:trend-simulation-${index}`,
          generatedAt: PATH_OUTCOME_SIMULATION_NOW + index,
        }),
      ),
    );

    const changedGroup = reports[1]!.terminalReturn.groups.find(
      (group) => group.coverage.eligibleRate !== null,
    );
    const finalGroup = reports[2]!.terminalReturn.groups.find(
      (group) => group.groupKey === changedGroup?.groupKey,
    );
    if (
      !changedGroup ||
      !finalGroup ||
      changedGroup.coverage.eligibleRate === null ||
      finalGroup.coverage.eligibleRate === null
    ) {
      throw new Error('Trend simulation could not find an observed eligibility rate');
    }
    changedGroup.coverage.eligibleRate = Math.max(
      0,
      changedGroup.coverage.eligibleRate - 0.02,
    );
    finalGroup.coverage.eligibleRate = Math.max(
      0,
      finalGroup.coverage.eligibleRate - 0.01,
    );

    await writeAlertQualityUnifiedReports(historyPath, [reports[2]!, reports[0]!, reports[1]!]);

    const trendLogs: string[] = [];
    const trendCode = await runAlertQualityTrendCli(['--file', historyPath], {
      log: (...values) => {
        const line = values.map(String).join(' ');
        trendLogs.push(line);
        log(line);
      },
      error: errorLog,
    });
    if (trendCode !== 0) throw new Error('Compatible trend returned a non-zero exit code');
    const orderingVerified =
      trendLogs.some((line) => line.startsWith('1. alert-quality-report:trend-simulation-0')) &&
      trendLogs.some((line) => line.startsWith('3. alert-quality-report:trend-simulation-2'));
    const cumulativeTrendVerified = trendLogs.some(
      (line) => line.includes('LONG-TERM CHANGED METRICS') || line.includes('DEGRADED |'),
    );
    if (!orderingVerified || !cumulativeTrendVerified) {
      throw new Error('Trend output did not contain the expected ordered cumulative summary');
    }

    const incompatible = reports.map(cloneReport);
    incompatible[2]!.terminalReturn.policyFingerprints = ['incompatible-policy'];
    await writeAlertQualityUnifiedReports(incompatiblePath, incompatible);
    const expectedErrors: string[] = [];
    const incompatibleCode = await runAlertQualityTrendCli(['--file', incompatiblePath], {
      log: () => undefined,
      error: (...values) => expectedErrors.push(values.map(String).join(' ')),
    });
    const compatibilityRejected =
      incompatibleCode === 1 &&
      expectedErrors.some((line) => line.includes('policy fingerprints are incompatible'));
    if (!compatibilityRejected) {
      throw new Error('Incompatible trend history was not rejected as expected');
    }

    log('ALERT QUALITY TREND SIMULATION');
    log(`Compatible trend exit code: ${trendCode}`);
    log(`Chronological ordering verified: ${orderingVerified}`);
    log(`Cumulative trend verified: ${cumulativeTrendVerified}`);
    log(`Compatibility rejection verified: ${compatibilityRejected}`);
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality trend simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    log(
      `Temporary trend outputs cleaned up: ${[historyPath, incompatiblePath].every(
        (file) => !existsSync(file),
      )}`,
    );
  }
};

if (require.main === module) {
  void simulateAlertQualityUnifiedTrend().then((code) => {
    process.exitCode = code;
  });
}
