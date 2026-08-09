import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createAlertAlignmentEvaluationConfiguration,
  createTargetStopPolicy,
  generateAlertAlignmentEvaluations,
  generatePathOutcomeRecords,
  generateTargetStopOutcomeRecords,
  generateTerminalReturnRecords,
  prepareAlertAlignmentMarketRecording,
  readAlertQualityUnifiedReports,
} from '../evaluation';
import { AlertPathOutcomeRecorder } from '../recording/AlertPathOutcomeRecorder';
import { AlertTargetStopOutcomeRecorder } from '../recording/AlertTargetStopOutcomeRecorder';
import { AlertTerminalReturnRecorder } from '../recording/AlertTerminalReturnRecorder';
import { runAlertQualityGeneratorCli } from './generateAlertQualityUnifiedReport';
import { runAlertQualityInspectorCli } from './inspectAlertQualityUnifiedReports';
import {
  createPathOutcomeSimulationAlert,
  createPathOutcomeSimulationMarketLines,
  PATH_OUTCOME_SIMULATION_NOW,
} from './simulateAlertPathOutcomes';

export interface AlertQualitySimulationDependencies {
  log?: (...values: unknown[]) => void;
  warn?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const recordAll = <T>(
  records: readonly T[],
  recorder: { record(record: T): void; close(): void },
): void => {
  try {
    records.forEach((record) => recorder.record(record));
  } finally {
    recorder.close();
  }
};

export const simulateAlertQualityUnifiedReport = async (
  dependencies: AlertQualitySimulationDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const errorLog = dependencies.error ?? console.error;
  const directory = mkdtempSync(path.join(tmpdir(), 'alert-quality-report-'));
  const returnsPath = path.join(directory, 'terminal-returns.jsonl');
  const pathsPath = path.join(directory, 'path-outcomes.jsonl');
  const targetsPath = path.join(directory, 'target-stop-outcomes.jsonl');
  const reportPath = path.join(directory, 'quality-report.jsonl');
  const duplicateReportPath = path.join(directory, 'quality-report-copy.jsonl');

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
      evaluationRunId: 'evaluation-run:quality-report-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const terminalReturns = generateTerminalReturnRecords({
      evaluations,
      outcomeRunId: 'terminal-return-run:quality-report-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const pathOutcomes = generatePathOutcomeRecords({
      evaluations,
      terminalReturns,
      marketRecording,
      pathOutcomeRunId: 'path-outcome-run:quality-report-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const targetStops = generateTargetStopOutcomeRecords({
      evaluations,
      terminalReturns,
      pathOutcomes,
      marketRecording,
      policy: createTargetStopPolicy({ targetPercent: 1, stopPercent: 1 }),
      targetStopRunId: 'target-stop-run:quality-report-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });

    recordAll(terminalReturns, new AlertTerminalReturnRecorder(returnsPath));
    recordAll(pathOutcomes, new AlertPathOutcomeRecorder(pathsPath));
    recordAll(targetStops, new AlertTargetStopOutcomeRecorder(targetsPath));

    const generatorArgs = [
      '--returns',
      returnsPath,
      '--paths',
      pathsPath,
      '--targets',
      targetsPath,
      '--report-run-id',
      'alert-quality-report:deterministic-simulation',
      '--now',
      String(PATH_OUTCOME_SIMULATION_NOW),
      '--group-by',
      'HORIZON_MS,SOURCE',
    ];
    const generatorDependencies = { log, warn, error: errorLog };
    const firstCode = await runAlertQualityGeneratorCli(
      [...generatorArgs, '--output', reportPath],
      generatorDependencies,
    );
    const secondCode = await runAlertQualityGeneratorCli(
      [...generatorArgs, '--output', duplicateReportPath],
      generatorDependencies,
    );
    if (firstCode !== 0 || secondCode !== 0) {
      throw new Error('Unified report generator returned a non-zero exit code');
    }

    const byteIdentical =
      readFileSync(reportPath, 'utf8') === readFileSync(duplicateReportPath, 'utf8');
    if (!byteIdentical) {
      throw new Error('Repeated unified report generation was not byte-identical');
    }

    const read = await readAlertQualityUnifiedReports(reportPath);
    if (read.reports.length !== 1 || read.issues.length !== 0) {
      throw new Error('Persisted unified report did not round-trip cleanly');
    }
    const report = read.reports[0]!;
    if (
      report.inputRecordCounts.terminalReturn !== terminalReturns.length ||
      report.inputRecordCounts.pathOutcome !== pathOutcomes.length ||
      report.inputRecordCounts.targetStop !== targetStops.length
    ) {
      throw new Error('Unified report input counts did not match generated records');
    }

    const inspectorCode = await runAlertQualityInspectorCli(['--file', reportPath], {
      log,
      error: errorLog,
    });
    if (inspectorCode !== 0) {
      throw new Error('Unified report inspector returned a non-zero exit code');
    }

    log('UNIFIED ALERT QUALITY REPORT SIMULATION');
    log(`Terminal-return records: ${terminalReturns.length}`);
    log(`Path-outcome records: ${pathOutcomes.length}`);
    log(`Target/stop records: ${targetStops.length}`);
    log(`Terminal-return groups: ${report.terminalReturn.groups.length}`);
    log(`Path-outcome groups: ${report.pathOutcome.groups.length}`);
    log(`Target/stop groups: ${report.targetStop.groups.length}`);
    log(`Byte-identical repeat: ${byteIdentical}`);
    log(`Read issues: ${read.issues.length}`);
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Unified alert-quality simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    log(
      `Temporary unified quality outputs cleaned up: ${[
        returnsPath,
        pathsPath,
        targetsPath,
        reportPath,
        duplicateReportPath,
      ].every((file) => !existsSync(file))}`,
    );
  }
};

export const runAlertQualitySimulationCli = async (): Promise<number> =>
  simulateAlertQualityUnifiedReport();

if (require.main === module) {
  void runAlertQualitySimulationCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
