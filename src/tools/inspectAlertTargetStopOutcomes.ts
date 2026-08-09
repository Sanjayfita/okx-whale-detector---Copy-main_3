import path from 'node:path';

import { TargetStopReason } from '../evaluation/targetStopOutcome';
import { AlertTargetStopOutcomeReader } from '../recording/AlertTargetStopOutcomeReader';

export const runTargetStopInspectorCli = async (
  args: readonly string[],
  dependencies: {
    log?: (...values: unknown[]) => void;
    warn?: (...values: unknown[]) => void;
    error?: (...values: unknown[]) => void;
  } = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  try {
    if (args.length !== 2 || args[0] !== '--file' || !args[1])
      throw new Error(
        'Usage: alerts:inspect:targets -- --file <target-stop-outcomes.jsonl>',
      );
    const file = path.resolve(args[1]);
    const read = await new AlertTargetStopOutcomeReader().read(file);
    const cells = read.records.flatMap((record) => record.outcomes);
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
    const unique = (values: Iterable<string | number>): string =>
      [...new Set(values)]
        .sort((left, right) =>
          String(left).localeCompare(String(right), undefined, {
            numeric: true,
          }),
        )
        .join(', ') || 'none';
    const count = (result: string): number =>
      results.filter((value) => value.result === result).length;
    log('ALERT TARGET STOP INSPECTION');
    log(`File: ${file}`);
    log(`Schema versions: ${unique(read.records.map((r) => r.schemaVersion))}`);
    log(
      `Evaluator versions: ${unique(read.records.map((r) => r.evaluatorVersion))}`,
    );
    log(`Run IDs: ${unique(read.records.map((r) => r.targetStopRunId))}`);
    log(`Records: ${read.records.length}`);
    log(
      `Unique evaluations: ${new Set(read.records.map((r) => r.sourceEvaluationId)).size}`,
    );
    log(
      `Policy fingerprints: ${unique(read.records.map((r) => r.policy.fingerprint))}`,
    );
    log(
      `Target percentages: ${unique(read.records.map((r) => r.policy.targetPercent))}`,
    );
    log(
      `Stop percentages: ${unique(read.records.map((r) => r.policy.stopPercent))}`,
    );
    log(
      `Instruments: ${unique(read.records.map((r) => `${r.instrument.instId} (${r.instrument.instType})`))}`,
    );
    log(`Horizons (ms): ${unique(cells.map((cell) => cell.horizonMs))}`);
    for (const source of [
      'CONFIRMED_CANDLE_CLOSE',
      'ORDER_BOOK_BID_ASK',
      'ORDER_BOOK_MIDPOINT',
    ])
      log(
        `${source}: ${cells.filter((cell) => cell.source === source).length}`,
      );
    log(
      `Eligible cells: ${cells.filter((c) => c.eligibility === 'ELIGIBLE').length}`,
    );
    log(
      `Ineligible cells: ${cells.filter((c) => c.eligibility === 'INELIGIBLE').length}`,
    );
    log(
      `Ambiguous cells: ${cells.filter((c) => c.eligibility === 'AMBIGUOUS').length}`,
    );
    log(`Target first: ${count('TARGET_FIRST')}`);
    log(`Stop first: ${count('STOP_FIRST')}`);
    log(`Neither: ${count('NEITHER')}`);
    log(`Ties: ${count('TIE')}`);
    log(`Candle ambiguities: ${count('AMBIGUOUS')}`);
    log(
      `Gap-disqualified cells: ${cells.filter((cell) => cell.reasons.includes(TargetStopReason.PATH_GAP_INTERSECTION)).length}`,
    );
    log(
      `Truncated cells: ${cells.filter((cell) => cell.reasons.includes(TargetStopReason.RECORDING_TRUNCATED)).length}`,
    );
    log(
      `Recording-ended-before-horizon cells: ${cells.filter((cell) => cell.reasons.includes(TargetStopReason.RECORDING_ENDED_BEFORE_HORIZON)).length}`,
    );
    log(`Malformed lines: ${read.malformedLines.length}`);
    log(
      `Unsupported schema versions: ${read.unsupportedSchemaVersions.length}`,
    );
    log(`Duplicate outcome IDs: ${read.duplicateOutcomeIds.length}`);
    log(`Duplicate source/policy units: ${read.duplicateUnits.length}`);
    log('Win rate, expectancy, and quality aggregation: not present');
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Target/stop inspection failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};
if (require.main === module)
  void runTargetStopInspectorCli(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
  );
