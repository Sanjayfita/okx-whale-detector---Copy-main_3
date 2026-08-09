import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { analyzeAlphaConfidenceResearch } from '../research/alphaConfidenceResearch';
import { analyzeAlphaResearchDataset } from '../research/alphaResearchAnalysis';
import { createAlphaResearchConfig } from '../research/alphaResearchConfig';
import { loadAlphaResearchDataset } from '../research/alphaResearchDatasetLoader';

export { loadAlphaResearchDataset } from '../research/alphaResearchDatasetLoader';

export const generateAlphaResearchReport = async (input: {
  readonly evaluationId: string;
  readonly evaluationDirectory?: string;
  readonly config?: ReturnType<typeof createAlphaResearchConfig>;
}) => {
  const config = input.config ?? createAlphaResearchConfig();
  const dataset = await loadAlphaResearchDataset({
    evaluationId: input.evaluationId,
    evaluationDirectory: input.evaluationDirectory,
    config,
  });
  return analyzeAlphaResearchDataset({ dataset, config });
};

export const generateAlphaResearchBundle = async (input: {
  readonly evaluationId: string;
  readonly evaluationDirectory?: string;
  readonly config?: ReturnType<typeof createAlphaResearchConfig>;
}) => {
  const config = input.config ?? createAlphaResearchConfig();
  const dataset = await loadAlphaResearchDataset({
    evaluationId: input.evaluationId,
    evaluationDirectory: input.evaluationDirectory,
    config,
  });
  return Object.freeze({
    alphaReport: analyzeAlphaResearchDataset({ dataset, config }),
    confidenceReport: analyzeAlphaConfidenceResearch({
      dataset,
      alphaConfig: config,
    }),
  });
};

const main = async (): Promise<void> => {
  const evaluationId = process.argv[2]?.trim();
  if (!evaluationId) {
    throw new Error('Usage: npm run alpha:research -- <evaluation-id>');
  }
  const evaluationDirectory = resolve('data', 'evaluations', evaluationId);
  const { alphaReport, confidenceReport } = await generateAlphaResearchBundle({
    evaluationId,
    evaluationDirectory,
  });
  const reportsDirectory = resolve(evaluationDirectory, 'reports');
  const alphaOutputPath = resolve(
    reportsDirectory,
    `alpha-research-report-${alphaReport.datasetFingerprint}.json`,
  );
  const confidenceConfigFingerprint = createHash('sha256')
    .update(JSON.stringify(confidenceReport.confidenceConfig), 'utf8')
    .digest('hex');
  const confidenceOutputPath = resolve(
    reportsDirectory,
    `alpha-confidence-report-${confidenceReport.datasetFingerprint}-${confidenceConfigFingerprint}.json`,
  );
  await mkdir(reportsDirectory, { recursive: true });
  await writeFile(
    alphaOutputPath,
    `${JSON.stringify(alphaReport, null, 2)}\n`,
    {
      encoding: 'utf8',
      flag: 'wx',
    },
  );
  await writeFile(
    confidenceOutputPath,
    `${JSON.stringify(confidenceReport, null, 2)}\n`,
    {
      encoding: 'utf8',
      flag: 'wx',
    },
  );

  console.log('WHALE-CONDITIONED ALPHA RESEARCH');
  console.log(`Evaluation ID: ${alphaReport.evaluationId}`);
  console.log(`Alpha status: ${alphaReport.status}`);
  console.log(`Confidence status: ${confidenceReport.status}`);
  console.log(`Joined target rows: ${alphaReport.totalRows}`);
  console.log(`Final holdout rows: ${alphaReport.finalHoldoutRows}`);
  console.log(`Round-trip cost: ${alphaReport.roundTripCostPercent}%`);
  console.log(`Dataset fingerprint: ${alphaReport.datasetFingerprint}`);
  console.log(
    `Configuration fingerprint: ${alphaReport.configurationFingerprint}`,
  );
  console.log(
    `Final holdout calibrated Brier: ${confidenceReport.finalHoldoutCalibrated.brierScore ?? 'N/A'}`,
  );
  console.log(
    `Final holdout calibrated AUC: ${confidenceReport.finalHoldoutCalibrated.rocAuc ?? 'N/A'}`,
  );
  console.log(`Production features enabled: 0`);
  console.log(`Production confidence enabled: false`);
  console.log(`Alpha output: ${alphaOutputPath}`);
  console.log(`Confidence output: ${confidenceOutputPath}`);
  console.log('Research analytics only. No orders were placed.');
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `Alpha research failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
