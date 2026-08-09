import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { AlertTerminalReturnRecord } from '../evaluation/terminalReturn';
import { parseAlertTerminalReturnRecord } from '../evaluation/terminalReturnValidation';

export interface TerminalReturnLineDiagnostic {
  lineNumber: number;
  message: string;
}

export interface UnsupportedTerminalReturnLine extends TerminalReturnLineDiagnostic {
  schemaVersion: unknown;
}

export interface DuplicateTerminalReturn {
  value: string;
  firstLineNumber: number;
  duplicateLineNumber: number;
}

export interface AlertTerminalReturnReadResult {
  records: AlertTerminalReturnRecord[];
  malformedLines: TerminalReturnLineDiagnostic[];
  unsupportedSchemaVersions: UnsupportedTerminalReturnLine[];
  duplicateOutcomeIds: DuplicateTerminalReturn[];
  duplicateUnits: DuplicateTerminalReturn[];
}

export class AlertTerminalReturnReader {
  public async read(filePath: string): Promise<AlertTerminalReturnReadResult> {
    const records: AlertTerminalReturnRecord[] = [];
    const malformedLines: TerminalReturnLineDiagnostic[] = [];
    const unsupportedSchemaVersions: UnsupportedTerminalReturnLine[] = [];
    const duplicateOutcomeIds: DuplicateTerminalReturn[] = [];
    const duplicateUnits: DuplicateTerminalReturn[] = [];
    const outcomeLines = new Map<string, number>();
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
            message: 'Unsupported terminal-return schema version',
          });
          continue;
        }
        const record = parseAlertTerminalReturnRecord(line);
        records.push(record);
        recordDuplicate(
          outcomeLines,
          duplicateOutcomeIds,
          record.outcomeId,
          lineNumber,
        );
        recordDuplicate(
          unitLines,
          duplicateUnits,
          `${record.sourceEvaluationId}\u001f${record.returnPolicy.fingerprint}`,
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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const recordDuplicate = (
  seen: Map<string, number>,
  output: DuplicateTerminalReturn[],
  value: string,
  lineNumber: number,
): void => {
  const previous = seen.get(value);
  if (previous === undefined) {
    seen.set(value, lineNumber);
  } else {
    output.push({
      value,
      firstLineNumber: previous,
      duplicateLineNumber: lineNumber,
    });
  }
};
