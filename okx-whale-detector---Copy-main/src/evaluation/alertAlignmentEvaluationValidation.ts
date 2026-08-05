import {
  ALERT_ALIGNMENT_EVALUATION_RECORD_TYPE,
  ALERT_ALIGNMENT_EVALUATION_SCHEMA_VERSION,
  ALIGNMENT_EVALUATOR_VERSION,
  createAlertAlignmentEvaluationId,
  isEvaluationRunId,
  isResultConsistencyValid,
  isSha256,
  verifyAlertAlignmentConfigurationFingerprint,
  type AlertAlignmentEvaluationRecord,
  type PersistedAlignmentResult,
} from './alertAlignmentEvaluation';
import {
  AlignmentReason,
  type AlignmentCompleteness,
  type PriceSource,
} from './alignmentTypes';
import { toAlignmentConfiguration } from './alertAlignmentEvaluation';
import {
  validateInstrumentKey,
  validatePriceObservation,
} from './alignmentValidation';
import { isValidRuntimeSessionId } from '../runtime/runtimeSession';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isTimestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

const SOURCES = new Set<PriceSource>([
  'ORDER_BOOK_MIDPOINT',
  'ORDER_BOOK_BID_ASK',
  'CONFIRMED_CANDLE_CLOSE',
]);
const COMPLETENESS = new Set<AlignmentCompleteness>([
  'COMPLETE',
  'PARTIAL',
  'MISSING',
  'AMBIGUOUS',
  'INVALID',
]);
const REASONS = new Set<string>(Object.values(AlignmentReason));
const BIASES = new Set(['BULLISH', 'BEARISH', 'NEUTRAL']);
const RELATIONSHIPS = new Set([
  'AGREEMENT',
  'CONTRADICTION',
  'EXTERNAL_ONLY',
  'OKX_ONLY',
  'NEUTRAL',
]);
const SEVERITIES = new Set(['INFO', 'WATCH', 'STRONG', 'CRITICAL']);
const EVENTS = new Set([
  'NEW_SIGNAL',
  'CONFIDENCE_INCREASED',
  'DIRECTION_CHANGED',
  'AGREEMENT',
  'CONTRADICTION',
]);

const requireInstrument = (value: unknown, allowLegacy: boolean): void => {
  if (
    !isRecord(value) ||
    typeof value.instId !== 'string' ||
    !/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(value.instId)
  ) {
    throw new Error('Invalid alignment evaluation instrument');
  }
  if (allowLegacy && value.instType === null) {
    return;
  }
  const result = validateInstrumentKey(value);
  if (!result.valid) {
    throw new Error('Invalid alignment evaluation instrument');
  }
};

const validateReference = (value: unknown): void => {
  if (value === null) {
    return;
  }
  if (
    !isRecord(value) ||
    value.provenance !== 'CAPTURED_ALERT_CONTEXT' ||
    !isTimestamp(value.referenceTimestamp) ||
    !isTimestamp(value.sourceMarketTimestamp) ||
    !isTimestamp(value.sourceSignalTimestamp) ||
    !isFiniteNumber(value.midpoint) ||
    value.midpoint <= 0 ||
    !isFiniteNumber(value.bestBid) ||
    value.bestBid <= 0 ||
    !isFiniteNumber(value.bestAsk) ||
    value.bestAsk < value.bestBid ||
    !isFiniteNumber(value.spread) ||
    value.spread < 0 ||
    !isFiniteNumber(value.spreadPercent) ||
    value.spreadPercent < 0
  ) {
    throw new Error('Invalid alignment evaluation reference');
  }
};

const validateAlertIdentity = (
  value: unknown,
): AlertAlignmentEvaluationRecord['alertIdentity'] => {
  if (
    !isRecord(value) ||
    typeof value.alertId !== 'string' ||
    value.alertId.length === 0 ||
    !isTimestamp(value.alertRecordedAt) ||
    (value.alertSchemaVersion !== 1 && value.alertSchemaVersion !== 2)
  ) {
    throw new Error('Invalid alignment evaluation alert identity');
  }

  if (value.alertSchemaVersion === 2) {
    if (
      typeof value.sourceSessionId !== 'string' ||
      !isValidRuntimeSessionId(value.sourceSessionId) ||
      !Number.isSafeInteger(value.alertSequence) ||
      (value.alertSequence as number) <= 0 ||
      !isSha256(value.semanticFingerprint) ||
      value.alertId !==
        `correlated-alert:${value.sourceSessionId}:${value.alertSequence}`
    ) {
      throw new Error('Invalid alignment evaluation alert identity');
    }
  } else if (
    value.sourceSessionId !== null ||
    value.alertSequence !== null ||
    value.semanticFingerprint !== null
  ) {
    throw new Error('Invalid legacy alignment evaluation identity');
  }

  return value as unknown as AlertAlignmentEvaluationRecord['alertIdentity'];
};

const validateAlertContext = (value: unknown, legacy: boolean): void => {
  if (
    !isRecord(value) ||
    !EVENTS.has(String(value.eventType)) ||
    !BIASES.has(String(value.bias)) ||
    !RELATIONSHIPS.has(String(value.relationship)) ||
    !SEVERITIES.has(String(value.severity)) ||
    !isFiniteNumber(value.combinedConfidence) ||
    !isFiniteNumber(value.alertImportance) ||
    !isFiniteNumber(value.okxConfidence) ||
    !isFiniteNumber(value.externalEffectiveConfidence)
  ) {
    throw new Error('Invalid alignment evaluation alert context');
  }
  if (
    legacy
      ? value.okxBias !== null || value.externalBias !== null
      : !BIASES.has(String(value.okxBias)) ||
        !BIASES.has(String(value.externalBias))
  ) {
    throw new Error('Invalid alignment evaluation bias context');
  }
};

const validateProvenance = (
  value: unknown,
  legacy: boolean,
): AlertAlignmentEvaluationRecord['provenance'] => {
  if (
    !isRecord(value) ||
    !['LIVE', 'REPLAY', 'SIMULATION', 'LEGACY_UNVERIFIED'].includes(
      String(value.alertProvenance),
    ) ||
    !['VERSIONED_V1', 'LEGACY_UNVERSIONED', 'INVALID'].includes(
      String(value.marketRecordingFormat),
    ) ||
    !['CLEAN', 'TRUNCATED', 'LEGACY_UNVERIFIED', 'INVALID'].includes(
      String(value.recordingTermination),
    ) ||
    value.evaluatorVersion !== ALIGNMENT_EVALUATOR_VERSION
  ) {
    throw new Error('Invalid alignment evaluation provenance');
  }
  for (const field of ['recordingStartedAt', 'recordingEndedAt'] as const) {
    if (value[field] !== null && !isTimestamp(value[field])) {
      throw new Error('Invalid alignment evaluation provenance timestamp');
    }
  }
  for (const field of ['marketSourceSessionId', 'recordingId'] as const) {
    if (value[field] !== null && typeof value[field] !== 'string') {
      throw new Error('Invalid alignment evaluation provenance identity');
    }
  }
  if (
    (typeof value.marketSourceSessionId === 'string' &&
      !isValidRuntimeSessionId(value.marketSourceSessionId)) ||
    (typeof value.recordingId === 'string' &&
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.recordingId))
  ) {
    throw new Error('Invalid alignment evaluation provenance identity');
  }
  if (
    legacy &&
    value.marketRecordingFormat === 'LEGACY_UNVERSIONED' &&
    (value.marketSourceSessionId !== null || value.recordingId !== null)
  ) {
    throw new Error('Legacy recording linkage must remain unverified');
  }

  return value as unknown as AlertAlignmentEvaluationRecord['provenance'];
};

const validateAlignment = (
  value: unknown,
  record: AlertAlignmentEvaluationRecord,
  now: number,
): PersistedAlignmentResult => {
  if (
    !isRecord(value) ||
    value.alignmentSchemaVersion !== 1 ||
    value.evaluationConfigVersion !==
      `${record.configuration.version}:${record.configuration.fingerprint}` ||
    value.alertId !== record.alertIdentity.alertId ||
    !SOURCES.has(value.source as PriceSource) ||
    !Number.isSafeInteger(value.horizonMs) ||
    (value.horizonMs as number) <= 0 ||
    !COMPLETENESS.has(value.completeness as AlignmentCompleteness) ||
    (value.primaryReason !== null &&
      !REASONS.has(String(value.primaryReason))) ||
    !Array.isArray(value.reasons) ||
    !value.reasons.every((reason) => REASONS.has(String(reason))) ||
    !Array.isArray(value.validityGaps) ||
    typeof value.fallbackUsed !== 'boolean' ||
    (value.fallbackReason !== null &&
      value.fallbackReason !== 'REQUESTED_SOURCE_UNAVAILABLE')
  ) {
    throw new Error('Invalid persisted alignment result');
  }
  requireInstrument(value.instrument, record.instrument.instType === null);
  if (
    (value.instrument as Record<string, unknown>).instId !==
      record.instrument.instId ||
    (value.instrument as Record<string, unknown>).instType !==
      record.instrument.instType
  ) {
    throw new Error('Alignment result instrument mismatch');
  }
  if (
    value.sourceSessionId !== record.alertIdentity.sourceSessionId ||
    value.recordingId !== record.provenance.recordingId
  ) {
    throw new Error('Alignment result provenance mismatch');
  }
  const expectedTarget =
    record.reference === null
      ? null
      : record.reference.referenceTimestamp + (value.horizonMs as number);
  if (
    value.targetTimestamp !== null &&
    value.targetTimestamp !== expectedTarget
  ) {
    throw new Error('Invalid alignment target timestamp');
  }
  if (record.reference === null) {
    if (value.reference !== null) {
      throw new Error('Alignment result reference mismatch');
    }
  } else if (
    !isRecord(value.reference) ||
    value.reference.provenance !== 'CAPTURED_ALERT_CONTEXT' ||
    value.reference.referenceTimestamp !==
      record.reference.referenceTimestamp ||
    value.reference.midpoint !== record.reference.midpoint ||
    value.reference.bestBid !== record.reference.bestBid ||
    value.reference.bestAsk !== record.reference.bestAsk
  ) {
    throw new Error('Alignment result reference mismatch');
  }
  if (value.targetTimestamp !== null && !isTimestamp(value.targetTimestamp)) {
    throw new Error('Invalid alignment target timestamp');
  }
  if (
    value.observationDelayMs !== null &&
    !Number.isSafeInteger(value.observationDelayMs)
  ) {
    throw new Error('Invalid observation delay');
  }
  if (
    value.availabilityDelayMs !== null &&
    !Number.isSafeInteger(value.availabilityDelayMs)
  ) {
    throw new Error('Invalid availability delay');
  }
  if (
    value.selectedObservation !== null &&
    (record.instrument.instType === null ||
      !isRecord(value.selectedObservation) ||
      value.selectedObservation.source !== value.source ||
      value.selectedObservation.recordingId !== record.provenance.recordingId ||
      value.selectedObservation.sourceSessionId !==
        record.provenance.marketSourceSessionId ||
      !isRecord(value.selectedObservation.instrument) ||
      value.selectedObservation.instrument.instId !==
        record.instrument.instId ||
      value.selectedObservation.instrument.instType !==
        record.instrument.instType ||
      !validatePriceObservation(
        value.selectedObservation as never,
        toAlignmentConfiguration(record.configuration),
        now,
      ).valid)
  ) {
    throw new Error('Invalid source-specific observation');
  }
  let previousGap:
    | { startTimestamp: number; endTimestamp?: number; reason: string }
    | undefined;
  for (const gap of value.validityGaps) {
    if (
      !isRecord(gap) ||
      !isTimestamp(gap.startTimestamp) ||
      (gap.endTimestamp !== undefined &&
        (!isTimestamp(gap.endTimestamp) ||
          gap.endTimestamp < gap.startTimestamp)) ||
      ![
        AlignmentReason.SEQUENCE_GAP,
        AlignmentReason.BOOK_INVALID,
        AlignmentReason.RECORDING_TRUNCATED,
        AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
      ].includes(gap.reason as never)
    ) {
      throw new Error('Invalid or unordered alignment validity gap');
    }
    const current = gap as {
      startTimestamp: number;
      endTimestamp?: number;
      reason: string;
    };
    if (
      previousGap &&
      (previousGap.startTimestamp > current.startTimestamp ||
        (previousGap.startTimestamp === current.startTimestamp &&
          ((previousGap.endTimestamp ?? Number.MAX_SAFE_INTEGER) >
            (current.endTimestamp ?? Number.MAX_SAFE_INTEGER) ||
            ((previousGap.endTimestamp ?? Number.MAX_SAFE_INTEGER) ===
              (current.endTimestamp ?? Number.MAX_SAFE_INTEGER) &&
              previousGap.reason.localeCompare(current.reason) > 0))))
    ) {
      throw new Error('Invalid or unordered alignment validity gap');
    }
    previousGap = current;
  }
  const reasons = value.reasons as AlignmentReason[];
  const expectedReasons =
    value.primaryReason === null
      ? [...new Set(reasons)].sort()
      : [
          value.primaryReason as AlignmentReason,
          ...[...new Set(reasons)]
            .filter((reason) => reason !== value.primaryReason)
            .sort(),
        ];
  if (
    reasons.length !== expectedReasons.length ||
    reasons.some((reason, index) => reason !== expectedReasons[index])
  ) {
    throw new Error('Alignment reasons are duplicated or unordered');
  }
  if (
    !isResultConsistencyValid({
      completeness: value.completeness as AlignmentCompleteness,
      selectedObservation: value.selectedObservation,
      primaryReason: value.primaryReason as AlignmentReason | null,
      reasons: value.reasons as AlignmentReason[],
    })
  ) {
    throw new Error('Contradictory alignment completeness and reason fields');
  }

  return value as unknown as PersistedAlignmentResult;
};

const validateMatrix = (record: AlertAlignmentEvaluationRecord): void => {
  const expectedPairs: string[] = [];
  for (const horizonMs of record.configuration.horizonsMs) {
    for (const source of record.configuration.requestedSources) {
      expectedPairs.push(`${horizonMs}\u001f${source}`);
    }
  }
  const actualPairs = record.alignments.map(
    (result) => `${result.horizonMs}\u001f${result.source}`,
  );
  if (
    actualPairs.length !== expectedPairs.length ||
    actualPairs.some((pair, index) => pair !== expectedPairs[index]) ||
    new Set(actualPairs).size !== actualPairs.length
  ) {
    throw new Error('Alignment evaluation matrix is incomplete or unordered');
  }
};

export const parseAlertAlignmentEvaluationRecord = (
  line: string,
): AlertAlignmentEvaluationRecord => {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value)) {
    throw new Error('Invalid alert alignment evaluation record');
  }
  if (value.recordType !== ALERT_ALIGNMENT_EVALUATION_RECORD_TYPE) {
    throw new Error('Invalid alert alignment evaluation record type');
  }
  if (value.schemaVersion !== ALERT_ALIGNMENT_EVALUATION_SCHEMA_VERSION) {
    throw new Error('Unsupported alert alignment evaluation schema version');
  }
  if (
    !isTimestamp(value.recordedAt) ||
    typeof value.evaluationId !== 'string' ||
    !/^alert-alignment-evaluation:[a-f0-9]{64}$/.test(value.evaluationId) ||
    !isEvaluationRunId(value.evaluationRunId) ||
    !isRecord(value.configuration) ||
    !Array.isArray(value.alignments)
  ) {
    throw new Error('Invalid alert alignment evaluation identity');
  }

  const record = value as unknown as AlertAlignmentEvaluationRecord;
  const alertIdentity = validateAlertIdentity(record.alertIdentity);
  const legacy = alertIdentity.alertSchemaVersion === 1;
  requireInstrument(record.instrument, legacy);
  validateReference(record.reference);
  if (legacy ? record.reference !== null : record.reference === null) {
    throw new Error('Invalid alert reference availability');
  }
  validateAlertContext(record.alertContext, legacy);
  const provenance = validateProvenance(record.provenance, legacy);
  if (!verifyAlertAlignmentConfigurationFingerprint(record.configuration)) {
    throw new Error('Invalid alignment configuration fingerprint');
  }
  if (
    record.evaluationId !==
    createAlertAlignmentEvaluationId({
      alertIdentity,
      recordingId: provenance.recordingId,
      configurationFingerprint: record.configuration.fingerprint,
    })
  ) {
    throw new Error('Invalid deterministic evaluation ID');
  }

  const validated = record.alignments.map((alignment) =>
    validateAlignment(alignment, record, record.recordedAt),
  );
  record.alignments = validated;
  validateMatrix(record);

  return record;
};
