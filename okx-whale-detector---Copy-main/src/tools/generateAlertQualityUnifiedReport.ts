import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  generateAlertQualityUnifiedReport,
  type AlertQualityUnifiedGroupDimension,
  writeAlertQualityUnifiedReports,
} from '../evaluation';
import { AlertPathOutcomeReader } from '../recording/AlertPathOutcomeReader';
import { AlertTargetStopOutcomeReader } from '../recording/AlertTargetStopOutcomeReader';
import { AlertTerminalReturnReader } from '../recording/AlertTerminalReturnReader';

const DIMENSIONS = new Set<AlertQualityUnifiedGroupDimension>([
  'INSTRUMENT_ID',
  'INSTRUMENT_TYPE',
  'HORIZON_MS',
  'SOURCE',
  'EVENT_TYPE',
  'RELATIONSHIP',
  'SEVERITY',
  'OKX_BIAS',
  'EXTERNAL_BIAS',
]);

export interface AlertQualityGeneratorCliDependencies {
  log?: (...values: unknown[]) => void;
  warn?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
  clock?: () => number;
  runIdFactory?: () => string;
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

export const runAlertQualityGeneratorCli = async (
  args: readonly string[],
  dependencies: AlertQualityGeneratorCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const errorLog = dependencies.error ?? console.error;
  try {
    const values = parseValues(args);
    for (const required of ['--returns', '--paths', '--targets', '--output']) {
      if (!values.has(required)) throw new Error(`${required} is required`);
    }
    const known = new Set([
      '--returns',
      '--paths',
      '--targets',
      '--output',
      '--report-run-id',
      '--now',
      '--group-by',
    ]);
    for (const flag of values.keys()) {
      if (!known.has(flag)) throw new Error(`Unknown alert-quality option: ${flag}`);
    }
    const inputPaths = [
      path.resolve(values.get('--returns')!),
      path.resolve(values.get('--paths')!),
      path.resolve(values.get('--targets')!),
    ];
    const outputPath = path.resolve(values.get('--output')!);
    const collisionKeys = [...inputPaths, outputPath].map((value) =>
      process.platform === 'win32' ? value.toLowerCase() : value,
    );
    if (new Set(collisionKeys).size !== collisionKeys.length) {
      throw new Error('Alert-quality input and output paths must be distinct');
    }
    const groupingDimensions = (values.get('--group-by') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean) as AlertQualityUnifiedGroupDimension[];
    for (const dimension of groupingDimensions) {
      if (!DIMENSIONS.has(dimension)) {
        throw new Error(`Unsupported alert-quality grouping dimension: ${dimension}`);
      }
    }
    const generatedAt = values.has('--now')
      ? Number(values.get('--now'))
      : (dependencies.clock?.() ?? Date.now());
    const reportRunId =
      values.get('--report-run-id') ??
      dependencies.runIdFactory?.() ??
      `alert-quality-report:${randomUUID()}`;

    const [returns, paths, targets] = await Promise.all([
      new AlertTerminalReturnReader().read(inputPaths[0]!),
      new AlertPathOutcomeReader().read(inputPaths[1]!),
      new AlertTargetStopOutcomeReader().read(inputPaths[2]!),
    ]);
    for (const [label, diagnostics] of [
      ['terminal-return', returns.malformedLines],
      ['path-outcome', paths.malformedLines],
      ['target-stop', targets.malformedLines],
    ] as const) {
      for (const diagnostic of diagnostics) {
        warn(`Malformed ${label} line ${diagnostic.lineNumber}: ${diagnostic.message}`);
      }
    }

    const report = generateAlertQualityUnifiedReport({
      terminalReturnRecords: returns.records,
      pathOutcomeRecords: paths.records,
      targetStopRecords: targets.records,
      reportRunId,
      generatedAt,
      groupingDimensions,
    });
    await writeAlertQualityUnifiedReports(outputPath, [report]);
    log('UNIFIED ALERT QUALITY REPORT');
    log(`Run ID: ${report.reportRunId}`);
    log(`Generated at: ${report.generatedAt}`);
    log(`Terminal-return records: ${report.inputRecordCounts.terminalReturn}`);
    log(`Path-outcome records: ${report.inputRecordCounts.pathOutcome}`);
    log(`Target/stop records: ${report.inputRecordCounts.targetStop}`);
    log(`Grouping dimensions: ${report.groupingDimensions.join(', ') || 'none'}`);
    log(`Output: ${outputPath}`);
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert-quality report generation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertQualityGeneratorCli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
  );
}
