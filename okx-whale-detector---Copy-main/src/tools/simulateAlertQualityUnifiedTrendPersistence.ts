import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  readAlertQualityUnifiedTrends,
  type AlertQualityUnifiedReport,
  writeAlertQualityUnifiedReports,
} from '../evaluation';
import { runAlertQualityTrendGeneratorCli } from './generateAlertQualityUnifiedTrend';
import { runAlertQualityTrendInspectorCli } from './inspectAlertQualityUnifiedTrends';
import {
  createPathOutcomeSimulationAlert,
  createPathOutcomeSimulationMarketLines,
  PATH_OUTCOME_SIMULATION_NOW,
} from './simulateAlertPathOutcomes';

export interface AlertQualityTrendPersistenceSimulationDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const cloneReport = (report: AlertQualityUnifiedReport): AlertQualityUnifiedReport =>
  JSON.parse(JSON.stringify(report)) as AlertQualityUnifiedReport;

export const simulateAlertQualityUnifiedTrendPersistence = async (
  dependencies: AlertQualityTrendPersistenceSimulationDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  const directory = mkdtempSync(path.join(tmpdir(), 'alert-quality-trend-persistence-'));
  const reportsPath = path.join(directory, 'reports.jsonl');
  const trendPath = path.join(directory, 'trend.jsonl');
  const repeatPath = path.join(directory, 'trend-repeat.jsonl');

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
      evaluationRunId: 'evaluation-run:quality-trend-persistence-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const terminalReturns = generateTerminalReturnRecords({
      evaluations,
      outcomeRunId: 'terminal-return-run:quality-trend-persistence-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const pathOutcomes = generatePathOutcomeRecords({
      evaluations,
      terminalReturns,
      marketRecording,
      pathOutcomeRunId: 'path-outcome-run:quality-trend-persistence-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const targetStops = generateTargetStopOutcomeRecords({
      evaluations,
      terminalReturns,
      pathOutcomes,
      marketRecording,
      policy: createTargetStopPolicy({ targetPercent: 1, stopPercent: 1 }),
      targetStopRunId: 'target-stop-run:quality-trend-persistence-simulation',
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
          reportRunId: `alert-quality-report:trend-persistence-simulation-${index}`,
          generatedAt: PATH_OUTCOME_SIMULATION_NOW + index,
        }),
      ),
    );

    const changed = reports[1]!.terminalReturn.groups.find(
      (group) => group.coverage.eligibleRate !== null,
    );
    const final = reports[2]!.terminalReturn.groups.find(
      (group) => group.groupKey === changed?.groupKey,
    );
    if (
      !changed ||
      !final ||
      changed.coverage.eligibleRate === null ||
      final.coverage.eligibleRate === null
    ) {
      throw new Error('Persistence simulation could not find an observed eligibility rate');
    }
    changed.coverage.eligibleRate = Math.max(0, changed.coverage.eligibleRate - 0.02);
    final.coverage.eligibleRate = Math.max(0, final.coverage.eligibleRate - 0.01);

    await writeAlertQualityUnifiedReports(reportsPath, [reports[2]!, reports[0]!, reports[1]!]);

    const generatorCode = await runAlertQualityTrendGeneratorCli(
      ['--reports', reportsPath, '--output', trendPath],
      { log, error: errorLog },
    );
    if (generatorCode !== 0) throw new Error('Trend generator returned a non-zero exit code');

    const inspectorLogs: string[] = [];
    const inspectorCode = await runAlertQualityTrendInspectorCli(['--file', trendPath], {
      log: (...values) => {
        const line = values.map(String).join(' ');
        inspectorLogs.push(line);
        log(line);
      },
      error: errorLog,
    });
    if (inspectorCode !== 0) throw new Error('Trend inspector returned a non-zero exit code');

    const read = await readAlertQualityUnifiedTrends(trendPath);
    if (read.issues.length > 0 || read.trends.length !== 1) {
      throw new Error('Persisted trend did not reload cleanly');
    }
    const persistedTrend = read.trends[0]!;
    const inspectionVerified =
      inspectorLogs.includes('Trends: 1') &&
      inspectorLogs.includes('Reports: 3') &&
      inspectorLogs.includes('Transitions: 2');
    if (!inspectionVerified) {
      throw new Error('Trend inspection output did not contain expected summary counts');
    }

    const repeatCode = await runAlertQualityTrendGeneratorCli(
      ['--reports', reportsPath, '--output', repeatPath],
      { log: () => undefined, error: errorLog },
    );
    if (repeatCode !== 0) throw new Error('Repeated trend generation failed');
    const byteIdentical = readFileSync(trendPath).equals(readFileSync(repeatPath));
    if (!byteIdentical) throw new Error('Repeated trend generation was not byte-identical');

    log('ALERT QUALITY PERSISTED TREND SIMULATION');
    log(`Generator exit code: ${generatorCode}`);
    log(`Inspector exit code: ${inspectorCode}`);
    log(`Reloaded trends: ${read.trends.length}`);
    log(`Reloaded reports: ${persistedTrend.reports.length}`);
    log(`Inspection verified: ${inspectionVerified}`);
    log(`Byte-identical repeat: ${byteIdentical}`);
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality persisted trend simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    log(
      `Temporary persisted trend outputs cleaned up: ${[
        reportsPath,
        trendPath,
        repeatPath,
      ].every((file) => !existsSync(file))}`,
    );
  }
};

if (require.main === module) {
  void simulateAlertQualityUnifiedTrendPersistence().then((code) => {
    process.exitCode = code;
  });
}
