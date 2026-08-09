import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import { parseAlertOutcomeObservation } from '../research/alertOutcomeObservation';
import { parseEvidenceNdjson } from '../research/evidenceNdjson';
import { EVIDENCE_PRIMARY_HORIZON_MINUTES } from '../research/evidenceEvaluationDefinition';
import type { ProfitabilityPolicy } from '../research/evidenceProfitability';
import { parseQualifiedAlertEvidenceRecord } from '../research/qualifiedAlertEvidence';
import {
  createStatisticalValidationReport,
  type StatisticalValidationReport,
} from '../research/statisticalValidation';

const readOptional = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (isErrorWithCode(error, 'ENOENT')) {
      return '';
    }
    throw error;
  }
};

const readNumberArgument = (
  args: readonly string[],
  name: string,
): number | undefined => {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) {
    return undefined;
  }

  const value = Number(args[index + 1]);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be numeric`);
  }
  return value;
};

export const generateStatisticalValidationReport = async (input: {
  readonly evaluationId: string;
  readonly evaluationDirectory?: string;
  readonly generatedAt?: number;
  readonly policy?: Partial<ProfitabilityPolicy>;
  readonly minimumSampleSize?: number;
  readonly bootstrapIterations?: number;
  readonly purgeMs?: number;
}): Promise<StatisticalValidationReport> => {
  const evaluationDirectory =
    input.evaluationDirectory ??
    resolve('data', 'evaluations', input.evaluationId);
  const [alertsText, outcomesText] = await Promise.all([
    readOptional(resolve(evaluationDirectory, 'qualified-alerts.ndjson')),
    readOptional(resolve(evaluationDirectory, 'outcomes.ndjson')),
  ]);
  const alerts = parseEvidenceNdjson(
    alertsText,
    parseQualifiedAlertEvidenceRecord,
  );
  const outcomes = parseEvidenceNdjson(
    outcomesText,
    parseAlertOutcomeObservation,
  );
  const policy: ProfitabilityPolicy = {
    startingCapital: input.policy?.startingCapital ?? 10_000,
    positionNotional: input.policy?.positionNotional ?? 100,
    roundTripCostPercent: input.policy?.roundTripCostPercent ?? 0.2,
    primaryHorizonMinutes:
      input.policy?.primaryHorizonMinutes ?? EVIDENCE_PRIMARY_HORIZON_MINUTES,
  };

  return createStatisticalValidationReport({
    generatedAt: input.generatedAt ?? Date.now(),
    evaluationId: input.evaluationId,
    alerts: alerts.records,
    outcomes: outcomes.records,
    malformedRecords: alerts.malformed + outcomes.malformed,
    policy,
    options: {
      minimumSampleSize: input.minimumSampleSize,
      bootstrapIterations: input.bootstrapIterations,
      purgeMs: input.purgeMs,
    },
  });
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const evaluationId =
    args.find((value) => !value.startsWith('--')) ?? 'eval-2026-08-02-v1';
  const evaluationDirectory = resolve('data', 'evaluations', evaluationId);
  const report = await generateStatisticalValidationReport({
    evaluationId,
    evaluationDirectory,
    policy: {
      roundTripCostPercent: readNumberArgument(args, '--cost-percent'),
      startingCapital: readNumberArgument(args, '--capital'),
      positionNotional: readNumberArgument(args, '--notional'),
    },
    minimumSampleSize: readNumberArgument(args, '--minimum-samples'),
    bootstrapIterations: readNumberArgument(args, '--bootstrap-iterations'),
    purgeMs: readNumberArgument(args, '--purge-ms'),
  });
  const outputDirectory = resolve(evaluationDirectory, 'reports');
  const outputPath = resolve(
    outputDirectory,
    'statistical-validation-report.json',
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('STATISTICAL VALIDATION REPORT');
  console.log(`Evaluation ID: ${report.evaluationId}`);
  console.log(`Matched observations: ${report.matchedObservations}`);
  console.log(
    `Primary horizon: ${report.primaryHorizonMinutes} minute(s)`,
  );
  console.log(`Independent alerts: ${report.independentAlerts}`);
  console.log(
    `95% block-bootstrap interval: ${report.overallConfidenceInterval.lower}% to ${report.overallConfidenceInterval.upper}%`,
  );
  console.log(
    `Purged test mean: ${report.chronologicalSplit.testMeanNetReturnPercent}%`,
  );
  console.log(`Ready for qualification: ${report.readyForQualification}`);
  for (const reason of report.reasons) {
    console.log(`- ${reason}`);
  }
  console.log(`Output: ${outputPath}`);
  console.log(
    'Research analytics only. Live order execution remains disabled.',
  );
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `Statistical validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
