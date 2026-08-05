import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import { parseAlertOutcomeObservation } from '../research/alertOutcomeObservation';
import { parseEvidenceNdjson } from '../research/evidenceNdjson';
import {
  createEvidenceProfitabilityReport,
  type EvidenceProfitabilityReport,
} from '../research/evidenceProfitability';
import { parseQualifiedAlertEvidenceRecord } from '../research/qualifiedAlertEvidence';

const readOptional = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (isErrorWithCode(error, 'ENOENT')) return '';
    throw error;
  }
};

export const generateEvidenceProfitabilityReport = async (input: {
  evaluationId: string;
  evaluationDirectory?: string;
  generatedAt?: number;
  startingCapital?: number;
  positionNotional?: number;
  roundTripCostPercent?: number;
}): Promise<EvidenceProfitabilityReport> => {
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

  return createEvidenceProfitabilityReport({
    generatedAt: input.generatedAt ?? Date.now(),
    evaluationId: input.evaluationId,
    alerts: alerts.records,
    outcomes: outcomes.records,
    malformedRecords: alerts.malformed + outcomes.malformed,
    policy: {
      startingCapital: input.startingCapital,
      positionNotional: input.positionNotional,
      roundTripCostPercent: input.roundTripCostPercent,
    },
  });
};

const readNumberArgument = (
  args: readonly string[],
  name: string,
): number | undefined => {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return undefined;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`);
  return value;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const evaluationId =
    args.find((value) => !value.startsWith('--')) ?? 'eval-2026-08-02-v1';
  const evaluationDirectory = resolve('data', 'evaluations', evaluationId);
  const report = await generateEvidenceProfitabilityReport({
    evaluationId,
    evaluationDirectory,
    startingCapital: readNumberArgument(args, '--capital'),
    positionNotional: readNumberArgument(args, '--notional'),
    roundTripCostPercent: readNumberArgument(args, '--cost-percent'),
  });
  const outputDirectory = resolve(evaluationDirectory, 'reports');
  const outputPath = resolve(outputDirectory, 'profitability-report.json');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('EVIDENCE PROFITABILITY REPORT');
  console.log(`Evaluation ID: ${report.evaluationId}`);
  console.log(`Qualified alerts: ${report.qualifiedAlerts}`);
  console.log(`Completed observations: ${report.completedObservations}`);
  console.log(
    `Primary horizon: ${report.policy.primaryHorizonMinutes} minute(s)`,
  );
  console.log(
    `Primary-horizon complete alerts: ${report.primaryHorizonCompleteAlerts}`,
  );
  console.log(
    `Independent primary-horizon alerts: ${report.independentPrimaryHorizonAlerts}`,
  );
  console.log(
    `Independent net expectancy: ${report.overall.netExpectancyUsdt} USDT/alert`,
  );
  console.log(
    `Independent hypothetical net PnL: ${report.overall.hypotheticalNetPnlUsdt} USDT`,
  );
  console.log(`Output: ${outputPath}`);
  console.log(
    'Research analytics only. Live order execution remains disabled.',
  );
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `Evidence profitability generation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
