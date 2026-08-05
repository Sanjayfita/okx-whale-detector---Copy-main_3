import { createHash } from 'node:crypto';

import {
  isAlertOutcomeHorizonMinutes,
  type AlertOutcomeHorizonMinutes,
} from './alertOutcomeObservation';

export const EVALUATION_SESSION_MANIFEST_SCHEMA_VERSION = 1 as const;
export const DEFAULT_EVALUATION_HORIZONS_MINUTES = [1, 5, 15, 30, 60] as const;

export interface EvaluationSessionManifest {
  readonly schemaVersion: typeof EVALUATION_SESSION_MANIFEST_SCHEMA_VERSION;
  readonly evaluationId: string;
  readonly sourceCommit: string;
  readonly configurationFingerprint: string;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly instruments: readonly string[];
  readonly horizonsMinutes: readonly AlertOutcomeHorizonMinutes[];
  readonly minimumCollectionDays: number;
  readonly minimumQualifiedAlerts: number;
  readonly minimumInstruments: number;
  readonly createdAt: number;
  readonly configurationChangesAllowed: false;
  readonly liveOrderExecutionAllowed: false;
  readonly orderExecutionAuthorized: false;
  readonly dryRunOnly: true;
  readonly transportDispatchAllowed: false;
  readonly testnetExecutionAuthorized: false;
}

const requireNonEmpty = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
};

export const createConfigurationFingerprint = (
  configuration: Readonly<Record<string, unknown>>,
): string =>
  createHash('sha256')
    .update(JSON.stringify(stableValue(configuration)))
    .digest('hex');

export const createEvaluationSessionManifest = (input: {
  evaluationId: string;
  sourceCommit: string;
  configuration: Readonly<Record<string, unknown>>;
  instruments: readonly string[];
  createdAt: number;
  minimumCollectionDays?: number;
  minimumQualifiedAlerts?: number;
  minimumInstruments?: number;
  horizonsMinutes?: readonly number[];
}): EvaluationSessionManifest => {
  const instruments = [
    ...new Set(
      input.instruments.map((value) => requireNonEmpty(value, 'instrument')),
    ),
  ].sort();
  if (instruments.length === 0)
    throw new Error('At least one instrument is required');
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('createdAt must be a non-negative safe integer');
  }

  const minimumCollectionDays = input.minimumCollectionDays ?? 30;
  const minimumQualifiedAlerts = input.minimumQualifiedAlerts ?? 1_000;
  const minimumInstruments =
    input.minimumInstruments ?? Math.min(2, instruments.length);
  if (!Number.isInteger(minimumCollectionDays) || minimumCollectionDays <= 0) {
    throw new Error('minimumCollectionDays must be a positive integer');
  }
  if (
    !Number.isInteger(minimumQualifiedAlerts) ||
    minimumQualifiedAlerts <= 0
  ) {
    throw new Error('minimumQualifiedAlerts must be a positive integer');
  }
  if (
    !Number.isInteger(minimumInstruments) ||
    minimumInstruments <= 0 ||
    minimumInstruments > instruments.length
  ) {
    throw new Error(
      'minimumInstruments must be positive and no greater than the instrument count',
    );
  }

  const horizonsMinutes = [
    ...(input.horizonsMinutes ?? DEFAULT_EVALUATION_HORIZONS_MINUTES),
  ];
  if (horizonsMinutes.some((value) => !isAlertOutcomeHorizonMinutes(value))) {
    throw new Error('horizonsMinutes contains an unsupported outcome horizon');
  }
  if (new Set(horizonsMinutes).size !== horizonsMinutes.length) {
    throw new Error('horizonsMinutes must not contain duplicates');
  }

  const configuration = Object.freeze({ ...input.configuration });

  return Object.freeze({
    schemaVersion: EVALUATION_SESSION_MANIFEST_SCHEMA_VERSION,
    evaluationId: requireNonEmpty(input.evaluationId, 'evaluationId'),
    sourceCommit: requireNonEmpty(input.sourceCommit, 'sourceCommit'),
    configurationFingerprint: createConfigurationFingerprint(configuration),
    configuration,
    instruments: Object.freeze(instruments),
    horizonsMinutes: Object.freeze(
      horizonsMinutes
        .filter(isAlertOutcomeHorizonMinutes)
        .sort((a, b) => a - b),
    ),
    minimumCollectionDays,
    minimumQualifiedAlerts,
    minimumInstruments,
    createdAt: input.createdAt,
    configurationChangesAllowed: false,
    liveOrderExecutionAllowed: false,
    orderExecutionAuthorized: false,
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNormalizedNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value === value.trim();

export const parseEvaluationSessionManifest = (
  value: unknown,
  expectedEvaluationId?: string,
): EvaluationSessionManifest | undefined => {
  if (!isRecord(value) || !isRecord(value.configuration)) {
    return undefined;
  }
  const instruments = value.instruments;
  const horizonsMinutes = value.horizonsMinutes;
  const minimumCollectionDays = value.minimumCollectionDays;
  const minimumQualifiedAlerts = value.minimumQualifiedAlerts;
  const minimumInstruments = value.minimumInstruments;
  const createdAt = value.createdAt;
  if (
    value.schemaVersion !== EVALUATION_SESSION_MANIFEST_SCHEMA_VERSION ||
    typeof value.evaluationId !== 'string' ||
    value.evaluationId.trim().length === 0 ||
    value.evaluationId !== value.evaluationId.trim() ||
    (expectedEvaluationId !== undefined &&
      value.evaluationId !== expectedEvaluationId) ||
    typeof value.sourceCommit !== 'string' ||
    value.sourceCommit.trim().length === 0 ||
    value.sourceCommit !== value.sourceCommit.trim() ||
    typeof value.configurationFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.configurationFingerprint) ||
    value.configurationFingerprint !==
      createConfigurationFingerprint(value.configuration) ||
    !Array.isArray(instruments) ||
    instruments.length === 0 ||
    !instruments.every(isNormalizedNonEmptyString) ||
    new Set(instruments).size !== instruments.length ||
    !Array.isArray(horizonsMinutes) ||
    horizonsMinutes.length === 0 ||
    horizonsMinutes.some((horizon) => !isAlertOutcomeHorizonMinutes(horizon)) ||
    new Set(horizonsMinutes).size !== horizonsMinutes.length ||
    typeof minimumCollectionDays !== 'number' ||
    !Number.isSafeInteger(minimumCollectionDays) ||
    minimumCollectionDays <= 0 ||
    typeof minimumQualifiedAlerts !== 'number' ||
    !Number.isSafeInteger(minimumQualifiedAlerts) ||
    minimumQualifiedAlerts <= 0 ||
    typeof minimumInstruments !== 'number' ||
    !Number.isSafeInteger(minimumInstruments) ||
    minimumInstruments <= 0 ||
    minimumInstruments > instruments.length ||
    typeof createdAt !== 'number' ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    value.configurationChangesAllowed !== false ||
    value.liveOrderExecutionAllowed !== false ||
    value.orderExecutionAuthorized !== false ||
    value.dryRunOnly !== true ||
    value.transportDispatchAllowed !== false ||
    value.testnetExecutionAuthorized !== false
  ) {
    return undefined;
  }

  return Object.freeze({
    schemaVersion: EVALUATION_SESSION_MANIFEST_SCHEMA_VERSION,
    evaluationId: value.evaluationId,
    sourceCommit: value.sourceCommit,
    configurationFingerprint: value.configurationFingerprint,
    configuration: Object.freeze({ ...value.configuration }),
    instruments: Object.freeze([...instruments]),
    horizonsMinutes: Object.freeze(
      horizonsMinutes.filter(isAlertOutcomeHorizonMinutes),
    ),
    minimumCollectionDays,
    minimumQualifiedAlerts,
    minimumInstruments,
    createdAt,
    configurationChangesAllowed: false,
    liveOrderExecutionAllowed: false,
    orderExecutionAuthorized: false,
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
  });
};
