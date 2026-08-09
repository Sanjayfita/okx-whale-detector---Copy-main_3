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
import { runAlertQualityComparisonCli } from './compareAlertQualityUnifiedReports';
import {
  createPathOutcomeSimulationAlert,
  createPathOutcomeSimulationMarketLines,
  PATH_OUTCOME_SIMULATION_NOW,
} from './simulateAlertPathOutcomes';

export interface AlertQualityComparisonSimulationDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const cloneReport = (report: AlertQualityUnifiedReport): AlertQualityUnifiedReport =>
  JSON.parse(JSON.stringify(report)) as AlertQualityUnifiedReport;

export const simulateAlertQualityUnifiedComparison = async (
  dependencies: AlertQualityComparisonSimulationDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  const directory = mkdtempSync(path.join(tmpdir(), 'alert-quality-comparison-'));
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
      evaluationRunId: 'evaluation-run:quality-comparison-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const terminalReturns = generateTerminalReturnRecords({
      evaluations,
      outcomeRunId: 'terminal-return-run:quality-comparison-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const pathOutcomes = generatePathOutcomeRecords({
      evaluations,
      terminalReturns,
      marketRecording,
      pathOutcomeRunId: 'path-outcome-run:quality-comparison-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const targetStops = generateTargetStopOutcomeRecords({
      evaluations,
      terminalReturns,
      pathOutcomes,
      marketRecording,
      policy: createTargetStopPolicy({ targetPercent: 1, stopPercent: 1 }),
      targetStopRunId: 'target-stop-run:quality-comparison-simulation',
      now: PATH_OUTCOME_SIMULATION_NOW,
    });
    const shared = {
      terminalReturnRecords: terminalReturns,
      pathOutcomeRecords: pathOutcomes,
      targetStopRecords: targetStops,
      groupingDimensions: ['HORIZON_MS', 'SOURCE'] as const,
    };
    const baseline = generateAlertQualityUnifiedReport({
      ...shared,
      reportRunId: 'alert-quality-report:comparison-baseline',
      generatedAt: PATH_OUTCOME_SIMULATION_NOW,
    });
    const candidate = cloneReport(
      generateAlertQualityUnifiedReport({
        ...shared,
        reportRunId: 'alert-quality-report:comparison-candidate',
        generatedAt: PATH_OUTCOME_SIMULATION_NOW + 1,
      }),
    );
    const changedGroup = candidate.terminalReturn.groups.find(
      (group) => group.coverage.eligibleRate !== null,
    );
    if (!changedGroup || changedGroup.coverage.eligibleRate === null) {
      throw new Error('Comparison simulation could not find an observed eligibility rate');
    }
    changedGroup.coverage.eligibleRate = Math.max(
      0,
      changedGroup.coverage.eligibleRate - 0.01,
    );

    const incompatible = cloneReport(candidate);
    incompatible.reportRunId = 'alert-quality-report:comparison-incompatible';
    incompatible.terminalReturn.reportRunId = incompatible.reportRunId;
    incompatible.pathOutcome.reportRunId = incompatible.reportRunId;
    incompatible.targetStop.reportRunId = incompatible.reportRunId;
    incompatible.terminalReturn.policyFingerprints = ['incompatible-policy'];

    await writeAlertQualityUnifiedReports(baselinePath, [baseline]);
    await writeAlertQualityUnifiedReports(candidatePath, [candidate]);
    await writeAlertQualityUnifiedReports(incompatiblePath, [incompatible]);

    const comparisonLogs: string[] = [];
    const comparisonCode = await runAlertQualityComparisonCli(
      ['--baseline', baselinePath, '--candidate', candidatePath],
      {
        log: (...values) => {
          const line = values.map(String).join(' ');
          comparisonLogs.push(line);
          log(line);
        },
        error: errorLog,
      },
    );
    if (comparisonCode !== 0) {
      throw new Error('Compatible comparison returned a non-zero exit code');
    }
    if (!comparisonLogs.some((line) => line.startsWith('Degraded metrics: '))) {
      throw new Error('Comparison output did not include degraded metric totals');
    }

    const expectedErrors: string[] = [];
    const incompatibleCode = await runAlertQualityComparisonCli(
      ['--baseline', baselinePath, '--candidate', incompatiblePath],
      {
        log: () => undefined,
        error: (...values) => expectedErrors.push(values.map(String).join(' ')),
      },
    );
    const compatibilityRejected =
      incompatibleCode === 1 &&
      expectedErrors.some((line) => line.includes('policy fingerprints are incompatible'));
    if (!compatibilityRejected) {
      throw new Error('Incompatible comparison was not rejected as expected');
    }

    log('ALERT QUALITY COMPARISON SIMULATION');
    log(`Compatible comparison exit code: ${comparisonCode}`);
    log(`Compatibility rejection verified: ${compatibilityRejected}`);
    log(`Changed metric group: ${changedGroup.groupKey}`);
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality comparison simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    log(
      `Temporary comparison outputs cleaned up: ${[
        baselinePath,
        candidatePath,
        incompatiblePath,
      ].every((file) => !existsSync(file))}`,
    );
  }
};

if (require.main === module) {
  void simulateAlertQualityUnifiedComparison().then((code) => {
    process.exitCode = code;
  });
}
