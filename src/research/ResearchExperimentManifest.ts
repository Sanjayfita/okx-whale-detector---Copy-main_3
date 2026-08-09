import { createHash } from 'node:crypto';

import type { PointInTimeSelectionQuality } from '../data/PointInTimeRecords';

export type ResearchExperimentScope = 'PURGED_DISCOVERY' | 'FROZEN_HOLDOUT';

export interface ResearchSplitAudit {
  readonly foldCount: number;
  readonly discoveryObservationCount: number;
  readonly holdoutObservationCount: number;
  readonly overlappingEpisodeCount: number;
  readonly holdoutPurgedObservationCount: number;
  readonly holdoutEmbargoedObservationCount: number;
}

export interface ResearchExperimentManifestInput {
  readonly experimentId: string;
  readonly scope: ResearchExperimentScope;
  readonly hypothesisFamilyId: string;
  readonly strategyIds: readonly string[];
  readonly featureNames: readonly string[];
  readonly discoveryDatasetFingerprint: string;
  readonly holdoutDatasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly candidateFamilyFingerprint: string;
  readonly candidateCount: number;
  readonly hypothesisCount: number;
  readonly splitAudit: ResearchSplitAudit;
  readonly dataQuality: readonly PointInTimeSelectionQuality[];
  readonly frozenAt: number;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly holdoutAccessCount: number;
  readonly significanceMethod: 'PAIRED_BOOTSTRAP_AND_RANDOMIZATION';
  readonly multiplicityMethod: 'HOLM_BONFERRONI';
}

export interface ResearchExperimentManifest
  extends ResearchExperimentManifestInput {
  readonly status: 'ACCEPTED_FOR_RESEARCH' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
  readonly manifestFingerprint: string;
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const fingerprint = (value: unknown): string =>
  createHash('sha256').update(stableStringify(value)).digest('hex');

const requireNonEmpty = (value: string, name: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
};

const requireTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const validateUniqueNames = (
  values: readonly string[],
  name: string,
): readonly string[] => {
  if (values.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  const normalized = values.map((value) => {
    requireNonEmpty(value, name);
    return value;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${name} must be unique`);
  }
  return normalized.slice().sort();
};

export const createResearchExperimentManifest = (
  input: ResearchExperimentManifestInput,
): ResearchExperimentManifest => {
  for (const [name, value] of [
    ['experimentId', input.experimentId],
    ['hypothesisFamilyId', input.hypothesisFamilyId],
    ['discoveryDatasetFingerprint', input.discoveryDatasetFingerprint],
    ['holdoutDatasetFingerprint', input.holdoutDatasetFingerprint],
    ['codeCommit', input.codeCommit],
    ['configurationHash', input.configurationHash],
    ['candidateFamilyFingerprint', input.candidateFamilyFingerprint],
  ] as const) {
    requireNonEmpty(value, name);
  }
  const strategyIds = validateUniqueNames(input.strategyIds, 'strategyIds');
  const featureNames = validateUniqueNames(input.featureNames, 'featureNames');
  for (const [name, value] of [
    ['frozenAt', input.frozenAt],
    ['startedAt', input.startedAt],
    ['completedAt', input.completedAt],
  ] as const) {
    requireTimestamp(value, name);
  }
  for (const [name, value] of [
    ['candidateCount', input.candidateCount],
    ['hypothesisCount', input.hypothesisCount],
    ['foldCount', input.splitAudit.foldCount],
    ['discoveryObservationCount', input.splitAudit.discoveryObservationCount],
    ['holdoutObservationCount', input.splitAudit.holdoutObservationCount],
    ['overlappingEpisodeCount', input.splitAudit.overlappingEpisodeCount],
    ['holdoutPurgedObservationCount', input.splitAudit.holdoutPurgedObservationCount],
    ['holdoutEmbargoedObservationCount', input.splitAudit.holdoutEmbargoedObservationCount],
    ['holdoutAccessCount', input.holdoutAccessCount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }

  const rejectionReasons: string[] = [];
  if (input.discoveryDatasetFingerprint === input.holdoutDatasetFingerprint) {
    rejectionReasons.push('DISCOVERY_AND_HOLDOUT_FINGERPRINTS_MUST_DIFFER');
  }
  if (input.candidateCount <= 0 || input.hypothesisCount <= 0) {
    rejectionReasons.push('NON_EMPTY_HYPOTHESIS_FAMILY_REQUIRED');
  }
  if (input.candidateCount > input.hypothesisCount) {
    rejectionReasons.push('CANDIDATE_COUNT_EXCEEDS_HYPOTHESIS_COUNT');
  }
  if (input.splitAudit.foldCount <= 0) {
    rejectionReasons.push('PURGED_FOLDS_REQUIRED');
  }
  if (
    input.splitAudit.discoveryObservationCount <= 0 ||
    input.splitAudit.holdoutObservationCount <= 0
  ) {
    rejectionReasons.push('DISCOVERY_AND_HOLDOUT_OBSERVATIONS_REQUIRED');
  }
  if (input.splitAudit.overlappingEpisodeCount > 0) {
    rejectionReasons.push('EPISODE_OVERLAP_DETECTED');
  }
  if (input.frozenAt > input.startedAt) {
    rejectionReasons.push('EXPERIMENT_NOT_FROZEN_BEFORE_START');
  }
  if (input.completedAt < input.startedAt) {
    rejectionReasons.push('COMPLETION_PRECEDES_START');
  }
  if (
    input.scope === 'PURGED_DISCOVERY' &&
    input.holdoutAccessCount !== 0
  ) {
    rejectionReasons.push('HOLDOUT_ACCESSED_DURING_DISCOVERY');
  }
  if (
    input.scope === 'FROZEN_HOLDOUT' &&
    input.holdoutAccessCount !== 1
  ) {
    rejectionReasons.push('HOLDOUT_MUST_BE_ACCESSED_EXACTLY_ONCE');
  }
  if (input.dataQuality.length === 0) {
    rejectionReasons.push('DATA_QUALITY_EVIDENCE_REQUIRED');
  }
  for (const quality of input.dataQuality) {
    if (quality.status !== 'PASSED') {
      rejectionReasons.push(`DATA_QUALITY_REJECTED:${quality.sourceName}`);
    }
  }

  const normalizedInput: ResearchExperimentManifestInput = {
    ...input,
    strategyIds,
    featureNames,
    dataQuality: input.dataQuality
      .slice()
      .sort((left, right) => left.sourceName.localeCompare(right.sourceName)),
  };
  return {
    ...normalizedInput,
    status: rejectionReasons.length === 0 ? 'ACCEPTED_FOR_RESEARCH' : 'REJECTED',
    rejectionReasons: [...new Set(rejectionReasons)],
    manifestFingerprint: fingerprint(normalizedInput),
    strategyPromotionAllowed: false,
    liveExecutionAllowed: false,
  };
};
