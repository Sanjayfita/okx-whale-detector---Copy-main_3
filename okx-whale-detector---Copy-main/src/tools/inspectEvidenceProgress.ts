import { resolve } from 'node:path';

import { inspectEvidenceProgress } from '../research/evidenceProgressInspector';

const evaluationId = process.argv[2]?.trim();
if (!evaluationId) {
  throw new Error('Usage: npm run evidence:progress -- <evaluation-id>');
}
if (
  evaluationId === '.' ||
  evaluationId === '..' ||
  evaluationId.includes('/') ||
  evaluationId.includes('\\')
) {
  throw new Error('evaluationId must be a safe directory name');
}
const evaluationDirectory = resolve('data', 'evaluations', evaluationId);

void inspectEvidenceProgress(evaluationDirectory)
  .then((report) => {
    console.log('Evidence progress report');
    console.log(`Evaluation ID: ${report.evaluationId}`);
    console.log(`Collection days: ${report.collectionDays.toFixed(2)}`);
    console.log(
      `Observed evidence span: ${report.evidenceSpanDays} UTC day(s)`,
    );
    console.log(`Qualified alerts: ${report.qualifiedAlertCount}`);
    console.log(
      `Independent alert episodes: ${report.independentAlertCount}`,
    );
    console.log(
      `Overlapping dependent alerts: ${report.dependentAlertCount}`,
    );
    console.log(
      `Independence window: ${report.maximumOutcomeHorizonMinutes} minute(s) per instrument`,
    );
    console.log(`Event-time snapshots: ${report.snapshotCount}`);
    console.log(
      `Snapshots with persisted features: ${report.capturedFeatureSnapshotCount}`,
    );
    console.log(`Missing snapshots: ${report.missingSnapshotCount}`);
    console.log(`Completed observations: ${report.completedObservationCount}`);
    console.log(`Expected observations: ${report.expectedObservationCount}`);
    console.log(`Missing observations: ${report.missingObservationCount}`);
    console.log(`Complete bundles: ${report.completeBundleCount}`);
    console.log(`Pending observations: ${report.pendingObservationCount}`);
    console.log(
      `Overdue observations: ${report.overduePendingObservationCount}`,
    );
    console.log(
      `Observed instruments: ${report.observedInstrumentCount}/${report.minimumInstruments} required`,
    );
    console.log(
      `Snapshot completeness: ${report.snapshotCompletenessRate === null ? 'N/A' : `${(report.snapshotCompletenessRate * 100).toFixed(2)}%`}`,
    );
    console.log(
      `Outcome completeness: ${report.outcomeCompletenessRate === null ? 'N/A' : `${(report.outcomeCompletenessRate * 100).toFixed(2)}%`}`,
    );
    console.log(
      `Feature availability: ${report.featureValueAvailabilityRate === null ? 'N/A' : `${(report.featureValueAvailabilityRate * 100).toFixed(2)}%`}`,
    );
    console.log(
      `Path-excursion availability: ${report.pathExcursionAvailabilityRate === null ? 'N/A' : `${(report.pathExcursionAvailabilityRate * 100).toFixed(2)}%`}`,
    );
    console.log(`Malformed records: ${report.malformedRecordCount}`);
    console.log(`Collection health: ${report.health}`);
    for (const reason of report.healthReasons) {
      console.log(`Health reason: ${reason}`);
    }
    console.log(`Evidence fingerprint: ${report.evidenceSource.fingerprint}`);
    console.log(`Duration requirement met: ${report.durationRequirementMet}`);
    console.log(`Alert requirement met: ${report.alertRequirementMet}`);
    console.log(`Evaluation lease active: ${report.evaluationLeaseActive}`);
    console.log(
      `Ready for final evaluation: ${report.readyForFinalEvaluation}`,
    );
    console.log('Live order execution remains disabled.');
  })
  .catch((error: unknown) => {
    console.error('Failed to inspect evidence progress:', error);
    process.exitCode = 1;
  });
