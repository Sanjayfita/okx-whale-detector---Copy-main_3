import { resolve } from 'node:path';

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
  const [alerts, snapshots, outcomes] = await Promise.all([
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
  ]);
  if (
    alerts.malformed > 0 ||
    snapshots.malformed > 0 ||
    outcomes.malformed > 0
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
    ][0];
    throw new Error(
      `Malformed alpha inputs: alerts=${alerts.malformed}, snapshots=${snapshots.malformed}, outcomes=${outcomes.malformed}${firstIssue === undefined ? '' : `; first=${firstIssue}`}`,
    );
  }
  const config = input.config ?? createAlphaResearchConfig();
  return createAlphaResearchDataset({
    evaluationId,
    qualifiedAlerts: alerts.records,
    snapshots: snapshots.records,
    outcomes: outcomes.records,
    config,
  });
};
