import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { verifyEvidenceDatasetRelease } from '../research/evidenceDatasetRelease';

const safeSegment = (value: string, name: string): string => {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new Error(`${name} must be a safe path segment`);
  }
  return normalized;
};

export const resolveEvidenceDatasetIdentity = (
  args: readonly string[],
): Readonly<{ evaluationId: string; releaseFingerprint: string }> => {
  const first = args[0]?.trim() ?? '';
  const second = args[1]?.trim();
  const separator = first.indexOf(':');
  const evaluationId = safeSegment(
    second === undefined && separator > 0 ? first.slice(0, separator) : first,
    'evaluationId',
  );
  const releaseFingerprint = safeSegment(
    second === undefined && separator > 0
      ? first.slice(separator + 1)
      : (second ?? ''),
    'releaseFingerprint',
  );
  if (!/^[a-f0-9]{64}$/u.test(releaseFingerprint)) {
    throw new Error('releaseFingerprint must be a 64-character SHA-256 value');
  }
  return Object.freeze({ evaluationId, releaseFingerprint });
};

const main = async (): Promise<void> => {
  if (process.argv.length < 3) {
    throw new Error(
      'Usage: npm run evidence:research -- <evaluation-id>:<release-fingerprint>',
    );
  }
  const identity = resolveEvidenceDatasetIdentity(process.argv.slice(2));
  const releaseDirectory = resolve(
    'data',
    'evaluations',
    identity.evaluationId,
    'datasets',
    identity.releaseFingerprint,
  );
  const verification = await verifyEvidenceDatasetRelease(releaseDirectory);
  if (!verification.valid) {
    throw new Error(
      `Immutable dataset verification failed: ${verification.reasons.join('; ')}`,
    );
  }
  const manifest = JSON.parse(
    await readFile(resolve(releaseDirectory, 'release-manifest.json'), 'utf8'),
  ) as { releaseId?: unknown; researchStatus?: unknown; totalRows?: unknown };
  const report = JSON.parse(
    await readFile(
      resolve(releaseDirectory, 'alpha-research-report.json'),
      'utf8',
    ),
  ) as { status?: unknown; reasons?: unknown };

  console.log('VERIFIED IMMUTABLE EVIDENCE RESEARCH RELEASE');
  console.log(`Dataset ID: ${String(manifest.releaseId)}`);
  console.log(`Rows: ${String(manifest.totalRows)}`);
  console.log(`Research status: ${String(manifest.researchStatus)}`);
  if (Array.isArray(report.reasons)) {
    for (const reason of report.reasons)
      console.log(`Reason: ${String(reason)}`);
  }
  console.log(`Release directory: ${releaseDirectory}`);
  console.log(
    'No strategy parameters were changed. Live trading remains disabled.',
  );
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `Evidence research failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
