import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { AlertTargetStopOutcomeRecord } from '../evaluation/targetStopOutcome';
import { parseAlertTargetStopOutcomeRecord } from '../evaluation/targetStopOutcomeValidation';

export interface TargetStopLineDiagnostic {
  lineNumber: number;
  message: string;
}
export interface DuplicateTargetStopOutcome {
  value: string;
  firstLineNumber: number;
  duplicateLineNumber: number;
}
export interface AlertTargetStopOutcomeReadResult {
  records: AlertTargetStopOutcomeRecord[];
  malformedLines: TargetStopLineDiagnostic[];
  unsupportedSchemaVersions: Array<
    TargetStopLineDiagnostic & { schemaVersion: unknown }
  >;
  duplicateOutcomeIds: DuplicateTargetStopOutcome[];
  duplicateUnits: DuplicateTargetStopOutcome[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const duplicate = (
  seen: Map<string, number>,
  output: DuplicateTargetStopOutcome[],
  value: string,
  lineNumber: number,
): void => {
  const first = seen.get(value);
  if (first === undefined) seen.set(value, lineNumber);
  else
    output.push({
      value,
      firstLineNumber: first,
      duplicateLineNumber: lineNumber,
    });
};
export class AlertTargetStopOutcomeReader {
  public async read(
    filePath: string,
  ): Promise<AlertTargetStopOutcomeReadResult> {
    const records: AlertTargetStopOutcomeRecord[] = [];
    const malformedLines: TargetStopLineDiagnostic[] = [];
    const unsupportedSchemaVersions: Array<
      TargetStopLineDiagnostic & { schemaVersion: unknown }
    > = [];
    const duplicateOutcomeIds: DuplicateTargetStopOutcome[] = [];
    const duplicateUnits: DuplicateTargetStopOutcome[] = [];
    const ids = new Map<string, number>();
    const units = new Map<string, number>();
    const input = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    let lineNumber = 0;
    for await (const line of input) {
      lineNumber += 1;
      if (!line.trim()) continue;
      try {
        const json: unknown = JSON.parse(line);
        if (
          object(json) &&
          'schemaVersion' in json &&
          json.schemaVersion !== 1
        ) {
          unsupportedSchemaVersions.push({
            lineNumber,
            schemaVersion: json.schemaVersion,
            message: 'Unsupported target/stop schema version',
          });
          continue;
        }
        const record = parseAlertTargetStopOutcomeRecord(line);
        records.push(record);
        duplicate(
          ids,
          duplicateOutcomeIds,
          record.targetStopOutcomeId,
          lineNumber,
        );
        duplicate(
          units,
          duplicateUnits,
          `${record.sourceEvaluationId}\u001f${record.policy.fingerprint}`,
          lineNumber,
        );
      } catch (error: unknown) {
        malformedLines.push({
          lineNumber,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      records,
      malformedLines,
      unsupportedSchemaVersions,
      duplicateOutcomeIds,
      duplicateUnits,
    };
  }
}
