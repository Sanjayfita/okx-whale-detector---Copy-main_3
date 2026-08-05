import path from 'node:path';

import {
  formatAlertQualityUnifiedReport,
  readAlertQualityUnifiedReports,
} from '../evaluation';

export const runAlertQualitySummaryCli = async (
  args: readonly string[],
  dependencies: {
    log?: (...values: unknown[]) => void;
    error?: (...values: unknown[]) => void;
  } = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  try {
    if (args.length !== 2 || args[0] !== '--file' || !args[1]) {
      throw new Error(
        'Usage: alerts:summary:quality -- --file <alert-quality-reports.jsonl>',
      );
    }
    const file = path.resolve(args[1]);
    const read = await readAlertQualityUnifiedReports(file);
    if (read.issues.length > 0) {
      throw new Error(
        `Cannot summarize a report file with ${read.issues.length} read issue(s)`,
      );
    }
    if (read.reports.length === 0) {
      log('ALERT QUALITY SUMMARY');
      log(`File: ${file}`);
      log('No valid reports.');
      return 0;
    }
    read.reports.forEach((report, index) => {
      if (index > 0) log('');
      log(formatAlertQualityUnifiedReport(report).trimEnd());
    });
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality summary failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertQualitySummaryCli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
  );
}
