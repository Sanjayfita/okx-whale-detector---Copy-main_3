import { resolve } from 'node:path';

import { evaluateEvidenceCanary } from '../research/evidenceCanary';
import { requireSafeEvidenceEvaluationId } from '../research/evidenceEvaluationId';
import { inspectEvidenceProgress } from '../research/evidenceProgressInspector';
import { runEvidenceCollectCommand } from './collectEvidence';

const readDurationSeconds = (args: readonly string[]): number => {
  const index = args.indexOf('--duration-seconds');
  if (index < 0) return 600;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value) || value < 10 || value > 86_400) {
    throw new Error('--duration-seconds must be an integer from 10 to 86400');
  }
  return value;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const evaluationId = requireSafeEvidenceEvaluationId(args[0] ?? '');
  const durationSeconds = readDurationSeconds(args);
  const evaluationDirectory = resolve('data', 'evaluations', evaluationId);
  process.env.OKX_SKIP_AUTO_START = '1';
  const { createAppRuntime } = await import('../index.js');
  const handle = await runEvidenceCollectCommand(evaluationId, {
    createAppRuntime,
  });
  const deadline = Date.now() + durationSeconds * 1_000;
  let finalStatus: 'WAIT' | 'PASS' | 'FAIL' = 'WAIT';
  try {
    while (Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
      const report = await inspectEvidenceProgress(evaluationDirectory);
      const gate = evaluateEvidenceCanary(report);
      finalStatus = gate.status;
      console.log(
        `CANARY ${gate.status} health=${report.health} alerts=${report.qualifiedAlertCount} snapshots=${report.snapshotCount} expectedJobs=${report.expectedObservationCount} completed=${report.completedObservationCount} pending=${report.pendingObservationCount} malformed=${report.malformedRecordCount} unexpected=${report.unexpectedInstrumentCount} missingSnapshots=${report.missingSnapshotCount} missed=${report.missedObservationCount} overdue=${report.overduePendingObservationCount} gaps=${report.schedulerCoverageGapCount} latencyP95Ms=${report.observationLatencyMs.p95 ?? 'N/A'}`,
      );
      if (gate.status === 'FAIL') {
        throw new Error(gate.reasons.join('; '));
      }
    }
  } finally {
    await handle.stop('APPLICATION_CLOSE');
  }
  const finalReport = await inspectEvidenceProgress(evaluationDirectory);
  const finalGate = evaluateEvidenceCanary(finalReport);
  finalStatus = finalGate.status;
  console.log(`CANARY FINAL STATUS: ${finalStatus}`);
  if (finalStatus !== 'PASS') {
    throw new Error(finalGate.reasons.join('; '));
  }
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `Evidence canary failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
