import {
  createAlertQualityThresholdPolicy,
  evaluateAlertQualityThresholds,
  readAlertQualityUnifiedReports,
  type AlertQualityThresholdEvaluation,
  type AlertQualityThresholdPolicy,
} from '../evaluation';

export interface AlertQualityThresholdPolicyCliDependencies {
  log?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

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

const parseNumber = (flag: string, value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a finite number`);
  return parsed;
};

const formatNumber = (value: number | null): string =>
  value === null ? 'unavailable' : value.toFixed(6);

const printEvaluation = (
  evaluation: AlertQualityThresholdEvaluation,
  policy: AlertQualityThresholdPolicy,
  log: (...values: unknown[]) => void,
): void => {
  log(`${evaluation.status} | ${evaluation.groupKey}`);
  log(
    `Observed: samples=${evaluation.observation.sampleCount}, ` +
      `eligibleRate=${formatNumber(evaluation.observation.eligibleRate)}, ` +
      `winRate=${formatNumber(evaluation.observation.winRate)}, ` +
      `expectancyPercent=${formatNumber(evaluation.observation.expectancyPercent)}, ` +
      `ambiguityRate=${formatNumber(evaluation.observation.ambiguityRate)}`,
  );
  if (evaluation.reasons.length > 0) {
    log(`Reasons: ${evaluation.reasons.join(', ')}`);
  }
  log(
    `Required: samples>=${policy.minimumSampleCount}, ` +
      `eligibleRate>=${policy.minimumEligibleRate.toFixed(6)}, ` +
      `winRate>=${policy.minimumWinRate.toFixed(6)}, ` +
      `expectancyPercent>=${policy.minimumExpectancyPercent.toFixed(6)}, ` +
      `ambiguityRate<=${policy.maximumAmbiguityRate.toFixed(6)}`,
  );
};

export const runAlertQualityThresholdPolicyCli = async (
  args: readonly string[],
  dependencies: AlertQualityThresholdPolicyCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;

  try {
    const values = parseValues(args);
    if (!values.has('--file')) throw new Error('--file is required');
    const allowed = new Set([
      '--file',
      '--minimum-samples',
      '--minimum-eligible-rate',
      '--minimum-win-rate',
      '--minimum-expectancy',
      '--maximum-ambiguity-rate',
    ]);
    for (const flag of values.keys()) {
      if (!allowed.has(flag)) throw new Error(`Unknown quality-policy option: ${flag}`);
    }

    const read = await readAlertQualityUnifiedReports(values.get('--file')!);
    if (read.issues.length > 0) {
      throw new Error(`Unified report file contains ${read.issues.length} read issue(s)`);
    }
    if (read.reports.length !== 1) {
      throw new Error('Unified report file must contain exactly one report');
    }

    const overrides: Partial<AlertQualityThresholdPolicy> = {};
    if (values.has('--minimum-samples')) {
      overrides.minimumSampleCount = parseNumber(
        '--minimum-samples',
        values.get('--minimum-samples')!,
      );
    }
    if (values.has('--minimum-eligible-rate')) {
      overrides.minimumEligibleRate = parseNumber(
        '--minimum-eligible-rate',
        values.get('--minimum-eligible-rate')!,
      );
    }
    if (values.has('--minimum-win-rate')) {
      overrides.minimumWinRate = parseNumber(
        '--minimum-win-rate',
        values.get('--minimum-win-rate')!,
      );
    }
    if (values.has('--minimum-expectancy')) {
      overrides.minimumExpectancyPercent = parseNumber(
        '--minimum-expectancy',
        values.get('--minimum-expectancy')!,
      );
    }
    if (values.has('--maximum-ambiguity-rate')) {
      overrides.maximumAmbiguityRate = parseNumber(
        '--maximum-ambiguity-rate',
        values.get('--maximum-ambiguity-rate')!,
      );
    }

    const policy = createAlertQualityThresholdPolicy(overrides);
    const report = evaluateAlertQualityThresholds({ report: read.reports[0]!, policy });

    log('ALERT QUALITY THRESHOLD POLICY');
    log(`Source report: ${report.reportRunId} @ ${report.generatedAt}`);
    log(`Groups evaluated: ${report.evaluations.length}`);
    log(`PASS: ${report.passedCount}`);
    log(`FAIL: ${report.failedCount}`);
    log(`INSUFFICIENT_DATA: ${report.insufficientDataCount}`);
    log('POLICY');
    log(`Minimum samples: ${policy.minimumSampleCount}`);
    log(`Minimum eligible rate: ${policy.minimumEligibleRate.toFixed(6)}`);
    log(`Minimum win rate: ${policy.minimumWinRate.toFixed(6)}`);
    log(`Minimum expectancy percent: ${policy.minimumExpectancyPercent.toFixed(6)}`);
    log(`Maximum ambiguity rate: ${policy.maximumAmbiguityRate.toFixed(6)}`);
    log('EVALUATIONS');
    report.evaluations.forEach((evaluation) => printEvaluation(evaluation, policy, log));
    log('Research analytics only. This output is not a trading recommendation.');
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality threshold policy evaluation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertQualityThresholdPolicyCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
