import { isValidRuntimeSessionId } from '../runtime/runtimeSession';
import type { MarketBias } from '../types/signal';
import {
  ALERT_TERMINAL_RETURN_RECORD_TYPE,
  ALERT_TERMINAL_RETURN_SCHEMA_VERSION,
  TERMINAL_RETURN_EVALUATOR_VERSION,
  TerminalReturnReason,
  createTerminalReturnOutcomeId,
  isOutcomeRunId,
  verifyTerminalReturnPolicyFingerprint,
  type AlertTerminalReturnRecord,
  type ExecutableDirectionalReturn,
  type TerminalReturnCell,
  type TerminalReturnPolicyV1,
} from './terminalReturn';
import {
  AlignmentReason,
  type AlignmentCompleteness,
  type PriceSource,
} from './alignmentTypes';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number =>
  finite(value) && value > 0;
const timestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const nullableFinite = (value: unknown): boolean =>
  value === null || finite(value);
const nullableTimestamp = (value: unknown): boolean =>
  value === null || timestamp(value);

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
const ALIGNMENT_REASONS = new Set<string>(Object.values(AlignmentReason));
const RETURN_REASONS = new Set<string>(Object.values(TerminalReturnReason));
const BIASES = new Set(['BULLISH', 'BEARISH', 'NEUTRAL']);
const RELATIONSHIPS = new Set([
  'AGREEMENT',
  'CONTRADICTION',
  'EXTERNAL_ONLY',
  'OKX_ONLY',
  'NEUTRAL',
]);
const EVENTS = new Set([
  'NEW_SIGNAL',
  'CONFIDENCE_INCREASED',
  'DIRECTION_CHANGED',
  'AGREEMENT',
  'CONTRADICTION',
]);
const SEVERITIES = new Set(['INFO', 'WATCH', 'STRONG', 'CRITICAL']);

const approximatelyEqual = (
  left: number,
  right: number,
  policy: TerminalReturnPolicyV1,
): boolean => {
  const magnitude = Math.max(Math.abs(left), Math.abs(right));
  return (
    Math.abs(left - right) <=
    policy.floatingPointPolicy.absoluteTolerance +
      policy.floatingPointPolicy.relativeTolerance * magnitude
  );
};

const validateAlertIdentity = (
  value: unknown,
): AlertTerminalReturnRecord['alertIdentity'] => {
  if (
    !isRecord(value) ||
    typeof value.alertId !== 'string' ||
    !timestamp(value.alertRecordedAt) ||
    (value.alertSchemaVersion !== 1 && value.alertSchemaVersion !== 2)
  ) {
    throw new Error('Invalid terminal-return alert identity');
  }
  if (
    value.alertSchemaVersion === 2 &&
    (typeof value.sourceSessionId !== 'string' ||
      !isValidRuntimeSessionId(value.sourceSessionId) ||
      !Number.isSafeInteger(value.alertSequence) ||
      (value.alertSequence as number) <= 0 ||
      typeof value.semanticFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.semanticFingerprint) ||
      value.alertId !==
        `correlated-alert:${value.sourceSessionId}:${value.alertSequence}`)
  ) {
    throw new Error('Invalid terminal-return durable alert identity');
  }
  if (
    value.alertSchemaVersion === 1 &&
    (value.sourceSessionId !== null ||
      value.alertSequence !== null ||
      value.semanticFingerprint !== null)
  ) {
    throw new Error('Invalid terminal-return legacy alert identity');
  }
  return value as unknown as AlertTerminalReturnRecord['alertIdentity'];
};

const validateInstrumentAndContext = (
  record: AlertTerminalReturnRecord,
): void => {
  if (
    !isRecord(record.instrument) ||
    typeof record.instrument.instId !== 'string' ||
    !/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(record.instrument.instId) ||
    (record.instrument.instType !== null &&
      record.instrument.instType !== 'SPOT' &&
      record.instrument.instType !== 'SWAP') ||
    !isRecord(record.alertContext) ||
    !EVENTS.has(String(record.alertContext.eventType)) ||
    !BIASES.has(String(record.alertContext.bias)) ||
    (record.alertContext.okxBias !== null &&
      !BIASES.has(String(record.alertContext.okxBias))) ||
    (record.alertContext.externalBias !== null &&
      !BIASES.has(String(record.alertContext.externalBias))) ||
    !RELATIONSHIPS.has(String(record.alertContext.relationship)) ||
    !SEVERITIES.has(String(record.alertContext.severity)) ||
    !finite(record.alertContext.combinedConfidence) ||
    !finite(record.alertContext.alertImportance) ||
    !finite(record.alertContext.okxConfidence) ||
    !finite(record.alertContext.externalEffectiveConfidence)
  ) {
    throw new Error('Invalid terminal-return instrument or alert context');
  }
  const reference = record.reference;
  if (record.alertIdentity.alertSchemaVersion === 1) {
    if (reference !== null) {
      throw new Error('Legacy terminal-return reference must be absent');
    }
  } else if (
    !isRecord(reference) ||
    reference.provenance !== 'CAPTURED_ALERT_CONTEXT' ||
    !timestamp(reference.referenceTimestamp) ||
    !timestamp(reference.sourceMarketTimestamp) ||
    !timestamp(reference.sourceSignalTimestamp) ||
    !positive(reference.midpoint) ||
    !positive(reference.bestBid) ||
    !positive(reference.bestAsk) ||
    reference.bestAsk < reference.bestBid ||
    !finite(reference.spread) ||
    reference.spread < 0 ||
    !finite(reference.spreadPercent) ||
    reference.spreadPercent < 0
  ) {
    throw new Error('Invalid terminal-return reference');
  }
};

const validateProvenance = (record: AlertTerminalReturnRecord): void => {
  const provenance = record.provenance;
  if (
    !isRecord(provenance) ||
    provenance.sourceEvaluationSchemaVersion !== 1 ||
    !isOutcomeRunId(provenance.sourceEvaluationRunId) ||
    provenance.sourceAlignmentEvaluatorVersion !== 'alignment-evaluator-v1' ||
    typeof provenance.sourceAlignmentConfigurationFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(
      provenance.sourceAlignmentConfigurationFingerprint,
    ) ||
    !Array.isArray(provenance.horizonsMs) ||
    provenance.horizonsMs.length === 0 ||
    !provenance.horizonsMs.every(
      (horizon) => Number.isSafeInteger(horizon) && horizon > 0,
    ) ||
    new Set(provenance.horizonsMs).size !== provenance.horizonsMs.length ||
    !Array.isArray(provenance.requestedSources) ||
    provenance.requestedSources.length === 0 ||
    !provenance.requestedSources.every((source) =>
      SOURCES.has(source as PriceSource),
    ) ||
    new Set(provenance.requestedSources).size !==
      provenance.requestedSources.length ||
    !['LIVE', 'REPLAY', 'SIMULATION', 'LEGACY_UNVERIFIED'].includes(
      String(provenance.alertProvenance),
    ) ||
    !['VERSIONED_V1', 'LEGACY_UNVERSIONED', 'INVALID'].includes(
      String(provenance.marketRecordingFormat),
    ) ||
    !['CLEAN', 'TRUNCATED', 'LEGACY_UNVERIFIED', 'INVALID'].includes(
      String(provenance.recordingTermination),
    ) ||
    (provenance.marketSourceSessionId !== null &&
      (typeof provenance.marketSourceSessionId !== 'string' ||
        !isValidRuntimeSessionId(provenance.marketSourceSessionId))) ||
    (provenance.recordingId !== null &&
      (typeof provenance.recordingId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(provenance.recordingId)))
  ) {
    throw new Error('Invalid terminal-return provenance');
  }
};

const validateReferenceArithmetic = (
  record: AlertTerminalReturnRecord,
): void => {
  const reference = record.reference;
  if (!reference) {
    return;
  }
  const midpoint = (reference.bestBid + reference.bestAsk) / 2;
  const spread = reference.bestAsk - reference.bestBid;
  const spreadPercent = (spread / midpoint) * 100;
  if (
    !approximatelyEqual(reference.midpoint, midpoint, record.returnPolicy) ||
    !approximatelyEqual(reference.spread, spread, record.returnPolicy) ||
    !approximatelyEqual(
      reference.spreadPercent,
      spreadPercent,
      record.returnPolicy,
    )
  ) {
    throw new Error('Inconsistent terminal-return reference arithmetic');
  }
};

const validateExecutable = (
  value: unknown,
  expectedBias: MarketBias | null,
  policy: TerminalReturnPolicyV1,
): void => {
  if (expectedBias === null || expectedBias === 'NEUTRAL') {
    if (value !== null) {
      throw new Error('Neutral or missing bias cannot have executable return');
    }
    return;
  }
  if (
    !isRecord(value) ||
    value.bias !== expectedBias ||
    !positive(value.entryPrice) ||
    !positive(value.exitPrice) ||
    !finite(value.rawReturn) ||
    !finite(value.rawReturnPercent) ||
    !finite(value.directionalReturn) ||
    !finite(value.directionalReturnPercent)
  ) {
    throw new Error('Invalid executable terminal return');
  }
  const executable = value as unknown as ExecutableDirectionalReturn;
  const expected =
    executable.bias === 'BULLISH'
      ? executable.exitPrice - executable.entryPrice
      : executable.entryPrice - executable.exitPrice;
  if (
    !approximatelyEqual(executable.rawReturn, expected, policy) ||
    !approximatelyEqual(
      executable.rawReturnPercent,
      (expected / executable.entryPrice) * 100,
      policy,
    ) ||
    executable.directionalReturn !== executable.rawReturn ||
    executable.directionalReturnPercent !== executable.rawReturnPercent
  ) {
    throw new Error('Inconsistent executable terminal return');
  }
};

const expectedDirectional = (
  bias: MarketBias | null,
  referencePrice: number,
  terminalPrice: number,
): number | null =>
  bias === 'BULLISH'
    ? terminalPrice - referencePrice
    : bias === 'BEARISH'
      ? referencePrice - terminalPrice
      : null;

const validateEligibleCell = (
  cell: TerminalReturnCell,
  record: AlertTerminalReturnRecord,
): void => {
  const policy = record.returnPolicy;
  if (
    cell.alignmentCompleteness !== 'COMPLETE' ||
    !positive(cell.referencePrice) ||
    !positive(cell.terminalPrice) ||
    !finite(cell.rawReturn) ||
    !finite(cell.rawReturnPercent) ||
    !timestamp(cell.observationTimestamp) ||
    !timestamp(cell.availabilityTimestamp)
  ) {
    throw new Error('Eligible terminal-return cell is incomplete');
  }
  const expectedRaw = cell.terminalPrice - cell.referencePrice;
  if (
    !approximatelyEqual(cell.rawReturn, expectedRaw, policy) ||
    !approximatelyEqual(
      cell.rawReturnPercent,
      (expectedRaw / cell.referencePrice) * 100,
      policy,
    )
  ) {
    throw new Error('Inconsistent raw terminal return');
  }
  const directionalFields = [
    {
      bias: record.alertContext.okxBias,
      value: cell.okxDirectionalReturn,
      percent: cell.okxDirectionalReturnPercent,
    },
    {
      bias: record.alertContext.externalBias,
      value: cell.externalDirectionalReturn,
      percent: cell.externalDirectionalReturnPercent,
    },
  ];
  for (const directional of directionalFields) {
    const expected = expectedDirectional(
      directional.bias,
      cell.referencePrice,
      cell.terminalPrice,
    );
    if (expected === null) {
      if (directional.value !== null || directional.percent !== null) {
        throw new Error('Neutral directional return must be absent');
      }
    } else if (
      !finite(directional.value) ||
      !finite(directional.percent) ||
      !approximatelyEqual(directional.value, expected, policy) ||
      !approximatelyEqual(
        directional.percent,
        (expected / cell.referencePrice) * 100,
        policy,
      )
    ) {
      throw new Error('Inconsistent directional terminal return');
    }
  }

  if (cell.source === 'ORDER_BOOK_BID_ASK') {
    validateExecutable(cell.okxExecutable, record.alertContext.okxBias, policy);
    validateExecutable(
      cell.externalExecutable,
      record.alertContext.externalBias,
      policy,
    );
  } else if (cell.okxExecutable !== null || cell.externalExecutable !== null) {
    throw new Error('Non-book source cannot have executable returns');
  }
};

const validateCell = (
  value: unknown,
  record: AlertTerminalReturnRecord,
): TerminalReturnCell => {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.horizonMs) ||
    (value.horizonMs as number) <= 0 ||
    !SOURCES.has(value.source as PriceSource) ||
    !COMPLETENESS.has(value.alignmentCompleteness as AlignmentCompleteness) ||
    !['ELIGIBLE', 'INELIGIBLE', 'AMBIGUOUS'].includes(
      String(value.eligibility),
    ) ||
    !Array.isArray(value.sourceAlignmentReasons) ||
    !value.sourceAlignmentReasons.every((reason) =>
      ALIGNMENT_REASONS.has(String(reason)),
    ) ||
    new Set(value.sourceAlignmentReasons).size !==
      value.sourceAlignmentReasons.length ||
    !Array.isArray(value.reasons) ||
    !value.reasons.every((reason) => RETURN_REASONS.has(String(reason))) ||
    new Set(value.reasons).size !== value.reasons.length ||
    !nullableFinite(value.referencePrice) ||
    !nullableFinite(value.terminalPrice) ||
    !nullableFinite(value.rawReturn) ||
    !nullableFinite(value.rawReturnPercent) ||
    !nullableFinite(value.okxDirectionalReturn) ||
    !nullableFinite(value.okxDirectionalReturnPercent) ||
    !nullableFinite(value.externalDirectionalReturn) ||
    !nullableFinite(value.externalDirectionalReturnPercent) ||
    !nullableTimestamp(value.observationTimestamp) ||
    !nullableTimestamp(value.availabilityTimestamp)
  ) {
    throw new Error('Invalid terminal-return cell');
  }
  const cell = value as unknown as TerminalReturnCell;
  const sortedReasons = [...cell.reasons].sort();
  if (cell.reasons.some((reason, index) => reason !== sortedReasons[index])) {
    throw new Error('Terminal-return reasons are unordered');
  }
  const expectedEligibility =
    cell.alignmentCompleteness === 'COMPLETE'
      ? 'ELIGIBLE'
      : cell.alignmentCompleteness === 'AMBIGUOUS'
        ? 'AMBIGUOUS'
        : 'INELIGIBLE';
  if (cell.eligibility !== expectedEligibility) {
    throw new Error('Terminal-return eligibility contradicts alignment');
  }
  const expectedBasis =
    cell.source === 'CONFIRMED_CANDLE_CLOSE'
      ? 'CAPTURED_MIDPOINT_TO_TERMINAL_CANDLE_CLOSE'
      : 'CAPTURED_MIDPOINT_TO_TERMINAL_MIDPOINT';
  if (cell.eligibility === 'ELIGIBLE') {
    if (cell.rawPriceBasis !== expectedBasis) {
      throw new Error('Invalid terminal-return raw price basis');
    }
    validateEligibleCell(cell, record);
  } else {
    if (cell.rawPriceBasis !== null) {
      throw new Error('Ineligible terminal-return cell has a price basis');
    }
    for (const metric of [
      cell.referencePrice,
      cell.terminalPrice,
      cell.rawReturn,
      cell.rawReturnPercent,
      cell.okxDirectionalReturn,
      cell.okxDirectionalReturnPercent,
      cell.externalDirectionalReturn,
      cell.externalDirectionalReturnPercent,
      cell.okxExecutable,
      cell.externalExecutable,
      cell.observationTimestamp,
      cell.availabilityTimestamp,
    ]) {
      if (metric !== null) {
        throw new Error('Ineligible terminal-return cell contains metrics');
      }
    }
    if (!cell.reasons.includes(TerminalReturnReason.POLICY_INELIGIBLE)) {
      throw new Error('Ineligible terminal-return cell lacks policy reason');
    }
  }
  return cell;
};

const validateMatrix = (record: AlertTerminalReturnRecord): void => {
  const expected: string[] = [];
  for (const horizon of record.provenance.horizonsMs) {
    for (const source of record.provenance.requestedSources) {
      expected.push(`${horizon}\u001f${source}`);
    }
  }
  const actual = record.returns.map(
    (cell) => `${cell.horizonMs}\u001f${cell.source}`,
  );
  if (
    actual.length !== expected.length ||
    actual.some((pair, index) => pair !== expected[index]) ||
    new Set(actual).size !== actual.length
  ) {
    throw new Error('Terminal-return matrix is incomplete or unordered');
  }
};

export const parseAlertTerminalReturnRecord = (
  line: string,
): AlertTerminalReturnRecord => {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value)) {
    throw new Error('Invalid terminal-return record');
  }
  if (value.recordType !== ALERT_TERMINAL_RETURN_RECORD_TYPE) {
    throw new Error('Invalid terminal-return record type');
  }
  if (value.schemaVersion !== ALERT_TERMINAL_RETURN_SCHEMA_VERSION) {
    throw new Error('Unsupported terminal-return schema version');
  }
  if (
    !timestamp(value.recordedAt) ||
    typeof value.outcomeId !== 'string' ||
    !/^alert-terminal-return:[a-f0-9]{64}$/.test(value.outcomeId) ||
    !isOutcomeRunId(value.outcomeRunId) ||
    typeof value.sourceEvaluationId !== 'string' ||
    !/^alert-alignment-evaluation:[a-f0-9]{64}$/.test(
      value.sourceEvaluationId,
    ) ||
    value.evaluatorVersion !== TERMINAL_RETURN_EVALUATOR_VERSION ||
    !isRecord(value.returnPolicy) ||
    !Array.isArray(value.returns)
  ) {
    throw new Error('Invalid terminal-return identity');
  }
  const record = value as unknown as AlertTerminalReturnRecord;
  validateAlertIdentity(record.alertIdentity);
  validateInstrumentAndContext(record);
  validateProvenance(record);
  if (!verifyTerminalReturnPolicyFingerprint(record.returnPolicy)) {
    throw new Error('Invalid terminal-return policy fingerprint');
  }
  validateReferenceArithmetic(record);
  if (
    record.outcomeId !==
    createTerminalReturnOutcomeId({
      sourceEvaluationId: record.sourceEvaluationId,
      policyFingerprint: record.returnPolicy.fingerprint,
    })
  ) {
    throw new Error('Invalid deterministic outcome ID');
  }
  record.returns = record.returns.map((cell) => validateCell(cell, record));
  validateMatrix(record);
  return record;
};
