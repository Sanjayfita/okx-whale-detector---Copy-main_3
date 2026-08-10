import { resolve } from 'node:path';

import { createEvidenceDatasetRelease } from '../research/evidenceDatasetRelease';
import { requireSafeEvidenceEvaluationId } from '../research/evidenceEvaluationId';

export const finalizeEvidenceDataset = async (input: {
  readonly evaluationId: string;
  readonly evaluationDirectory?: string;
  readonly createdAt?: number;
}) =>
  createEvidenceDatasetRelease({
    evaluationId: requireSafeEvidenceEvaluationId(input.evaluationId),
    evaluationDirectory: input.evaluationDirectory,
    createdAt: input.createdAt,
  });

const main = async (): Promise<void> => {
  const evaluationIdArgument = process.argv[2];
  if (!evaluationIdArgument) {
    throw new Error('Usage: npm run evidence:finalize -- <evaluation-id>');
  }
  const evaluationId = requireSafeEvidenceEvaluationId(evaluationIdArgument);
  const result = await finalizeEvidenceDataset({
    evaluationId,
    evaluationDirectory: resolve('data', 'evaluations', evaluationId),
  });

  console.log('IMMUTABLE EVIDENCE DATASET RELEASE CREATED');
  console.log(`Evaluation ID: ${result.manifest.evaluationId}`);
  console.log(
    `Evidence fingerprint: ${result.manifest.evidenceSource.fingerprint}`,
  );
  console.log(`Dataset fingerprint: ${result.manifest.datasetFingerprint}`);
  console.log(`Release fingerprint: ${result.manifest.releaseFingerprint}`);
  console.log(`Joined target rows: ${result.manifest.totalRows}`);
  console.log(`Research status: ${result.manifest.researchStatus}`);
  console.log(`Collection health: ${result.manifest.quality.health}`);
  console.log(`Release directory: ${result.directory}`);
  console.log('Production features enabled: 0');
  console.log('Research analytics only. No orders were placed.');
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `Evidence finalization failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
