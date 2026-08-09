import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
} from '../evaluation';
import { AlertTargetStopOutcomeReader } from '../recording/AlertTargetStopOutcomeReader';
import { AlertTargetStopOutcomeRecorder } from '../recording/AlertTargetStopOutcomeRecorder';
import { runTargetStopInspectorCli } from './inspectAlertTargetStopOutcomes';
import {
  createPathOutcomeSimulationAlert,
  createPathOutcomeSimulationMarketLines,
  PATH_OUTCOME_SIMULATION_NOW,
} from './simulateAlertPathOutcomes';

export interface TargetStopSimulationDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

export const simulateAlertTargetStopOutcomes = async (
  dependencies: TargetStopSimulationDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  const directory = mkdtempSync(path.join(tmpdir(), 'alert-target-stop-'));
  const outputPath = path.join(directory, 'target-stop-outcomes.jsonl');
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
      evaluationRunId: 'evaluation-run:target-stop-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const terminalReturns = generateTerminalReturnRecords({
      evaluations,
      outcomeRunId: 'terminal-return-run:target-stop-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const pathOutcomes = generatePathOutcomeRecords({
      evaluations,
      terminalReturns,
      marketRecording,
      pathOutcomeRunId: 'path-outcome-run:target-stop-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const records = generateTargetStopOutcomeRecords({
      evaluations,
      terminalReturns,
      pathOutcomes,
      marketRecording,
      policy: createTargetStopPolicy({
        targetPercent: 1,
        stopPercent: 1,
      }),
      targetStopRunId: 'target-stop-run:deterministic-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const recorder = new AlertTargetStopOutcomeRecorder(outputPath);
    try {
      records.forEach((record) => recorder.record(record));
    } finally {
      recorder.close();
    }
    const read = await new AlertTargetStopOutcomeReader().read(outputPath);
    const cells = read.records.flatMap((record) => record.outcomes);
    const results = cells.flatMap((cell) =>
      [
        cell.okx,
        cell.external,
        cell.executableOkx,
        cell.executableExternal,
        cell.candleOkx,
        cell.candleExternal,
      ].filter((result) => result !== null),
    );
    const countResult = (result: string): number =>
      results.filter((candidate) => candidate.result === result).length;

    log('ALERT TARGET STOP SIMULATION');
    log(`Valid target/stop records: ${read.records.length}`);
    log(`Malformed records: ${read.malformedLines.length}`);
    log(
      `Eligible cells: ${cells.filter((cell) => cell.eligibility === 'ELIGIBLE').length}`,
    );
    log(
      `Ineligible cells: ${cells.filter((cell) => cell.eligibility === 'INELIGIBLE').length}`,
    );
    log(
      `Ambiguous cells: ${cells.filter((cell) => cell.eligibility === 'AMBIGUOUS').length}`,
    );
    log(`Target first: ${countResult('TARGET_FIRST')}`);
    log(`Stop first: ${countResult('STOP_FIRST')}`);
    log(`Neither: ${countResult('NEITHER')}`);
    log(`Ties: ${countResult('TIE')}`);
    log(`Candle ambiguities: ${countResult('AMBIGUOUS')}`);
    log(
      `Duplicate IDs: ${read.duplicateOutcomeIds.length}; Duplicate units: ${read.duplicateUnits.length}`,
    );
    await runTargetStopInspectorCli(['--file', outputPath], {
      log,
      error: errorLog,
    });
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Target/stop simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    log(`Temporary target/stop output cleaned up: ${!existsSync(outputPath)}`);
  }
};

export const runTargetStopSimulationCli = async (): Promise<number> =>
  simulateAlertTargetStopOutcomes();

if (require.main === module) {
  void runTargetStopSimulationCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
