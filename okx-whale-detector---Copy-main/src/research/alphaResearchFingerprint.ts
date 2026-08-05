import { createHash } from 'node:crypto';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type {
  AlphaResearchConfig,
  AlphaResearchDataset,
} from './alphaFeatureTypes';

const sha256Canonical = (value: unknown): string =>
  createHash('sha256')
    .update(canonicalJsonStringify(value), 'utf8')
    .digest('hex');

export const createAlphaResearchConfigurationFingerprint = (
  config: AlphaResearchConfig,
): string => sha256Canonical(config);

export const createAlphaResearchDatasetFingerprint = (
  dataset: AlphaResearchDataset,
): string => {
  const rows = [...dataset.rows].sort(
    (left, right) =>
      left.detectedAt - right.detectedAt ||
      left.instrumentId.localeCompare(right.instrumentId) ||
      left.alertId.localeCompare(right.alertId),
  );
  return sha256Canonical({
    fingerprintVersion: 'alpha-dataset-v1',
    evaluationId: dataset.evaluationId,
    targetHorizonMinutes: dataset.targetHorizonMinutes,
    roundTripCostPercent: dataset.roundTripCostPercent,
    accounting: {
      inputAlertCount: dataset.inputAlertCount,
      inputSnapshotCount: dataset.inputSnapshotCount,
      inputOutcomeCount: dataset.inputOutcomeCount,
      unmatchedSnapshots: dataset.unmatchedSnapshots,
      missingSnapshots: dataset.missingSnapshots,
      unmatchedOutcomes: dataset.unmatchedOutcomes,
      ignoredOtherHorizonOutcomes: dataset.ignoredOtherHorizonOutcomes,
    },
    synthetic: dataset.synthetic,
    rows,
  });
};
