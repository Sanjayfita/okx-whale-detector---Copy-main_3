import { resolve } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';

import { parseAlertOutcomeObservation } from './alertOutcomeObservation';
import { createAlphaResearchConfig } from './alphaResearchConfig';
import { createAlphaResearchDataset } from './alphaResearchDataset';
import type {
  AlphaResearchConfig,
  AlphaResearchDataset,
} from './alphaFeatureTypes';
import { parseAlphaResearchEventSnapshot } from './alphaSnapshotParser';
import { readEvidenceNdjsonFile } from './evidenceNdjson';
import { parseQualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';
import { parseQuarantinedEvidenceEpisode } from './evidenceQuarantine';

export const loadAlphaResearchDataset = async (input: {
  readonly evaluationId: string;
  readonly evaluationDirectory?: string;
  readonly config?: AlphaResearchConfig;
}): Promise<AlphaResearchDataset> => {
  const evaluationId = input.evaluationId.trim();
  if (evaluationId.length === 0)
    throw new Error('evaluationId must not be empty');
  const directory =
    input.evaluationDirectory ?? resolve('data', 'evaluations', evaluationId);
  const [alerts, snapshots, outcomes, quarantines] = await Promise.all([
    readEvidenceNdjsonFile(
      resolve(directory, 'qualified-alerts.ndjson'),
      parseQualifiedAlertEvidenceRecord,
    ),
    readEvidenceNdjsonFile(
      resolve(directory, 'alpha-snapshots.ndjson'),
      parseAlphaResearchEventSnapshot,
    ),
    readEvidenceNdjsonFile(
      resolve(directory, 'outcomes.ndjson'),
      parseAlertOutcomeObservation,
    ),
    readEvidenceNdjsonFile(
      resolve(directory, 'quarantined-episodes.ndjson'),
      parseQuarantinedEvidenceEpisode,
    ).catch((error: unknown) => {
      if (!isErrorWithCode(error, 'ENOENT')) throw error;
      return Object.freeze({
        records: Object.freeze([]),
        malformed: 0,
        nonEmptyLines: 0,
        invalidJson: 0,
        invalidRecord: 0,
        issues: Object.freeze([]),
      });
    }),
  ]);
  if (
    alerts.malformed > 0 ||
    snapshots.malformed > 0 ||
    outcomes.malformed > 0 ||
    quarantines.malformed > 0
  ) {
    const firstIssue = [
      ...alerts.issues.map(
        (issue) => `alerts:${issue.lineNumber}:${issue.reason}`,
      ),
      ...snapshots.issues.map(
        (issue) => `snapshots:${issue.lineNumber}:${issue.reason}`,
      ),
      ...outcomes.issues.map(
        (issue) => `outcomes:${issue.lineNumber}:${issue.reason}`,
      ),
      ...quarantines.issues.map(
        (issue) => `quarantines:${issue.lineNumber}:${issue.reason}`,
      ),
    ][0];
    throw new Error(
      `Malformed alpha inputs: alerts=${alerts.malformed}, snapshots=${snapshots.malformed}, outcomes=${outcomes.malformed}, quarantines=${quarantines.malformed}${firstIssue === undefined ? '' : `; first=${firstIssue}`}`,
    );
  }
  const config = input.config ?? createAlphaResearchConfig();
  const quarantinedAlertIds = new Set(quarantines.records.map((record) => record.alertId));
  return createAlphaResearchDataset({
    evaluationId,
    qualifiedAlerts: alerts.records.filter((alert) => !quarantinedAlertIds.has(alert.alertId)),
    snapshots: snapshots.records.filter((snapshot) => !quarantinedAlertIds.has(snapshot.evidence.alertId)),
    outcomes: outcomes.records.filter((outcome) => !quarantinedAlertIds.has(outcome.alertId)),
    config,
  });
};
