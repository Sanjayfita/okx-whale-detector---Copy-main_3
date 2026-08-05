import path from 'node:path';

import { readAlertQualityUnifiedReports } from '../evaluation';

export const runAlertQualityInspectorCli = async (
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
        'Usage: alerts:inspect:quality -- --file <alert-quality-reports.jsonl>',
      );
    }
    const file = path.resolve(args[1]);
    const read = await readAlertQualityUnifiedReports(file);
    const terminalGroups = read.reports.reduce(
      (sum, report) => sum + report.terminalReturn.groups.length,
      0,
    );
    const pathGroups = read.reports.reduce(
      (sum, report) => sum + report.pathOutcome.groups.length,
      0,
    );
    const targetGroups = read.reports.reduce(
      (sum, report) => sum + report.targetStop.groups.length,
      0,
    );
    const inputCount = (
      key: 'terminalReturn' | 'pathOutcome' | 'targetStop',
    ): number =>
      read.reports.reduce(
        (sum, report) => sum + report.inputRecordCounts[key],
        0,
      );
    const unique = (values: Iterable<string | number>): string =>
      [...new Set(values)]
        .sort((left, right) =>
          String(left).localeCompare(String(right), undefined, { numeric: true }),
        )
        .join(', ') || 'none';

    log('UNIFIED ALERT QUALITY REPORT INSPECTION');
    log(`File: ${file}`);
    log(`Reports: ${read.reports.length}`);
    log(`Run IDs: ${unique(read.reports.map((report) => report.reportRunId))}`);
    log(`Generated at: ${unique(read.reports.map((report) => report.generatedAt))}`);
    log(`Terminal-return input records: ${inputCount('terminalReturn')}`);
    log(`Path-outcome input records: ${inputCount('pathOutcome')}`);
    log(`Target/stop input records: ${inputCount('targetStop')}`);
    log(`Terminal-return groups: ${terminalGroups}`);
    log(`Path-outcome groups: ${pathGroups}`);
    log(`Target/stop groups: ${targetGroups}`);
    log(`Exact duplicate reports: ${read.exactDuplicateCount}`);
    log(
      `Malformed JSON lines: ${read.issues.filter((issue) => issue.reason === 'MALFORMED_JSON').length}`,
    );
    log(
      `Invalid reports: ${read.issues.filter((issue) => issue.reason === 'INVALID_REPORT').length}`,
    );
    log(
      `Unsupported schema versions: ${read.issues.filter((issue) => issue.reason === 'UNSUPPORTED_SCHEMA_VERSION').length}`,
    );
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality report inspection failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertQualityInspectorCli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
  );
}
