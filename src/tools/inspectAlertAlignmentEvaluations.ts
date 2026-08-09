import path from 'node:path';

import { AlertAlignmentEvaluationReader } from '../recording/AlertAlignmentEvaluationReader';

export interface AlertAlignmentInspectorCliDependencies {
  log?: (...values: unknown[]) => void;
  warn?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const parseFilePath = (args: readonly string[]): string => {
  if (args.length !== 2 || args[0] !== '--file' || !args[1]) {
    throw new Error(
      'Usage: alerts:inspect:alignment -- --file <alignment-evaluations.jsonl>',
    );
  }
  return path.resolve(args[1]);
};

const sorted = (values: Iterable<string | number>): Array<string | number> =>
  [...new Set(values)].sort((left, right) =>
    String(left).localeCompare(String(right), undefined, { numeric: true }),
  );

export const runAlertAlignmentInspectorCli = async (
  args: readonly string[],
  dependencies: AlertAlignmentInspectorCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const errorLog = dependencies.error ?? console.error;

  try {
    const filePath = parseFilePath(args);
    const result = await new AlertAlignmentEvaluationReader().read(filePath);
    const records = result.records;
    const alignments = records.flatMap((record) => record.alignments);
    const completeness = new Map<string, number>();
    const reasons = new Map<string, number>();
    for (const alignment of alignments) {
      completeness.set(
        alignment.completeness,
        (completeness.get(alignment.completeness) ?? 0) + 1,
      );
      if (alignment.primaryReason) {
        reasons.set(
          alignment.primaryReason,
          (reasons.get(alignment.primaryReason) ?? 0) + 1,
        );
      }
    }

    log('ALERT ALIGNMENT EVALUATION INSPECTION');
    log(`File: ${filePath}`);
    log(
      `Schema versions: ${sorted(records.map((record) => record.schemaVersion)).join(', ') || 'none'}`,
    );
    log(
      `Evaluator versions: ${sorted(records.map((record) => record.provenance.evaluatorVersion)).join(', ') || 'none'}`,
    );
    log(
      `Evaluation run IDs: ${sorted(records.map((record) => record.evaluationRunId)).join(', ') || 'none'}`,
    );
    log(`Records: ${records.length}`);
    log(
      `Unique alerts: ${new Set(records.map((record) => record.alertIdentity.alertId)).size}`,
    );
    log(
      `Source sessions: ${sorted(records.map((record) => record.provenance.marketSourceSessionId ?? 'unavailable')).join(', ') || 'none'}`,
    );
    log(
      `Recording IDs: ${sorted(records.map((record) => record.provenance.recordingId ?? 'unavailable')).join(', ') || 'none'}`,
    );
    log(
      `Instruments: ${sorted(records.map((record) => `${record.instrument.instId} (${record.instrument.instType ?? 'unknown'})`)).join(', ') || 'none'}`,
    );
    log(
      `Horizons (ms): ${sorted(alignments.map((alignment) => alignment.horizonMs)).join(', ') || 'none'}`,
    );
    log(
      `Requested sources: ${sorted(alignments.map((alignment) => alignment.source)).join(', ') || 'none'}`,
    );
    log(
      `Configuration fingerprints: ${sorted(records.map((record) => record.configuration.fingerprint)).join(', ') || 'none'}`,
    );
    log(
      `Recording termination: ${sorted(records.map((record) => record.provenance.recordingTermination)).join(', ') || 'none'}`,
    );
    for (const status of [
      'COMPLETE',
      'PARTIAL',
      'MISSING',
      'AMBIGUOUS',
      'INVALID',
    ]) {
      log(`${status}: ${completeness.get(status) ?? 0}`);
    }
    log(
      `Primary reasons: ${
        [...reasons.entries()]
          .sort(
            ([leftReason, leftCount], [rightReason, rightCount]) =>
              rightCount - leftCount || leftReason.localeCompare(rightReason),
          )
          .map(([reason, count]) => `${reason}=${count}`)
          .join(', ') || 'none'
      }`,
    );
    log(`Malformed lines: ${result.malformedLines.length}`);
    log(
      `Unsupported schema versions: ${result.unsupportedSchemaVersions.length}`,
    );
    log(`Duplicate evaluation IDs: ${result.duplicateEvaluationIds.length}`);
    log(`Duplicate alert/configuration units: ${result.duplicateUnits.length}`);
    log('Returns/outcomes: not present');

    for (const malformed of result.malformedLines) {
      warn(`Malformed line ${malformed.lineNumber}: ${malformed.message}`);
    }
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert alignment inspection failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertAlignmentInspectorCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
