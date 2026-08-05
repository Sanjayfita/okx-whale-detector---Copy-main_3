export const QUALIFIED_ALERT_EVIDENCE_SCHEMA_VERSION = 1 as const;

export type QualifiedAlertDirection = 'BULLISH' | 'BEARISH';

export interface QualifiedAlertEvidenceRecord {
  schemaVersion: typeof QUALIFIED_ALERT_EVIDENCE_SCHEMA_VERSION;
  evaluationId: string;
  alertId: string;
  instrumentId: string;
  detectedAt: number;
  recordedAt: number;
  direction: QualifiedAlertDirection;
  signalType: string;
  confidence: number;
  referencePrice: number;
  bestBid: number;
  bestAsk: number;
  spreadPercent: number;
  sourceCommit: string;
  configurationFingerprint: string;
  qualified: true;
  liveOrderExecutionAllowed: false;
}

const requireNonEmpty = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
};

const requireFinitePositive = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return value;
};

const requireTimestamp = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
};

const approximatelyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(1e-9, Math.abs(right) * 1e-9);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const createQualifiedAlertEvidenceRecord = (
  input: Omit<
    QualifiedAlertEvidenceRecord,
    'schemaVersion' | 'qualified' | 'liveOrderExecutionAllowed'
  >,
): QualifiedAlertEvidenceRecord => {
  const detectedAt = requireTimestamp(input.detectedAt, 'detectedAt');
  const recordedAt = requireTimestamp(input.recordedAt, 'recordedAt');
  if (recordedAt < detectedAt) {
    throw new Error('recordedAt cannot be earlier than detectedAt');
  }
  if (
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 100
  ) {
    throw new Error('confidence must be between 0 and 100');
  }
  if (!Number.isFinite(input.spreadPercent) || input.spreadPercent < 0) {
    throw new Error('spreadPercent must be a non-negative finite number');
  }
  if (input.direction !== 'BULLISH' && input.direction !== 'BEARISH') {
    throw new Error('direction must be BULLISH or BEARISH');
  }

  const referencePrice = requireFinitePositive(
    input.referencePrice,
    'referencePrice',
  );
  const bestBid = requireFinitePositive(input.bestBid, 'bestBid');
  const bestAsk = requireFinitePositive(input.bestAsk, 'bestAsk');

  if (bestBid >= bestAsk) {
    throw new Error('bestBid must be lower than bestAsk');
  }
  if (referencePrice < bestBid || referencePrice > bestAsk) {
    throw new Error('referencePrice must be inside the bid/ask spread');
  }

  const expectedSpreadPercent = ((bestAsk - bestBid) / referencePrice) * 100;
  if (!approximatelyEqual(input.spreadPercent, expectedSpreadPercent)) {
    throw new Error('spreadPercent does not match the recorded bid/ask spread');
  }

  return Object.freeze({
    schemaVersion: QUALIFIED_ALERT_EVIDENCE_SCHEMA_VERSION,
    evaluationId: requireNonEmpty(input.evaluationId, 'evaluationId'),
    alertId: requireNonEmpty(input.alertId, 'alertId'),
    instrumentId: requireNonEmpty(input.instrumentId, 'instrumentId'),
    detectedAt,
    recordedAt,
    direction: input.direction,
    signalType: requireNonEmpty(input.signalType, 'signalType'),
    confidence: input.confidence,
    referencePrice,
    bestBid,
    bestAsk,
    spreadPercent: input.spreadPercent,
    sourceCommit: requireNonEmpty(input.sourceCommit, 'sourceCommit'),
    configurationFingerprint: requireNonEmpty(
      input.configurationFingerprint,
      'configurationFingerprint',
    ),
    qualified: true,
    liveOrderExecutionAllowed: false,
  });
};

export const parseQualifiedAlertEvidenceRecord = (
  value: unknown,
): QualifiedAlertEvidenceRecord | undefined => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== QUALIFIED_ALERT_EVIDENCE_SCHEMA_VERSION ||
    value.qualified !== true ||
    value.liveOrderExecutionAllowed !== false ||
    typeof value.evaluationId !== 'string' ||
    typeof value.alertId !== 'string' ||
    typeof value.instrumentId !== 'string' ||
    typeof value.detectedAt !== 'number' ||
    typeof value.recordedAt !== 'number' ||
    (value.direction !== 'BULLISH' && value.direction !== 'BEARISH') ||
    typeof value.signalType !== 'string' ||
    typeof value.confidence !== 'number' ||
    typeof value.referencePrice !== 'number' ||
    typeof value.bestBid !== 'number' ||
    typeof value.bestAsk !== 'number' ||
    typeof value.spreadPercent !== 'number' ||
    typeof value.sourceCommit !== 'string' ||
    typeof value.configurationFingerprint !== 'string'
  ) {
    return undefined;
  }

  try {
    return createQualifiedAlertEvidenceRecord({
      evaluationId: value.evaluationId,
      alertId: value.alertId,
      instrumentId: value.instrumentId,
      detectedAt: value.detectedAt,
      recordedAt: value.recordedAt,
      direction: value.direction,
      signalType: value.signalType,
      confidence: value.confidence,
      referencePrice: value.referencePrice,
      bestBid: value.bestBid,
      bestAsk: value.bestAsk,
      spreadPercent: value.spreadPercent,
      sourceCommit: value.sourceCommit,
      configurationFingerprint: value.configurationFingerprint,
    });
  } catch {
    return undefined;
  }
};
