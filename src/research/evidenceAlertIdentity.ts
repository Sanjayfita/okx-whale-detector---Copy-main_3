import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import { readEvidenceNdjsonFile } from './evidenceNdjson';
import { parseQualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

/** Stable for one evaluation so process restarts cannot reset alert IDs. */
export const createEvidenceAlertSessionId = (evaluationId: string): string => {
  const normalized = evaluationId.trim();
  if (normalized.length === 0) throw new Error('evaluationId must not be empty');
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  return `evidence-${digest}`;
};

export const loadEvidenceInitialAlertSequence = async (
  evaluationDirectory: string,
  sourceSessionId: string,
): Promise<number> => {
  let parsed;
  try {
    parsed = await readEvidenceNdjsonFile(
      join(evaluationDirectory, 'qualified-alerts.ndjson'),
      parseQualifiedAlertEvidenceRecord,
    );
  } catch (error: unknown) {
    if (isErrorWithCode(error, 'ENOENT')) return 0;
    throw error;
  }
  if (parsed.malformed > 0) {
    throw new Error(
      `Cannot recover alert sequence from malformed evidence: ${parsed.malformed} invalid record(s)`,
    );
  }

  const prefix = `correlated-alert:${sourceSessionId}:`;
  let maximum = 0;
  for (const alert of parsed.records) {
    if (!alert.alertId.startsWith(prefix)) continue;
    const sequenceText = alert.alertId.slice(prefix.length);
    const sequence = Number(sequenceText);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) {
      throw new Error(`Invalid persisted correlated alert sequence: ${alert.alertId}`);
    }
    maximum = Math.max(maximum, sequence);
  }
  return maximum;
};
