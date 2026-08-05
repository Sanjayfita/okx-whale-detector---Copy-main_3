import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { AlertAlignmentEvaluationRecord } from '../evaluation/alertAlignmentEvaluation';
import { parseAlertAlignmentEvaluationRecord } from '../evaluation/alertAlignmentEvaluationValidation';

export interface MalformedAlertAlignmentEvaluationLine {
  lineNumber: number;
  message: string;
}

export interface UnsupportedAlertAlignmentEvaluationLine extends MalformedAlertAlignmentEvaluationLine {
  schemaVersion: unknown;
}

export interface DuplicateAlertAlignmentEvaluation {
  evaluationId: string;
  firstLineNumber: number;
  duplicateLineNumber: number;
}

export interface DuplicateAlertAlignmentEvaluationUnit {
  unit: string;
  firstLineNumber: number;
  duplicateLineNumber: number;
}

export interface AlertAlignmentEvaluationReadResult {
  records: AlertAlignmentEvaluationRecord[];
  malformedLines: MalformedAlertAlignmentEvaluationLine[];
  unsupportedSchemaVersions: UnsupportedAlertAlignmentEvaluationLine[];
  duplicateEvaluationIds: DuplicateAlertAlignmentEvaluation[];
  duplicateUnits: DuplicateAlertAlignmentEvaluationUnit[];
}

const duplicateUnit = (record: AlertAlignmentEvaluationRecord): string =>
  [
    record.alertIdentity.alertId,
    record.provenance.recordingId ?? 'none',
    record.configuration.fingerprint,
  ].join('\u001f');

export class AlertAlignmentEvaluationReader {
  public async read(
    filePath: string,
  ): Promise<AlertAlignmentEvaluationReadResult> {
    const records: AlertAlignmentEvaluationRecord[] = [];
    const malformedLines: MalformedAlertAlignmentEvaluationLine[] = [];
    const unsupportedSchemaVersions: UnsupportedAlertAlignmentEvaluationLine[] =
      [];
    const duplicateEvaluationIds: DuplicateAlertAlignmentEvaluation[] = [];
    const duplicateUnits: DuplicateAlertAlignmentEvaluationUnit[] = [];
    const evaluationLines = new Map<string, number>();
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
        const parsed: unknown = JSON.parse(line);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'schemaVersion' in parsed &&
          parsed.schemaVersion !== 1
        ) {
          unsupportedSchemaVersions.push({
            lineNumber,
            schemaVersion: parsed.schemaVersion,
            message: 'Unsupported alert alignment evaluation schema version',
          });
          continue;
        }

        const record = parseAlertAlignmentEvaluationRecord(line);
        records.push(record);

        const previousEvaluationLine = evaluationLines.get(record.evaluationId);
        if (previousEvaluationLine !== undefined) {
          duplicateEvaluationIds.push({
            evaluationId: record.evaluationId,
            firstLineNumber: previousEvaluationLine,
            duplicateLineNumber: lineNumber,
          });
        } else {
          evaluationLines.set(record.evaluationId, lineNumber);
        }

        const unit = duplicateUnit(record);
        const previousUnitLine = unitLines.get(unit);
        if (previousUnitLine !== undefined) {
          duplicateUnits.push({
            unit,
            firstLineNumber: previousUnitLine,
            duplicateLineNumber: lineNumber,
          });
        } else {
          unitLines.set(unit, lineNumber);
        }
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
      duplicateEvaluationIds,
      duplicateUnits,
    };
  }
}
