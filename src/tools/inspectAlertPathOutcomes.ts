import path from 'node:path';

import { AlertPathOutcomeReader } from '../recording/AlertPathOutcomeReader';

export interface PathOutcomeInspectorDependencies {
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

export const runPathOutcomeInspectorCli = async (
  args: readonly string[],
  dependencies: PathOutcomeInspectorDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const errorLog = dependencies.error ?? console.error;
  try {
    if (args.length !== 2 || args[0] !== '--file' || !args[1]) {
      throw new Error(
        'Usage: alerts:inspect:paths -- --file <path-outcomes.jsonl>',
      );
    }
    const filePath = path.resolve(args[1]);
    const result = await new AlertPathOutcomeReader().read(filePath);
    const cells = result.records.flatMap((record) => record.paths);
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
    log('ALERT PATH OUTCOME INSPECTION');
    log(`File: ${filePath}`);
    log(
      `Schema versions: ${uniqueSorted(result.records.map((record) => record.schemaVersion)).join(', ') || 'none'}`,
    );
    log(
      `Evaluator versions: ${uniqueSorted(result.records.map((record) => record.evaluatorVersion)).join(', ') || 'none'}`,
    );
    log(
      `Path run IDs: ${uniqueSorted(result.records.map((record) => record.pathOutcomeRunId)).join(', ') || 'none'}`,
    );
    log(`Records: ${result.records.length}`);
    log(
      `Unique evaluations: ${new Set(result.records.map((record) => record.sourceEvaluationId)).size}`,
    );
    log(
      `Policy fingerprints: ${uniqueSorted(result.records.map((record) => record.policy.fingerprint)).join(', ') || 'none'}`,
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
    log(`MFE/MAE metrics: ${count((cell) => cell.raw !== null)}`);
    log(
      `Directional metrics: ${count((cell) => cell.okxDirectional !== null) + count((cell) => cell.externalDirectional !== null)}`,
    );
    log(
      `Executable metrics: ${count((cell) => cell.executableOkx !== null) + count((cell) => cell.executableExternal !== null)}`,
    );
    log(`Candle-bound paths: ${count((cell) => cell.candleBounds !== null)}`);
    log(
      `Gap/truncation reasons: ${
        [...reasons]
          .filter(([reason]) =>
            [
              'PATH_GAP_INTERSECTION',
              'RECORDING_TRUNCATED',
              'RECORDING_ENDED_BEFORE_HORIZON',
              'CANDLE_INTERVAL_MISSING',
            ].includes(reason),
          )
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([reason, total]) => `${reason}=${total}`)
          .join(', ') || 'none'
      }`,
    );
    log(`Malformed lines: ${result.malformedLines.length}`);
    log(
      `Unsupported schema versions: ${result.unsupportedSchemaVersions.length}`,
    );
    log(`Duplicate path outcome IDs: ${result.duplicatePathOutcomeIds.length}`);
    log(`Duplicate evaluation/policy units: ${result.duplicateUnits.length}`);
    log('Win rate, expectancy, target/stop ordering: not present');
    for (const malformed of result.malformedLines) {
      warn(`Malformed line ${malformed.lineNumber}: ${malformed.message}`);
    }
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Path-outcome inspection failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runPathOutcomeInspectorCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
