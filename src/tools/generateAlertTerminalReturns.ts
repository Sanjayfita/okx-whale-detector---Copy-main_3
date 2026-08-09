import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  generateTerminalReturnRecords,
  type AlertTerminalReturnRecord,
} from '../evaluation';
import { AlertAlignmentEvaluationReader } from '../recording/AlertAlignmentEvaluationReader';
import { AlertTerminalReturnRecorder } from '../recording/AlertTerminalReturnRecorder';

export interface TerminalReturnGeneratorCliDependencies {
  log?: (...values: unknown[]) => void;
  warn?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
  clock?: () => number;
  runIdFactory?: () => string;
}

interface Options {
  evaluationsPath: string;
  outputPath: string;
  outcomeRunId: string;
  now: number;
}

const parseOptions = (
  args: readonly string[],
  dependencies: TerminalReturnGeneratorCliDependencies,
): Options => {
  let evaluationsPath: string | undefined;
  let outputPath: string | undefined;
  let outcomeRunId =
    dependencies.runIdFactory?.() ?? `terminal-return-run:${randomUUID()}`;
  let now = dependencies.clock?.() ?? Date.now();

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag ?? 'option'} requires a value`);
    }
    if (flag === '--evaluations') {
      evaluationsPath = path.resolve(value);
    } else if (flag === '--output') {
      outputPath = path.resolve(value);
    } else if (flag === '--outcome-run-id') {
      outcomeRunId = value;
    } else if (flag === '--now') {
      now = Number(value);
    } else {
      throw new Error(`Unknown terminal-return option: ${flag}`);
    }
    index += 1;
  }

  if (!evaluationsPath || !outputPath) {
    throw new Error(
      'Usage: alerts:evaluate:returns -- --evaluations <alignment-evaluations.jsonl> --output <terminal-returns.jsonl>',
    );
  }
  const normalized = [evaluationsPath, outputPath].map((filePath) =>
    process.platform === 'win32' ? filePath.toLowerCase() : filePath,
  );
  if (normalized[0] === normalized[1]) {
    throw new Error('Terminal-return input and output paths must differ');
  }
  return { evaluationsPath, outputPath, outcomeRunId, now };
};

const printSummary = (
  records: readonly AlertTerminalReturnRecord[],
  malformedInputs: number,
  log: (...values: unknown[]) => void,
): void => {
  const cells = records.flatMap((record) => record.returns);
  const count = (
    predicate: (cell: (typeof cells)[number]) => boolean,
  ): number => cells.filter(predicate).length;
  const sourceCounts = new Map<string, number>();
  for (const cell of cells) {
    sourceCounts.set(cell.source, (sourceCounts.get(cell.source) ?? 0) + 1);
  }

  log('ALERT TERMINAL RETURN EVALUATION');
  log(`Records: ${records.length}`);
  log(`Malformed input lines: ${malformedInputs}`);
  log(`Eligible cells: ${count((cell) => cell.eligibility === 'ELIGIBLE')}`);
  log(
    `Ineligible cells: ${count((cell) => cell.eligibility === 'INELIGIBLE')}`,
  );
  log(`Ambiguous cells: ${count((cell) => cell.eligibility === 'AMBIGUOUS')}`);
  for (const [source, total] of [...sourceCounts].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    log(`${source}: ${total}`);
  }
  log(`Raw-return metrics: ${count((cell) => cell.rawReturn !== null)}`);
  log(
    `OKX directional metrics: ${count((cell) => cell.okxDirectionalReturn !== null)}`,
  );
  log(
    `External directional metrics: ${count((cell) => cell.externalDirectionalReturn !== null)}`,
  );
  log('MFE/MAE and path outcomes: not calculated');
};

export const runTerminalReturnGeneratorCli = async (
  args: readonly string[],
  dependencies: TerminalReturnGeneratorCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const errorLog = dependencies.error ?? console.error;
  try {
    const options = parseOptions(args, dependencies);
    const input = await new AlertAlignmentEvaluationReader().read(
      options.evaluationsPath,
    );
    for (const malformed of input.malformedLines) {
      warn(
        `Malformed evaluation line ${malformed.lineNumber}: ${malformed.message}`,
      );
    }
    if (input.records.length === 0) {
      throw new Error('No valid alignment evaluation records were supplied');
    }
    const records = generateTerminalReturnRecords({
      evaluations: input.records,
      outcomeRunId: options.outcomeRunId,
      now: options.now,
    });
    const recorder = new AlertTerminalReturnRecorder(options.outputPath);
    try {
      records.forEach((record) => recorder.record(record));
    } finally {
      recorder.close();
    }
    printSummary(records, input.malformedLines.length, log);
    log(`Output: ${options.outputPath}`);
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Terminal-return evaluation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runTerminalReturnGeneratorCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
