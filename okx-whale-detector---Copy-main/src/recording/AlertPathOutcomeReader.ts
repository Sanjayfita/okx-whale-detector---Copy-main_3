import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { AlertPathOutcomeRecord } from '../evaluation/pathOutcome';
import { parseAlertPathOutcomeRecord } from '../evaluation/pathOutcomeValidation';

export interface PathOutcomeLineDiagnostic {
  lineNumber: number;
  message: string;
}

export interface UnsupportedPathOutcomeLine extends PathOutcomeLineDiagnostic {
  schemaVersion: unknown;
}

export interface DuplicatePathOutcome {
  value: string;
  firstLineNumber: number;
  duplicateLineNumber: number;
}

export interface AlertPathOutcomeReadResult {
  records: AlertPathOutcomeRecord[];
  malformedLines: PathOutcomeLineDiagnostic[];
  unsupportedSchemaVersions: UnsupportedPathOutcomeLine[];
  duplicatePathOutcomeIds: DuplicatePathOutcome[];
  duplicateUnits: DuplicatePathOutcome[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const recordDuplicate = (
  seen: Map<string, number>,
  output: DuplicatePathOutcome[],
  value: string,
  lineNumber: number,
): void => {
  const first = seen.get(value);
  if (first === undefined) {
    seen.set(value, lineNumber);
  } else {
    output.push({
      value,
      firstLineNumber: first,
      duplicateLineNumber: lineNumber,
    });
  }
};

export class AlertPathOutcomeReader {
  public async read(filePath: string): Promise<AlertPathOutcomeReadResult> {
    const records: AlertPathOutcomeRecord[] = [];
    const malformedLines: PathOutcomeLineDiagnostic[] = [];
    const unsupportedSchemaVersions: UnsupportedPathOutcomeLine[] = [];
    const duplicatePathOutcomeIds: DuplicatePathOutcome[] = [];
    const duplicateUnits: DuplicatePathOutcome[] = [];
    const idLines = new Map<string, number>();
    const unitLines = new Map<string, number>();
    const input = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    let lineNumber = 0;

    for await (const line of input) {
      lineNumber += 1;
      if (line.trim().length === 0) {
        continue;
      }
      try {
        const json: unknown = JSON.parse(line);
        if (
          isObject(json) &&
          'schemaVersion' in json &&
          json.schemaVersion !== 1
        ) {
          unsupportedSchemaVersions.push({
            lineNumber,
            schemaVersion: json.schemaVersion,
            message: 'Unsupported path-outcome schema version',
          });
          continue;
        }
        const record = parseAlertPathOutcomeRecord(line);
        records.push(record);
        recordDuplicate(
          idLines,
          duplicatePathOutcomeIds,
          record.pathOutcomeId,
          lineNumber,
        );
        recordDuplicate(
          unitLines,
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
      duplicatePathOutcomeIds,
      duplicateUnits,
    };
  }
}
