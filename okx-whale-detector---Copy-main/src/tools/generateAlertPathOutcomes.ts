import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  generatePathOutcomeRecords,
  PathOutcomeReason,
  prepareAlertAlignmentMarketRecording,
  type AlertPathOutcomeRecord,
} from '../evaluation';
import { AlertAlignmentEvaluationReader } from '../recording/AlertAlignmentEvaluationReader';
import { AlertPathOutcomeRecorder } from '../recording/AlertPathOutcomeRecorder';
import { AlertTerminalReturnReader } from '../recording/AlertTerminalReturnReader';

export interface PathOutcomeGeneratorCliDependencies {
  log?: (...values: unknown[]) => void;
  warn?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
  clock?: () => number;
  runIdFactory?: () => string;
}

interface Options {
  evaluationsPath: string;
  returnsPath: string;
  marketDataPath: string;
  outputPath: string;
  pathOutcomeRunId: string;
  now: number;
}

const parseOptions = (
  args: readonly string[],
  dependencies: PathOutcomeGeneratorCliDependencies,
): Options => {
  const paths: Partial<
    Pick<
      Options,
      'evaluationsPath' | 'returnsPath' | 'marketDataPath' | 'outputPath'
    >
  > = {};
  let pathOutcomeRunId =
    dependencies.runIdFactory?.() ?? `path-outcome-run:${randomUUID()}`;
  let now = dependencies.clock?.() ?? Date.now();

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag ?? 'option'} requires a value`);
    }
    if (flag === '--evaluations') {
      paths.evaluationsPath = path.resolve(value);
    } else if (flag === '--returns') {
      paths.returnsPath = path.resolve(value);
    } else if (flag === '--market-data') {
      paths.marketDataPath = path.resolve(value);
    } else if (flag === '--output') {
      paths.outputPath = path.resolve(value);
    } else if (flag === '--path-run-id') {
      pathOutcomeRunId = value;
    } else if (flag === '--now') {
      now = Number(value);
    } else {
      throw new Error(`Unknown path-outcome option: ${flag}`);
    }
    index += 1;
  }
  if (
    !paths.evaluationsPath ||
    !paths.returnsPath ||
    !paths.marketDataPath ||
    !paths.outputPath
  ) {
    throw new Error(
      'Usage: alerts:evaluate:paths -- --evaluations <alignment.jsonl> --returns <terminal-returns.jsonl> --market-data <recording.jsonl> --output <path-outcomes.jsonl>',
    );
  }
  const resolved = [
    paths.evaluationsPath,
    paths.returnsPath,
    paths.marketDataPath,
    paths.outputPath,
  ].map((filePath) =>
    process.platform === 'win32' ? filePath.toLowerCase() : filePath,
  );
  if (new Set(resolved).size !== resolved.length) {
    throw new Error('Path-outcome input and output paths must be distinct');
  }
  return {
    evaluationsPath: paths.evaluationsPath,
    returnsPath: paths.returnsPath,
    marketDataPath: paths.marketDataPath,
    outputPath: paths.outputPath,
    pathOutcomeRunId,
    now,
  };
};

const printSummary = (
  records: readonly AlertPathOutcomeRecord[],
  malformedInputs: number,
  log: (...values: unknown[]) => void,
): void => {
  const cells = records.flatMap((record) => record.paths);
  const count = (
    predicate: (cell: (typeof cells)[number]) => boolean,
  ): number => cells.filter(predicate).length;
  log('ALERT PATH OUTCOME EVALUATION');
  log(`Records: ${records.length}`);
  log(`Malformed input lines: ${malformedInputs}`);
  log(`Eligible cells: ${count((cell) => cell.eligibility === 'ELIGIBLE')}`);
  log(
    `Ineligible cells: ${count((cell) => cell.eligibility === 'INELIGIBLE')}`,
  );
  log(`Ambiguous cells: ${count((cell) => cell.eligibility === 'AMBIGUOUS')}`);
  log(`Midpoint paths: ${count((cell) => cell.raw !== null)}`);
  log(
    `Executable paths: ${count((cell) => cell.executableOkx !== null || cell.executableExternal !== null)}`,
  );
  log(`Candle-bound paths: ${count((cell) => cell.candleBounds !== null)}`);
  log(
    `Gap-disqualified cells: ${count((cell) => cell.reasons.includes(PathOutcomeReason.PATH_GAP_INTERSECTION))}`,
  );
  log('Target/stop ordering, win/loss, and aggregation: not calculated');
};

export const runPathOutcomeGeneratorCli = async (
  args: readonly string[],
  dependencies: PathOutcomeGeneratorCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const errorLog = dependencies.error ?? console.error;
  try {
    const options = parseOptions(args, dependencies);
    const [evaluations, terminalReturns] = await Promise.all([
      new AlertAlignmentEvaluationReader().read(options.evaluationsPath),
      new AlertTerminalReturnReader().read(options.returnsPath),
    ]);
    for (const malformed of evaluations.malformedLines) {
      warn(
        `Malformed evaluation line ${malformed.lineNumber}: ${malformed.message}`,
      );
    }
    for (const malformed of terminalReturns.malformedLines) {
      warn(
        `Malformed terminal-return line ${malformed.lineNumber}: ${malformed.message}`,
      );
    }
    if (evaluations.records.length === 0) {
      throw new Error('No valid alignment evaluation records were supplied');
    }
    if (terminalReturns.records.length === 0) {
      throw new Error('No valid terminal-return records were supplied');
    }
    const marketLines = readFileSync(options.marketDataPath, 'utf8').split(
      /\r?\n/,
    );
    const marketRecording = prepareAlertAlignmentMarketRecording(marketLines, {
      now: options.now,
    });
    const records = generatePathOutcomeRecords({
      evaluations: evaluations.records,
      terminalReturns: terminalReturns.records,
      marketRecording,
      pathOutcomeRunId: options.pathOutcomeRunId,
      now: options.now,
    });
    const recorder = new AlertPathOutcomeRecorder(options.outputPath);
    try {
      records.forEach((record) => recorder.record(record));
    } finally {
      recorder.close();
    }
    printSummary(
      records,
      evaluations.malformedLines.length + terminalReturns.malformedLines.length,
      log,
    );
    log(`Output: ${options.outputPath}`);
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Path-outcome evaluation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runPathOutcomeGeneratorCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
