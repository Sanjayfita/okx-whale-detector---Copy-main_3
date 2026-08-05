import path from 'node:path';

import {
  buildAlertQualityUnifiedTrend,
  readAlertQualityUnifiedReports,
  writeAlertQualityUnifiedTrends,
} from '../evaluation';

export interface AlertQualityTrendGeneratorCliDependencies {
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

export const runAlertQualityTrendGeneratorCli = async (
  args: readonly string[],
  dependencies: AlertQualityTrendGeneratorCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;

  try {
    const values = parseValues(args);
    for (const required of ['--reports', '--output']) {
      if (!values.has(required)) throw new Error(`${required} is required`);
    }
    for (const flag of values.keys()) {
      if (!['--reports', '--output'].includes(flag)) {
        throw new Error(`Unknown alert-quality trend option: ${flag}`);
      }
    }

    const reportsPath = path.resolve(values.get('--reports')!);
    const outputPath = path.resolve(values.get('--output')!);
    const normalizedReportsPath =
      process.platform === 'win32' ? reportsPath.toLowerCase() : reportsPath;
    const normalizedOutputPath =
      process.platform === 'win32' ? outputPath.toLowerCase() : outputPath;
    if (normalizedReportsPath === normalizedOutputPath) {
      throw new Error('Alert-quality report input and trend output paths must be distinct');
    }

    const read = await readAlertQualityUnifiedReports(reportsPath);
    if (read.issues.length > 0) {
      throw new Error(`Unified report history contains ${read.issues.length} read issue(s)`);
    }

    const trend = buildAlertQualityUnifiedTrend(read.reports);
    await writeAlertQualityUnifiedTrends(outputPath, [trend]);

    log('PERSISTED ALERT QUALITY TREND');
    log(`Source reports: ${trend.reports.length}`);
    log(`Transitions: ${trend.transitions.length}`);
    log(`First report: ${trend.reports[0]!.reportRunId} @ ${trend.reports[0]!.generatedAt}`);
    log(
      `Last report: ${trend.reports[trend.reports.length - 1]!.reportRunId} @ ${trend.reports[trend.reports.length - 1]!.generatedAt}`,
    );
    log(`Grouping dimensions: ${trend.groupingDimensions.join(', ') || 'none'}`);
    log(`Metrics: ${trend.metrics.length}`);
    log(`Output: ${outputPath}`);
    log('Research analytics only. This output is not a trading recommendation.');
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality trend generation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertQualityTrendGeneratorCli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
  );
}
