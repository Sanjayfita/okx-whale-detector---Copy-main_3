import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  createTargetStopPolicy,
  generateTargetStopOutcomeRecords,
  TargetStopReason,
} from '../evaluation';
import { prepareAlertAlignmentMarketRecording } from '../evaluation/alertAlignmentEvaluationGenerator';
import type { AlertTargetStopOutcomeRecord } from '../evaluation/targetStopOutcome';
import { AlertAlignmentEvaluationReader } from '../recording/AlertAlignmentEvaluationReader';
import { AlertPathOutcomeReader } from '../recording/AlertPathOutcomeReader';
import { AlertTargetStopOutcomeRecorder } from '../recording/AlertTargetStopOutcomeRecorder';
import { AlertTerminalReturnReader } from '../recording/AlertTerminalReturnReader';

export interface TargetStopGeneratorCliDependencies {
  log?: (...values: unknown[]) => void;
  warn?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
  clock?: () => number;
  runIdFactory?: () => string;
}
interface Options {
  evaluationsPath: string;
  returnsPath: string;
  pathsPath: string;
  marketPath: string;
  outputPath: string;
  targetPercent: number;
  stopPercent: number;
  runId: string;
  now: number;
}
const parseOptions = (
  args: readonly string[],
  dependencies: TargetStopGeneratorCliDependencies,
): Options => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--'))
      throw new Error(`${flag ?? 'option'} requires a value`);
    values.set(flag, value);
  }
  for (const required of [
    '--evaluations',
    '--returns',
    '--paths',
    '--market-data',
    '--output',
    '--target-percent',
    '--stop-percent',
  ]) {
    if (!values.has(required)) throw new Error(`${required} is required`);
  }
  const known = new Set([
    '--evaluations',
    '--returns',
    '--paths',
    '--market-data',
    '--output',
    '--target-percent',
    '--stop-percent',
    '--target-stop-run-id',
    '--now',
  ]);
  for (const flag of values.keys()) {
    if (!known.has(flag))
      throw new Error(`Unknown target/stop option: ${flag}`);
  }
  const paths = [
    values.get('--evaluations')!,
    values.get('--returns')!,
    values.get('--paths')!,
    values.get('--market-data')!,
    values.get('--output')!,
  ].map((value) => path.resolve(value));
  const collisionKeys = paths.map((value) =>
    process.platform === 'win32' ? value.toLowerCase() : value,
  );
  if (new Set(collisionKeys).size !== paths.length)
    throw new Error('Target/stop input and output paths must be distinct');
  const targetPercent = Number(values.get('--target-percent'));
  const stopPercent = Number(values.get('--stop-percent'));
  createTargetStopPolicy({ targetPercent, stopPercent });
  return {
    evaluationsPath: paths[0]!,
    returnsPath: paths[1]!,
    pathsPath: paths[2]!,
    marketPath: paths[3]!,
    outputPath: paths[4]!,
    targetPercent,
    stopPercent,
    runId:
      values.get('--target-stop-run-id') ??
      dependencies.runIdFactory?.() ??
      `target-stop-run:${randomUUID()}`,
    now: values.has('--now')
      ? Number(values.get('--now'))
      : (dependencies.clock?.() ?? Date.now()),
  };
};
const summarize = (
  records: readonly AlertTargetStopOutcomeRecord[],
  malformed: number,
  log: (...values: unknown[]) => void,
): void => {
  const cells = records.flatMap((record) => record.outcomes);
  const results = cells.flatMap((cell) =>
    [
      cell.okx,
      cell.external,
      cell.executableOkx,
      cell.executableExternal,
      cell.candleOkx,
      cell.candleExternal,
    ].filter((value) => value !== null),
  );
  const cellCount = (eligibility: string): number =>
    cells.filter((cell) => cell.eligibility === eligibility).length;
  const resultCount = (result: string): number =>
    results.filter((value) => value.result === result).length;
  log('ALERT TARGET STOP EVALUATION');
  log(`Records: ${records.length}`);
  log(`Malformed input lines: ${malformed}`);
  log(`Eligible cells: ${cellCount('ELIGIBLE')}`);
  log(`Ineligible cells: ${cellCount('INELIGIBLE')}`);
  log(`Ambiguous cells: ${cellCount('AMBIGUOUS')}`);
  log(`Target first: ${resultCount('TARGET_FIRST')}`);
  log(`Stop first: ${resultCount('STOP_FIRST')}`);
  log(`Neither: ${resultCount('NEITHER')}`);
  log(`Ties: ${resultCount('TIE')}`);
  log(`Candle ambiguities: ${resultCount('AMBIGUOUS')}`);
  log(
    `Gap-disqualified: ${cells.filter((cell) => cell.reasons.includes(TargetStopReason.PATH_GAP_INTERSECTION)).length}`,
  );
  log('Win rate, expectancy, and quality aggregation: not calculated');
};
export const runTargetStopGeneratorCli = async (
  args: readonly string[],
  dependencies: TargetStopGeneratorCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const errorLog = dependencies.error ?? console.error;
  try {
    const options = parseOptions(args, dependencies);
    const [evaluations, returns, paths] = await Promise.all([
      new AlertAlignmentEvaluationReader().read(options.evaluationsPath),
      new AlertTerminalReturnReader().read(options.returnsPath),
      new AlertPathOutcomeReader().read(options.pathsPath),
    ]);
    for (const [label, diagnostics] of [
      ['evaluation', evaluations.malformedLines],
      ['terminal-return', returns.malformedLines],
      ['path-outcome', paths.malformedLines],
    ] as const)
      for (const diagnostic of diagnostics)
        warn(
          `Malformed ${label} line ${diagnostic.lineNumber}: ${diagnostic.message}`,
        );
    if (
      !evaluations.records.length ||
      !returns.records.length ||
      !paths.records.length
    )
      throw new Error('Valid Phase D, E, and F records are required');
    const marketRecording = prepareAlertAlignmentMarketRecording(
      readFileSync(options.marketPath, 'utf8').split(/\r?\n/),
      { now: options.now },
    );
    const records = generateTargetStopOutcomeRecords({
      evaluations: evaluations.records,
      terminalReturns: returns.records,
      pathOutcomes: paths.records,
      marketRecording,
      policy: createTargetStopPolicy({
        targetPercent: options.targetPercent,
        stopPercent: options.stopPercent,
      }),
      targetStopRunId: options.runId,
      now: options.now,
    });
    const recorder = new AlertTargetStopOutcomeRecorder(options.outputPath);
    try {
      records.forEach((record) => recorder.record(record));
    } finally {
      recorder.close();
    }
    summarize(
      records,
      evaluations.malformedLines.length +
        returns.malformedLines.length +
        paths.malformedLines.length,
      log,
    );
    log(`Output: ${options.outputPath}`);
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Target/stop evaluation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};
if (require.main === module)
  void runTargetStopGeneratorCli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
  );
