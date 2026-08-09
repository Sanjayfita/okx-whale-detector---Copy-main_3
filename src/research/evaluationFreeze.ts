export const EVALUATION_FREEZE_SCHEMA_VERSION = 1 as const;

export interface EvaluationFreezeManifest {
  schemaVersion: typeof EVALUATION_FREEZE_SCHEMA_VERSION;
  evaluationId: string;
  frozenAt: number;
  sourceCommit: string;
  configurationFingerprint: string;
  symbols: readonly string[];
  horizonsMinutes: readonly number[];
  minimumCollectionDays: number;
  minimumQualifiedAlerts: number;
  configurationChangesAllowed: false;
  liveOrderExecutionAllowed: false;
}

const requireNonEmpty = (value: string, name: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${name} must not be empty`);
  return trimmed;
};

const requirePositiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
};

export const createEvaluationFreezeManifest = (input: {
  evaluationId: string;
  frozenAt: number;
  sourceCommit: string;
  configurationFingerprint: string;
  symbols: readonly string[];
  horizonsMinutes?: readonly number[];
  minimumCollectionDays?: number;
  minimumQualifiedAlerts?: number;
}): EvaluationFreezeManifest => {
  const symbols = [...new Set(input.symbols.map((symbol) => requireNonEmpty(symbol, 'symbol')))];
  if (symbols.length === 0) throw new Error('symbols must contain at least one instrument');

  const horizonsMinutes = [...(input.horizonsMinutes ?? [1, 5, 15, 30, 60])];
  if (horizonsMinutes.length === 0) {
    throw new Error('horizonsMinutes must contain at least one horizon');
  }
  horizonsMinutes.forEach((value) => requirePositiveInteger(value, 'horizon'));

  return Object.freeze({
    schemaVersion: EVALUATION_FREEZE_SCHEMA_VERSION,
    evaluationId: requireNonEmpty(input.evaluationId, 'evaluationId'),
    frozenAt: requirePositiveInteger(input.frozenAt, 'frozenAt'),
    sourceCommit: requireNonEmpty(input.sourceCommit, 'sourceCommit'),
    configurationFingerprint: requireNonEmpty(
      input.configurationFingerprint,
      'configurationFingerprint',
    ),
    symbols: Object.freeze(symbols),
    horizonsMinutes: Object.freeze(horizonsMinutes),
    minimumCollectionDays: requirePositiveInteger(
      input.minimumCollectionDays ?? 30,
      'minimumCollectionDays',
    ),
    minimumQualifiedAlerts: requirePositiveInteger(
      input.minimumQualifiedAlerts ?? 1_000,
      'minimumQualifiedAlerts',
    ),
    configurationChangesAllowed: false,
    liveOrderExecutionAllowed: false,
  });
};

export const assertEvaluationRunMatchesFreeze = (input: {
  manifest: EvaluationFreezeManifest;
  sourceCommit: string;
  configurationFingerprint: string;
}): void => {
  if (input.sourceCommit !== input.manifest.sourceCommit) {
    throw new Error('Evaluation source commit does not match the frozen manifest');
  }
  if (input.configurationFingerprint !== input.manifest.configurationFingerprint) {
    throw new Error('Evaluation configuration does not match the frozen manifest');
  }
};
