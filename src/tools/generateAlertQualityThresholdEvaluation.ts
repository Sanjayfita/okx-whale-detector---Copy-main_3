import {
  createAlertQualityThresholdPolicy,
  createPersistedAlertQualityThresholdEvaluation,
  evaluateAlertQualityThresholds,
  readAlertQualityUnifiedReports,
  writeAlertQualityThresholdEvaluations,
  type AlertQualityThresholdPolicy,
} from '../evaluation';

const parseValues = (args: readonly string[]): Map<string, string> => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`${flag ?? 'option'} requires a value`);
    }
    values.set(flag, value);
  }
  return values;
};

const numberValue = (flag: string, value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a finite number`);
  return parsed;
};

export const runGenerateAlertQualityThresholdEvaluationCli = async (
  args: readonly string[],
  dependencies: { log?: (...values: unknown[]) => void; error?: (...values: unknown[]) => void } = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  try {
    const values = parseValues(args);
    for (const required of ['--file', '--output', '--run-id', '--generated-at']) {
      if (!values.has(required)) throw new Error(`${required} is required`);
    }
    const allowed = new Set([
      '--file', '--output', '--run-id', '--generated-at', '--minimum-samples',
      '--minimum-eligible-rate', '--minimum-win-rate', '--minimum-expectancy',
      '--maximum-ambiguity-rate',
    ]);
    for (const flag of values.keys()) {
      if (!allowed.has(flag)) throw new Error(`Unknown quality-policy generation option: ${flag}`);
    }
    const read = await readAlertQualityUnifiedReports(values.get('--file')!);
    if (read.issues.length > 0) throw new Error(`Unified report file contains ${read.issues.length} read issue(s)`);
    if (read.reports.length !== 1) throw new Error('Unified report file must contain exactly one report');

    const overrides: Partial<AlertQualityThresholdPolicy> = {};
    const mappings: Array<[string, keyof AlertQualityThresholdPolicy]> = [
      ['--minimum-samples', 'minimumSampleCount'],
      ['--minimum-eligible-rate', 'minimumEligibleRate'],
      ['--minimum-win-rate', 'minimumWinRate'],
      ['--minimum-expectancy', 'minimumExpectancyPercent'],
      ['--maximum-ambiguity-rate', 'maximumAmbiguityRate'],
    ];
    mappings.forEach(([flag, key]) => {
      if (values.has(flag)) overrides[key] = numberValue(flag, values.get(flag)!) as never;
    });
    const policy = createAlertQualityThresholdPolicy(overrides);
    const thresholdReport = evaluateAlertQualityThresholds({ report: read.reports[0]!, policy });
    const persisted = createPersistedAlertQualityThresholdEvaluation({
      thresholdReport,
      evaluationRunId: values.get('--run-id')!,
      generatedAt: numberValue('--generated-at', values.get('--generated-at')!),
    });
    await writeAlertQualityThresholdEvaluations(values.get('--output')!, [persisted]);
    log('PERSISTED ALERT QUALITY THRESHOLD EVALUATION');
    log(`Evaluation run ID: ${persisted.evaluationRunId}`);
    log(`Source report: ${persisted.sourceReportRunId}`);
    log(`PASS: ${persisted.passedCount}`);
    log(`FAIL: ${persisted.failedCount}`);
    log(`INSUFFICIENT_DATA: ${persisted.insufficientDataCount}`);
    log(`Output: ${values.get('--output')!}`);
    log('Research analytics only. This output is not a trading recommendation.');
    return 0;
  } catch (error: unknown) {
    errorLog('Alert-quality threshold evaluation generation failed:', error instanceof Error ? error.message : error);
    return 1;
  }
};

if (require.main === module) {
  void runGenerateAlertQualityThresholdEvaluationCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
