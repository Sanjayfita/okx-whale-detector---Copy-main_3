import { isSha256 } from './alertAlignmentEvaluation';
import { AlignmentReason, type PriceSource } from './alignmentTypes';
import { PathOutcomeReason } from './pathOutcome';
import { TerminalReturnReason } from './terminalReturn';
import {
  ALERT_TARGET_STOP_OUTCOME_RECORD_TYPE,
  ALERT_TARGET_STOP_OUTCOME_SCHEMA_VERSION,
  TARGET_STOP_EVALUATOR_VERSION,
  TargetStopReason,
  createTargetStopOutcomeId,
  isTargetStopRunId,
  verifyTargetStopPolicyFingerprint,
  type AlertTargetStopOutcomeRecord,
  type DirectionalTargetStopResult,
  type TargetStopCell,
} from './targetStopOutcome';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number =>
  finite(value) && value > 0;
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableTimestamp = (value: unknown): boolean =>
  value === null || timestamp(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const SOURCES = new Set<PriceSource>([
  'ORDER_BOOK_MIDPOINT',
  'ORDER_BOOK_BID_ASK',
  'CONFIRMED_CANDLE_CLOSE',
]);
const COMPLETENESS = new Set([
  'COMPLETE',
  'PARTIAL',
  'MISSING',
  'AMBIGUOUS',
  'INVALID',
]);
const ELIGIBILITY = new Set(['ELIGIBLE', 'INELIGIBLE', 'AMBIGUOUS']);
const RESULTS = new Set([
  'TARGET_FIRST',
  'STOP_FIRST',
  'NEITHER',
  'TIE',
  'AMBIGUOUS',
  'INELIGIBLE',
]);
const ALIGNMENT_REASONS = new Set<string>(Object.values(AlignmentReason));
const TERMINAL_REASONS = new Set<string>(Object.values(TerminalReturnReason));
const PATH_REASONS = new Set<string>(Object.values(PathOutcomeReason));
const TARGET_STOP_REASONS = new Set<string>(Object.values(TargetStopReason));

const validateResult = (
  value: unknown,
  cell: TargetStopCell,
  referenceTimestamp: number,
  expectedPrecision: 'EXACT_ORDER_BOOK' | 'COARSE_CANDLE',
): void => {
  assert(isObject(value), 'Directional target/stop result must be an object');
  const result = value as unknown as DirectionalTargetStopResult;
  assert(
    result.bias === 'BULLISH' || result.bias === 'BEARISH',
    'Directional result bias is invalid',
  );
  assert(
    positive(result.baselinePrice) &&
      positive(result.targetPrice) &&
      positive(result.stopPrice),
    'Target/stop prices must be positive',
  );
  assert(RESULTS.has(result.result), 'Target/stop result is invalid');
  assert(
    result.orderingPrecision === expectedPrecision,
    'Target/stop ordering precision does not match its source',
  );
  for (const candidate of [
    result.targetHitTimestamp,
    result.stopHitTimestamp,
    result.firstHitTimestamp,
    result.firstHitAvailabilityTimestamp,
    result.timeToTargetMs,
    result.timeToStopMs,
    result.timeToFirstHitMs,
    result.firstHitCandleStart,
  ]) {
    assert(nullableTimestamp(candidate), 'Target/stop timestamp is invalid');
  }
  assert(
    result.firstHitRecordOrdinal === null ||
      (Number.isSafeInteger(result.firstHitRecordOrdinal) &&
        result.firstHitRecordOrdinal >= 0),
    'First-hit ordinal is invalid',
  );
  assert(
    result.firstHitPrice === null || positive(result.firstHitPrice),
    'First-hit price is invalid',
  );
  for (const hit of [
    result.targetHitTimestamp,
    result.stopHitTimestamp,
    result.firstHitTimestamp,
  ]) {
    assert(
      hit === null ||
        (hit >= referenceTimestamp &&
          hit <= referenceTimestamp + cell.horizonMs),
      'Hit timestamp must be inside the horizon',
    );
  }
  for (const elapsed of [
    result.timeToTargetMs,
    result.timeToStopMs,
    result.timeToFirstHitMs,
  ]) {
    assert(
      elapsed === null || elapsed <= cell.horizonMs,
      'Time-to-hit must be within the horizon',
    );
  }
  if (result.result === 'NEITHER') {
    assert(
      result.targetHitTimestamp === null &&
        result.stopHitTimestamp === null &&
        result.firstHitTimestamp === null,
      'NEITHER cannot contain hit fields',
    );
  } else if (result.result === 'AMBIGUOUS') {
    assert(
      expectedPrecision === 'COARSE_CANDLE' &&
        result.firstHitTimestamp === null &&
        result.firstHitPrice === null &&
        result.timeToFirstHitMs === null,
      'Ambiguous candle result cannot claim an exact first hit',
    );
  } else {
    assert(
      result.firstHitTimestamp !== null &&
        result.firstHitAvailabilityTimestamp !== null &&
        result.firstHitRecordOrdinal !== null &&
        result.firstHitPrice !== null &&
        result.timeToFirstHitMs ===
          result.firstHitTimestamp - referenceTimestamp,
      'First-hit result fields are inconsistent',
    );
  }
};

const validateCell = (
  value: unknown,
  referenceTimestamp: number,
): TargetStopCell => {
  assert(isObject(value), 'Target/stop cell must be an object');
  const cell = value as unknown as TargetStopCell;
  assert(
    Number.isSafeInteger(cell.horizonMs) && cell.horizonMs > 0,
    'Target/stop horizon is invalid',
  );
  assert(
    SOURCES.has(cell.source) &&
      COMPLETENESS.has(cell.alignmentCompleteness) &&
      ELIGIBILITY.has(cell.eligibility),
    'Target/stop cell source or eligibility is invalid',
  );
  assert(
    positive(cell.targetPercent) && positive(cell.stopPercent),
    'Target/stop percentages must be positive',
  );
  assert(
    Array.isArray(cell.sourceAlignmentReasons) &&
      cell.sourceAlignmentReasons.every((reason) =>
        ALIGNMENT_REASONS.has(reason),
      ) &&
      Array.isArray(cell.sourceTerminalReturnReasons) &&
      cell.sourceTerminalReturnReasons.every((reason) =>
        TERMINAL_REASONS.has(reason),
      ) &&
      Array.isArray(cell.sourcePathOutcomeReasons) &&
      cell.sourcePathOutcomeReasons.every((reason) => PATH_REASONS.has(reason)),
    'Preserved source reasons are invalid',
  );
  assert(
    Array.isArray(cell.reasons) &&
      cell.reasons.every((reason) => TARGET_STOP_REASONS.has(reason)) &&
      new Set(cell.reasons).size === cell.reasons.length,
    'Target/stop reasons are invalid or duplicated',
  );
  assert(Array.isArray(cell.validityGaps), 'Validity gaps must be an array');
  const exact = cell.source !== 'CONFIRMED_CANDLE_CLOSE';
  for (const result of [cell.okx, cell.external]) {
    if (result) {
      validateResult(result, cell, referenceTimestamp, 'EXACT_ORDER_BOOK');
      assert(
        cell.source === 'ORDER_BOOK_MIDPOINT',
        'Midpoint results require midpoint source',
      );
    }
  }
  for (const result of [cell.executableOkx, cell.executableExternal]) {
    if (result) {
      validateResult(result, cell, referenceTimestamp, 'EXACT_ORDER_BOOK');
      assert(
        cell.source === 'ORDER_BOOK_BID_ASK',
        'Executable results require bid/ask source',
      );
    }
  }
  for (const result of [cell.candleOkx, cell.candleExternal]) {
    if (result) {
      validateResult(result, cell, referenceTimestamp, 'COARSE_CANDLE');
      assert(
        cell.source === 'CONFIRMED_CANDLE_CLOSE',
        'Candle results require candle source',
      );
    }
  }
  if (cell.eligibility === 'INELIGIBLE') {
    assert(
      cell.reasons.includes(TargetStopReason.POLICY_INELIGIBLE) &&
        [
          cell.okx,
          cell.external,
          cell.executableOkx,
          cell.executableExternal,
          cell.candleOkx,
          cell.candleExternal,
        ].every((result) => result === null),
      'Ineligible target/stop cells cannot contain trusted results',
    );
  } else {
    assert(
      cell.alignmentCompleteness === 'COMPLETE' &&
        !cell.reasons.includes(TargetStopReason.POLICY_INELIGIBLE),
      'Eligible target/stop cells require complete trusted paths',
    );
    if (exact) {
      assert(
        cell.validityGaps.length === 0,
        'Exact target/stop results cannot cross gaps',
      );
    }
  }
  return cell;
};

export const parseAlertTargetStopOutcomeRecord = (
  line: string,
): AlertTargetStopOutcomeRecord => {
  const value: unknown = JSON.parse(line);
  assert(isObject(value), 'Target/stop record must be an object');
  const record = value as unknown as AlertTargetStopOutcomeRecord;
  assert(
    record.recordType === ALERT_TARGET_STOP_OUTCOME_RECORD_TYPE,
    'Invalid target/stop record type',
  );
  assert(
    record.schemaVersion === ALERT_TARGET_STOP_OUTCOME_SCHEMA_VERSION,
    'Unsupported target/stop schema version',
  );
  assert(
    timestamp(record.recordedAt),
    'recordedAt must be UTC epoch milliseconds',
  );
  assert(
    identifier(record.targetStopOutcomeId) &&
      record.targetStopOutcomeId.startsWith('alert-target-stop-outcome:'),
    'Invalid targetStopOutcomeId',
  );
  assert(isTargetStopRunId(record.targetStopRunId), 'Invalid targetStopRunId');
  assert(
    identifier(record.sourceEvaluationId) &&
      identifier(record.sourceTerminalReturnId) &&
      identifier(record.sourcePathOutcomeId),
    'Invalid target/stop source IDs',
  );
  assert(
    record.evaluatorVersion === TARGET_STOP_EVALUATOR_VERSION,
    'Unsupported target/stop evaluator version',
  );
  assert(
    isObject(record.policy) &&
      isSha256(record.policy.fingerprint) &&
      verifyTargetStopPolicyFingerprint(record.policy),
    'Invalid target/stop policy fingerprint',
  );
  assert(
    isObject(record.reference) &&
      timestamp(record.reference.referenceTimestamp) &&
      positive(record.reference.midpoint) &&
      positive(record.reference.bestBid) &&
      positive(record.reference.bestAsk) &&
      record.reference.bestAsk >= record.reference.bestBid,
    'Invalid target/stop reference',
  );
  assert(
    isObject(record.alertIdentity) &&
      identifier(record.alertIdentity.alertId) &&
      isObject(record.instrument) &&
      typeof record.instrument.instId === 'string' &&
      (record.instrument.instType === 'SPOT' ||
        record.instrument.instType === 'SWAP') &&
      isObject(record.alertContext) &&
      isObject(record.provenance),
    'Invalid target/stop copied context',
  );
  assert(
    Array.isArray(record.provenance.horizonsMs) &&
      Array.isArray(record.provenance.requestedSources) &&
      record.provenance.horizonsMs.every(
        (horizon) => Number.isSafeInteger(horizon) && horizon > 0,
      ) &&
      record.provenance.requestedSources.every((source) => SOURCES.has(source)),
    'Invalid target/stop provenance',
  );
  assert(Array.isArray(record.outcomes), 'Target/stop matrix must be an array');
  const outcomes = record.outcomes.map((cell) =>
    validateCell(cell, record.reference.referenceTimestamp),
  );
  const keys = outcomes.map((cell) => `${cell.horizonMs}\u001f${cell.source}`);
  const expected = record.provenance.horizonsMs.flatMap((horizon) =>
    record.provenance.requestedSources.map(
      (source) => `${horizon}\u001f${source}`,
    ),
  );
  assert(
    keys.length === expected.length &&
      new Set(keys).size === keys.length &&
      keys.every((key, index) => key === expected[index]),
    'Target/stop matrix must be complete, unique, and ordered',
  );
  assert(
    outcomes.every(
      (cell) =>
        cell.targetPercent === record.policy.targetPercent &&
        cell.stopPercent === record.policy.stopPercent,
    ),
    'Target/stop cells must match the policy percentages',
  );
  assert(
    record.targetStopOutcomeId ===
      createTargetStopOutcomeId({
        sourceEvaluationId: record.sourceEvaluationId,
        sourceTerminalReturnId: record.sourceTerminalReturnId,
        sourcePathOutcomeId: record.sourcePathOutcomeId,
        policyFingerprint: record.policy.fingerprint,
      }),
    'targetStopOutcomeId does not match immutable inputs',
  );
  return record;
};
