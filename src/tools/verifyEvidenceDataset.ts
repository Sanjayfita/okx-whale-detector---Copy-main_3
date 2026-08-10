import { resolve } from 'node:path';

import { verifyEvidenceDatasetRelease } from '../research/evidenceDatasetRelease';
import { inspectEvidenceProgress } from '../research/evidenceProgressInspector';
import { requireSafeEvidenceEvaluationId } from '../research/evidenceEvaluationId';

const safePathSegment = (value: string, name: string): string => {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new Error(`${name} must be a safe non-empty path segment`);
  }
  return normalized;
};

const main = async (): Promise<void> => {
  const evaluationId = requireSafeEvidenceEvaluationId(process.argv[2] ?? '');
  const releaseArgument = process.argv[3];
  if (releaseArgument === undefined) {
    const evaluationDirectory = resolve('data', 'evaluations', evaluationId);
    const report = await inspectEvidenceProgress(evaluationDirectory);
    console.log('ACTIVE EVIDENCE EVALUATION VERIFICATION');
    console.log(`Evaluation ID: ${report.evaluationId}`);
    console.log(`Integrity valid: ${report.integrityValid}`);
    console.log(`Collection health: ${report.health}`);
    console.log(`Readiness status: ${report.readinessStatus}`);
    console.log(`Malformed records: ${report.malformedRecordCount}`);
    console.log(`Missing snapshots: ${report.missingSnapshotCount}`);
    console.log(`Missing outcomes: ${report.missingObservationCount}`);
    console.log(`Overdue outcomes: ${report.overduePendingObservationCount}`);
    console.log(`Evidence fingerprint: ${report.evidenceSource.fingerprint}`);
    for (const reason of report.healthReasons) console.log(`Reason: ${reason}`);
    console.log('Live order execution remains disabled.');
    if (!report.integrityValid) process.exitCode = 1;
    return;
  }
  const releaseFingerprint = safePathSegment(
    releaseArgument,
    'releaseFingerprint',
  );
  const result = await verifyEvidenceDatasetRelease(
    resolve(
      'data',
      'evaluations',
      evaluationId,
      'datasets',
      releaseFingerprint,
    ),
  );

  console.log('EVIDENCE DATASET RELEASE VERIFICATION');
  console.log(`Valid: ${result.valid}`);
  console.log(`Release fingerprint: ${result.releaseFingerprint ?? 'N/A'}`);
  console.log(`Dataset fingerprint: ${result.datasetFingerprint ?? 'N/A'}`);
  for (const reason of result.reasons) console.log(`Reason: ${reason}`);
  console.log('Live order execution remains disabled.');
  if (!result.valid) process.exitCode = 1;
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `Evidence verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
