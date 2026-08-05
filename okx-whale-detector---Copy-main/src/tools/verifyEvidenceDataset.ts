import { resolve } from 'node:path';

import { verifyEvidenceDatasetRelease } from '../research/evidenceDatasetRelease';

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
  const evaluationId = safePathSegment(process.argv[2] ?? '', 'evaluationId');
  const releaseFingerprint = safePathSegment(
    process.argv[3] ?? '',
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
