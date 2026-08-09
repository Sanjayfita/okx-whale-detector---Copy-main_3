import path from 'node:path';

import { AlertTerminalReturnReader } from '../recording/AlertTerminalReturnReader';

export interface TerminalReturnInspectorDependencies {
  log?: (...values: unknown[]) => void;
  warn?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const uniqueSorted = (
  values: Iterable<string | number>,
): Array<string | number> =>
  [...new Set(values)].sort((left, right) =>
    String(left).localeCompare(String(right), undefined, { numeric: true }),
  );

export const runTerminalReturnInspectorCli = async (
  args: readonly string[],
  dependencies: TerminalReturnInspectorDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const errorLog = dependencies.error ?? console.error;
  try {
    if (args.length !== 2 || args[0] !== '--file' || !args[1]) {
      throw new Error(
        'Usage: alerts:inspect:returns -- --file <terminal-returns.jsonl>',
      );
    }
    const filePath = path.resolve(args[1]);
    const result = await new AlertTerminalReturnReader().read(filePath);
    const cells = result.records.flatMap((record) => record.returns);
    const count = (
      predicate: (cell: (typeof cells)[number]) => boolean,
    ): number => cells.filter(predicate).length;
    const sourceCounts = new Map<string, number>();
    const reasons = new Map<string, number>();
    for (const cell of cells) {
      sourceCounts.set(cell.source, (sourceCounts.get(cell.source) ?? 0) + 1);
      for (const reason of cell.reasons) {
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    }

    log('ALERT TERMINAL RETURN INSPECTION');
    log(`File: ${filePath}`);
    log(
      `Schema versions: ${uniqueSorted(result.records.map((record) => record.schemaVersion)).join(', ') || 'none'}`,
    );
    log(
      `Evaluator versions: ${uniqueSorted(result.records.map((record) => record.evaluatorVersion)).join(', ') || 'none'}`,
    );
    log(
      `Outcome run IDs: ${uniqueSorted(result.records.map((record) => record.outcomeRunId)).join(', ') || 'none'}`,
    );
    log(`Records: ${result.records.length}`);
    log(
      `Unique evaluations: ${new Set(result.records.map((record) => record.sourceEvaluationId)).size}`,
    );
    log(
      `Policy fingerprints: ${uniqueSorted(result.records.map((record) => record.returnPolicy.fingerprint)).join(', ') || 'none'}`,
    );
    log(
      `Instruments: ${uniqueSorted(result.records.map((record) => `${record.instrument.instId} (${record.instrument.instType ?? 'unknown'})`)).join(', ') || 'none'}`,
    );
    log(
      `Horizons (ms): ${uniqueSorted(cells.map((cell) => cell.horizonMs)).join(', ') || 'none'}`,
    );
    for (const [source, total] of [...sourceCounts].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      log(`${source}: ${total}`);
    }
    log(`Eligible cells: ${count((cell) => cell.eligibility === 'ELIGIBLE')}`);
    log(
      `Ineligible cells: ${count((cell) => cell.eligibility === 'INELIGIBLE')}`,
    );
    log(
      `Ambiguous cells: ${count((cell) => cell.eligibility === 'AMBIGUOUS')}`,
    );
    log(`Raw-return metrics: ${count((cell) => cell.rawReturn !== null)}`);
    log(
      `OKX directional metrics: ${count((cell) => cell.okxDirectionalReturn !== null)}`,
    );
    log(
      `External directional metrics: ${count((cell) => cell.externalDirectionalReturn !== null)}`,
    );
    log(
      `Primary ineligibility reasons: ${
        [...reasons]
          .sort(
            ([leftReason, leftCount], [rightReason, rightCount]) =>
              rightCount - leftCount || leftReason.localeCompare(rightReason),
          )
          .map(([reason, total]) => `${reason}=${total}`)
          .join(', ') || 'none'
      }`,
    );
    log(`Malformed lines: ${result.malformedLines.length}`);
    log(
      `Unsupported schema versions: ${result.unsupportedSchemaVersions.length}`,
    );
    log(`Duplicate outcome IDs: ${result.duplicateOutcomeIds.length}`);
    log(`Duplicate evaluation/policy units: ${result.duplicateUnits.length}`);
    log('Win rate, expectancy, MFE, and MAE: not present');
    for (const malformed of result.malformedLines) {
      warn(`Malformed line ${malformed.lineNumber}: ${malformed.message}`);
    }
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Terminal-return inspection failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runTerminalReturnInspectorCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
