import { requireArrayElement } from '../core/arrayAccess';
import {
  validateQualifiedAlertOutcomeBundle,
  type QualifiedAlertOutcomeBundle,
} from './qualifiedAlertOutcomeBundle';

export const CHRONOLOGICAL_DATASET_SPLIT_SCHEMA_VERSION = 2 as const;

export interface ChronologicalDatasetSplit {
  schemaVersion: typeof CHRONOLOGICAL_DATASET_SPLIT_SCHEMA_VERSION;
  evaluationId: string;
  training: readonly QualifiedAlertOutcomeBundle[];
  validation: readonly QualifiedAlertOutcomeBundle[];
  testing: readonly QualifiedAlertOutcomeBundle[];
  trainingPercent: number;
  validationPercent: number;
  testingPercent: number;
  purgeMs: number;
  embargoMs: number;
  purgedTrainingBundles: number;
  purgedValidationBundles: number;
  chronological: true;
  complete: true;
  liveOrderExecutionAllowed: false;
}

const requirePercent = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0 || value >= 100) {
    throw new Error(`${name} must be greater than 0 and less than 100`);
  }
  return value;
};

export const createChronologicalDatasetSplit = (input: {
  bundles: readonly QualifiedAlertOutcomeBundle[];
  trainingPercent?: number;
  validationPercent?: number;
  testingPercent?: number;
  purgeMs?: number;
  embargoMs?: number;
}): ChronologicalDatasetSplit => {
  const trainingPercent = requirePercent(
    input.trainingPercent ?? 60,
    'trainingPercent',
  );
  const validationPercent = requirePercent(
    input.validationPercent ?? 20,
    'validationPercent',
  );
  const testingPercent = requirePercent(
    input.testingPercent ?? 20,
    'testingPercent',
  );
  const purgeMs = input.purgeMs ?? 0;
  const embargoMs = input.embargoMs ?? 0;
  if (!Number.isSafeInteger(purgeMs) || purgeMs < 0) {
    throw new Error('purgeMs must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(embargoMs) || embargoMs < 0) {
    throw new Error('embargoMs must be a non-negative safe integer');
  }

  if (trainingPercent + validationPercent + testingPercent !== 100) {
    throw new Error('Dataset split percentages must total exactly 100');
  }
  if (input.bundles.length < 5) {
    throw new Error('At least five completed bundles are required');
  }

  const evaluationId = requireArrayElement(
    input.bundles,
    0,
    'first chronological bundle',
  ).evidence.evaluationId;

  for (const bundle of input.bundles) {
    validateQualifiedAlertOutcomeBundle(bundle);
    if (bundle.evidence.evaluationId !== evaluationId) {
      throw new Error('All bundles must belong to the same evaluation');
    }
  }

  const ordered = [...input.bundles].sort(
    (left, right) => left.evidence.detectedAt - right.evidence.detectedAt,
  );

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = requireArrayElement(
      ordered,
      index - 1,
      'previous chronological bundle',
    );
    const current = requireArrayElement(
      ordered,
      index,
      'current chronological bundle',
    );
    if (previous.evidence.detectedAt === current.evidence.detectedAt) {
      throw new Error('Bundle detection timestamps must be unique');
    }
  }

  const trainingCount = Math.floor(ordered.length * (trainingPercent / 100));
  const validationCount = Math.floor(
    ordered.length * (validationPercent / 100),
  );
  const testingCount = ordered.length - trainingCount - validationCount;

  if (trainingCount === 0 || validationCount === 0 || testingCount === 0) {
    throw new Error(
      'Every chronological split must contain at least one bundle',
    );
  }

  const trainingCandidates = ordered.slice(0, trainingCount);
  const validationCandidates = ordered.slice(
    trainingCount,
    trainingCount + validationCount,
  );
  const testing = ordered.slice(trainingCount + validationCount);
  const validationStartedAt = requireArrayElement(
    validationCandidates,
    0,
    'first validation bundle',
  ).evidence.detectedAt;
  const testingStartedAt = requireArrayElement(
    testing,
    0,
    'first testing bundle',
  ).evidence.detectedAt;
  const labelsAvailableBy = (bundle: QualifiedAlertOutcomeBundle): number =>
    Math.max(
      ...bundle.observations.map((observation) => observation.observedAt),
    );
  const training = trainingCandidates.filter(
    (bundle) =>
      labelsAvailableBy(bundle) <= validationStartedAt - purgeMs &&
      bundle.evidence.detectedAt < validationStartedAt - embargoMs,
  );
  const validation = validationCandidates.filter(
    (bundle) =>
      labelsAvailableBy(bundle) <= testingStartedAt - purgeMs &&
      bundle.evidence.detectedAt < testingStartedAt - embargoMs,
  );
  if (training.length === 0 || validation.length === 0) {
    throw new Error(
      'Purging and embargo leave an empty chronological training or validation split',
    );
  }

  return Object.freeze({
    schemaVersion: CHRONOLOGICAL_DATASET_SPLIT_SCHEMA_VERSION,
    evaluationId,
    training: Object.freeze(training),
    validation: Object.freeze(validation),
    testing: Object.freeze(testing),
    trainingPercent,
    validationPercent,
    testingPercent,
    purgeMs,
    embargoMs,
    purgedTrainingBundles: trainingCandidates.length - training.length,
    purgedValidationBundles: validationCandidates.length - validation.length,
    chronological: true,
    complete: true,
    liveOrderExecutionAllowed: false,
  });
};
