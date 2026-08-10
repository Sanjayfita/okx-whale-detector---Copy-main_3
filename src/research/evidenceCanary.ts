import type { EvidenceProgressReport } from './evidenceProgressInspector';

export interface EvidenceCanaryGate {
  readonly status: 'WAIT' | 'PASS' | 'FAIL';
  readonly reasons: readonly string[];
}

/** Strict operational gate; sample-size and profitability are intentionally excluded. */
export const evaluateEvidenceCanary = (
  report: EvidenceProgressReport,
): EvidenceCanaryGate => {
  const failures: string[] = [];
  const checks: readonly [number, string][] = [
    [report.malformedRecordCount, 'malformed or inconsistent record'],
    [report.invalidJsonRecordCount, 'invalid JSON record'],
    [report.schemaInvalidRecordCount, 'schema-invalid record'],
    [report.unexpectedInstrumentCount, 'unexpected instrument'],
    [report.duplicateEventCount, 'duplicate event'],
    [report.duplicateSnapshotCount, 'duplicate snapshot'],
    [report.duplicateObservationCount, 'duplicate observation'],
    [report.orphanObservationCount, 'orphan observation'],
    [report.temporalInconsistencyCount, 'temporal inconsistency'],
    [report.unmatchedSnapshotCount, 'unmatched snapshot'],
    [
      report.missingCapturedFeatureSnapshotCount,
      'snapshot missing persisted features',
    ],
    [
      report.requiredFeatureCalculationFailureCount,
      'required feature calculation failure',
    ],
    [report.criticalFailureCount, 'durable critical failure'],
    [report.missedObservationCount, 'missed observation window'],
    [report.overduePendingObservationCount, 'overdue observation'],
    [report.schedulerCoverageGapCount, 'scheduler coverage gap'],
  ];
  for (const [count, label] of checks) {
    if (count > 0) failures.push(`${count} ${label}(s)`);
  }
  if (report.pendingEventInitializationCount === 0) {
    if (report.missingSnapshotCount > 0) {
      failures.push(`${report.missingSnapshotCount} missing snapshot(s)`);
    }
    if (
      report.expectedObservationCount !==
      report.completedObservationCount + report.pendingObservationCount
    ) {
      failures.push('outcome job accounting is not exact');
    }
  }
  if (failures.length > 0) {
    return Object.freeze({ status: 'FAIL', reasons: Object.freeze(failures) });
  }
  if (
    report.qualifiedAlertCount < 2 ||
    report.completedObservationCount < 2 ||
    report.pendingEventInitializationCount > 0
  ) {
    return Object.freeze({
      status: 'WAIT',
      reasons: Object.freeze([
        report.pendingEventInitializationCount > 0
          ? 'An event initialization is being recovered'
          : report.qualifiedAlertCount < 2
            ? 'Fewer than two real qualified alerts have been admitted'
            : 'Fewer than two short-horizon observations have completed',
      ]),
    });
  }
  return Object.freeze({ status: 'PASS', reasons: Object.freeze([]) });
};
