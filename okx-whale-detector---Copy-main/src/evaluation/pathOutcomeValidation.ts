import { isSha256 } from './alertAlignmentEvaluation';
import { AlignmentReason, type PriceSource } from './alignmentTypes';
import {
  ALERT_PATH_OUTCOME_RECORD_TYPE,
  ALERT_PATH_OUTCOME_SCHEMA_VERSION,
  PATH_OUTCOME_EVALUATOR_VERSION,
  PathOutcomeReason,
  createPathOutcomeId,
  isPathOutcomeRunId,
  verifyPathOutcomePolicyFingerprint,
  type AlertPathOutcomeRecord,
  type CandlePathBounds,
  type PathExcursionOutcome,
  type PathOutcomeCell,
} from './pathOutcome';
import { TerminalReturnReason } from './terminalReturn';

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
const ALIGNMENT_REASONS = new Set<string>(Object.values(AlignmentReason));
const TERMINAL_REASONS = new Set<string>(Object.values(TerminalReturnReason));
const PATH_REASONS = new Set<string>(Object.values(PathOutcomeReason));
const BIASES = new Set(['BULLISH', 'BEARISH', 'NEUTRAL']);
const RELATIONSHIPS = new Set([
  'AGREEMENT',
  'CONTRADICTION',
  'EXTERNAL_ONLY',
  'OKX_ONLY',
  'NEUTRAL',
]);
const EVENTS = new Set([
  'AGREEMENT',
  'CONTRADICTION',
  'EXTERNAL_ONLY',
  'OKX_ONLY',
]);
const SEVERITIES = new Set(['INFO', 'WATCH', 'STRONG', 'CRITICAL']);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const validateExcursion = (
  value: unknown,
  cell: PathOutcomeCell,
  label: string,
): void => {
  assert(isObject(value), `${label} must be an object`);
  const metric = value as unknown as PathExcursionOutcome;
  assert(
    finite(metric.favorableExcursion) && metric.favorableExcursion >= 0,
    `${label} favorable excursion must be non-negative`,
  );
  assert(
    finite(metric.adverseExcursion) && metric.adverseExcursion >= 0,
    `${label} adverse excursion must be non-negative`,
  );
  assert(
    finite(metric.favorableExcursionPercent) &&
      metric.favorableExcursionPercent >= 0 &&
      finite(metric.adverseExcursionPercent) &&
      metric.adverseExcursionPercent >= 0,
    `${label} percentages must be non-negative and finite`,
  );
  assert(
    positive(metric.favorablePrice) && positive(metric.adversePrice),
    `${label} prices must be positive`,
  );
  assert(
    timestamp(metric.favorableTimestamp) &&
      timestamp(metric.adverseTimestamp) &&
      timestamp(metric.timeToFavorableMs) &&
      timestamp(metric.timeToAdverseMs),
    `${label} timestamps and time-to-extrema must be non-negative`,
  );
  assert(
    cell.pathStartTimestamp !== null &&
      cell.pathEndTimestamp !== null &&
      metric.favorableTimestamp >= cell.pathStartTimestamp &&
      metric.favorableTimestamp <= cell.pathEndTimestamp &&
      metric.adverseTimestamp >= cell.pathStartTimestamp &&
      metric.adverseTimestamp <= cell.pathEndTimestamp &&
      metric.timeToFavorableMs <= cell.horizonMs &&
      metric.timeToAdverseMs <= cell.horizonMs &&
      metric.timeToFavorableMs ===
        metric.favorableTimestamp - cell.pathStartTimestamp &&
      metric.timeToAdverseMs ===
        metric.adverseTimestamp - cell.pathStartTimestamp,
    `${label} extrema must be inside the path window`,
  );
};

const validateCandleBound = (
  value: unknown,
  cell: PathOutcomeCell,
  label: string,
): void => {
  assert(isObject(value), `${label} must be an object`);
  const bound = value as unknown as CandlePathBounds;
  assert(
    bound.bias === 'BULLISH' || bound.bias === 'BEARISH',
    `${label} bias is invalid`,
  );
  assert(
    bound.orderingKnown === false,
    `${label} ordering must remain unknown`,
  );
  assert(
    finite(bound.favorableBound) &&
      bound.favorableBound >= 0 &&
      finite(bound.adverseBound) &&
      bound.adverseBound >= 0 &&
      finite(bound.favorableBoundPercent) &&
      bound.favorableBoundPercent >= 0 &&
      finite(bound.adverseBoundPercent) &&
      bound.adverseBoundPercent >= 0,
    `${label} bounds must be non-negative and finite`,
  );
  assert(
    positive(bound.favorablePrice) && positive(bound.adversePrice),
    `${label} prices must be positive`,
  );
  assert(
    timestamp(bound.favorableCandleStart) &&
      timestamp(bound.adverseCandleStart) &&
      cell.pathStartTimestamp !== null &&
      cell.pathEndTimestamp !== null &&
      bound.favorableCandleStart >= cell.pathStartTimestamp &&
      bound.favorableCandleStart < cell.pathEndTimestamp &&
      bound.adverseCandleStart >= cell.pathStartTimestamp &&
      bound.adverseCandleStart < cell.pathEndTimestamp,
    `${label} candle starts must be inside the path`,
  );
};

const validateCell = (value: unknown): PathOutcomeCell => {
  assert(isObject(value), 'Path cell must be an object');
  const cell = value as unknown as PathOutcomeCell;
  assert(
    Number.isSafeInteger(cell.horizonMs) && cell.horizonMs > 0,
    'Path horizon must be a positive integer',
  );
  assert(SOURCES.has(cell.source), 'Path source is invalid');
  assert(
    COMPLETENESS.has(cell.alignmentCompleteness),
    'Path alignment completeness is invalid',
  );
  assert(ELIGIBILITY.has(cell.eligibility), 'Path eligibility is invalid');
  assert(
    Array.isArray(cell.sourceAlignmentReasons) &&
      cell.sourceAlignmentReasons.every((reason) =>
        ALIGNMENT_REASONS.has(reason),
      ),
    'Path alignment reasons are invalid',
  );
  assert(
    Array.isArray(cell.sourceTerminalReturnReasons) &&
      cell.sourceTerminalReturnReasons.every((reason) =>
        TERMINAL_REASONS.has(reason),
      ),
    'Path terminal-return reasons are invalid',
  );
  assert(
    Array.isArray(cell.reasons) &&
      cell.reasons.every((reason) => PATH_REASONS.has(reason)) &&
      new Set(cell.reasons).size === cell.reasons.length &&
      cell.reasons.every(
        (reason, index) =>
          index === 0 || cell.reasons[index - 1]!.localeCompare(reason) <= 0,
      ),
    'Path reasons are invalid or duplicated',
  );
  assert(
    nullableTimestamp(cell.pathStartTimestamp) &&
      nullableTimestamp(cell.pathEndTimestamp),
    'Path bounds must be timestamps or null',
  );
  if (cell.pathStartTimestamp !== null && cell.pathEndTimestamp !== null) {
    assert(
      cell.pathEndTimestamp - cell.pathStartTimestamp === cell.horizonMs,
      'Path bounds must exactly match the horizon',
    );
  } else {
    assert(
      cell.pathStartTimestamp === null && cell.pathEndTimestamp === null,
      'Path bounds must both be present or absent',
    );
  }
  assert(
    Number.isSafeInteger(cell.sampleCount) && cell.sampleCount >= 0,
    'Path sample count must be non-negative',
  );
  assert(
    nullableTimestamp(cell.firstSampleTimestamp) &&
      nullableTimestamp(cell.lastSampleTimestamp),
    'Path sample timestamps are invalid',
  );
  if (cell.sampleCount === 0) {
    assert(
      cell.firstSampleTimestamp === null && cell.lastSampleTimestamp === null,
      'An empty path cannot have sample timestamps',
    );
  } else {
    assert(
      cell.firstSampleTimestamp !== null &&
        cell.lastSampleTimestamp !== null &&
        cell.pathStartTimestamp !== null &&
        cell.pathEndTimestamp !== null &&
        cell.firstSampleTimestamp >= cell.pathStartTimestamp &&
        cell.lastSampleTimestamp <= cell.pathEndTimestamp &&
        cell.firstSampleTimestamp <= cell.lastSampleTimestamp,
      'Path sample timestamps must be ordered inside the window',
    );
  }
  assert(Array.isArray(cell.validityGaps), 'Validity gaps must be an array');
  for (const gap of cell.validityGaps) {
    assert(
      isObject(gap) &&
        timestamp(gap.startTimestamp) &&
        (gap.endTimestamp === undefined ||
          (timestamp(gap.endTimestamp) &&
            gap.endTimestamp >= gap.startTimestamp)) &&
        new Set<unknown>([
          AlignmentReason.SEQUENCE_GAP,
          AlignmentReason.BOOK_INVALID,
          AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
          AlignmentReason.RECORDING_TRUNCATED,
        ]).has(gap.reason),
      'Path validity gap is invalid',
    );
  }
  if (cell.raw !== null) {
    validateExcursion(cell.raw, cell, 'Raw path');
  }
  if (cell.okxDirectional !== null) {
    validateExcursion(cell.okxDirectional, cell, 'OKX directional path');
    assert(
      cell.okxDirectional.bias === 'BULLISH' ||
        cell.okxDirectional.bias === 'BEARISH',
      'OKX directional bias is invalid',
    );
  }
  if (cell.externalDirectional !== null) {
    validateExcursion(
      cell.externalDirectional,
      cell,
      'External directional path',
    );
    assert(
      cell.externalDirectional.bias === 'BULLISH' ||
        cell.externalDirectional.bias === 'BEARISH',
      'External directional bias is invalid',
    );
  }
  for (const [label, executable] of [
    ['OKX executable path', cell.executableOkx],
    ['External executable path', cell.executableExternal],
  ] as const) {
    if (executable !== null) {
      validateExcursion(executable, cell, label);
      assert(
        positive(executable.entryPrice) &&
          positive(executable.favorableExitPrice) &&
          positive(executable.adverseExitPrice),
        `${label} prices must be positive`,
      );
      assert(
        executable.pricePolicy === 'REFERENCE_ASK_TO_OBSERVED_BID' ||
          executable.pricePolicy === 'REFERENCE_BID_TO_OBSERVED_ASK',
        `${label} price policy is invalid`,
      );
    }
  }
  if (cell.candleBounds !== null) {
    assert(isObject(cell.candleBounds), 'Candle bounds must be an object');
    if (cell.candleBounds.okx !== null) {
      validateCandleBound(cell.candleBounds.okx, cell, 'OKX candle bounds');
    }
    if (cell.candleBounds.external !== null) {
      validateCandleBound(
        cell.candleBounds.external,
        cell,
        'External candle bounds',
      );
    }
  }
  if (cell.eligibility === 'ELIGIBLE') {
    assert(
      cell.alignmentCompleteness === 'COMPLETE' && cell.sampleCount > 0,
      'Eligible paths require complete alignment and samples',
    );
    assert(
      !cell.reasons.includes(PathOutcomeReason.POLICY_INELIGIBLE) &&
        cell.validityGaps.length === 0,
      'Eligible paths cannot be policy-ineligible or cross validity gaps',
    );
    if (cell.source === 'ORDER_BOOK_MIDPOINT') {
      assert(
        cell.raw !== null &&
          cell.executableOkx === null &&
          cell.executableExternal === null &&
          cell.candleBounds === null,
        'Midpoint paths have invalid source-specific fields',
      );
    } else if (cell.source === 'ORDER_BOOK_BID_ASK') {
      assert(
        cell.raw !== null && cell.candleBounds === null,
        'Bid/ask paths have invalid source-specific fields',
      );
    } else {
      assert(
        cell.raw === null &&
          cell.okxDirectional === null &&
          cell.externalDirectional === null &&
          cell.executableOkx === null &&
          cell.executableExternal === null &&
          cell.candleBounds !== null,
        'Candle paths must contain bounds, not exact MFE/MAE',
      );
    }
  } else {
    assert(
      cell.raw === null &&
        cell.okxDirectional === null &&
        cell.externalDirectional === null &&
        cell.executableOkx === null &&
        cell.executableExternal === null &&
        cell.candleBounds === null,
      'Ineligible paths cannot contain trusted outcome metrics',
    );
    assert(
      cell.reasons.includes(PathOutcomeReason.POLICY_INELIGIBLE),
      'Ineligible paths must include the policy reason',
    );
  }
  return cell;
};

const validateCellArithmetic = (
  record: AlertPathOutcomeRecord,
  cell: PathOutcomeCell,
): void => {
  if (cell.eligibility !== 'ELIGIBLE' || !record.reference) {
    return;
  }
  const { absoluteTolerance, relativeTolerance } =
    record.policy.floatingPointPolicy;
  const close = (left: number, right: number): boolean =>
    Math.abs(left - right) <=
    Math.max(
      absoluteTolerance,
      relativeTolerance * Math.max(Math.abs(left), Math.abs(right)),
    );
  const validatePercent = (
    amount: number,
    percent: number,
    baseline: number,
    label: string,
  ): void =>
    assert(
      close(percent, (amount / baseline) * 100),
      `${label} percentage is inconsistent`,
    );
  const validateDirectional = (
    metric: PathExcursionOutcome & { bias: 'BULLISH' | 'BEARISH' },
    baseline: number,
    label: string,
  ): void => {
    const favorable =
      metric.bias === 'BULLISH'
        ? metric.favorablePrice - baseline
        : baseline - metric.favorablePrice;
    const adverse =
      metric.bias === 'BULLISH'
        ? baseline - metric.adversePrice
        : metric.adversePrice - baseline;
    assert(
      close(metric.favorableExcursion, Math.max(0, favorable)) &&
        close(metric.adverseExcursion, Math.max(0, adverse)),
      `${label} formula is inconsistent`,
    );
    validatePercent(
      metric.favorableExcursion,
      metric.favorableExcursionPercent,
      baseline,
      `${label} favorable`,
    );
    validatePercent(
      metric.adverseExcursion,
      metric.adverseExcursionPercent,
      baseline,
      `${label} adverse`,
    );
  };

  if (cell.raw) {
    assert(
      close(
        cell.raw.favorableExcursion,
        Math.max(0, cell.raw.favorablePrice - record.reference.midpoint),
      ) &&
        close(
          cell.raw.adverseExcursion,
          Math.max(0, record.reference.midpoint - cell.raw.adversePrice),
        ),
      'Raw midpoint path formula is inconsistent',
    );
    validatePercent(
      cell.raw.favorableExcursion,
      cell.raw.favorableExcursionPercent,
      record.reference.midpoint,
      'Raw favorable',
    );
    validatePercent(
      cell.raw.adverseExcursion,
      cell.raw.adverseExcursionPercent,
      record.reference.midpoint,
      'Raw adverse',
    );
  }
  for (const [label, metric, bias] of [
    ['OKX path', cell.okxDirectional, record.alertContext.okxBias],
    [
      'External path',
      cell.externalDirectional,
      record.alertContext.externalBias,
    ],
  ] as const) {
    if (metric) {
      assert(metric.bias === bias, `${label} bias is inconsistent`);
      validateDirectional(metric, record.reference.midpoint, label);
    }
  }
  for (const [label, metric, bias] of [
    ['OKX executable', cell.executableOkx, record.alertContext.okxBias],
    [
      'External executable',
      cell.executableExternal,
      record.alertContext.externalBias,
    ],
  ] as const) {
    if (metric) {
      assert(
        metric.bias === bias &&
          metric.favorableExitPrice === metric.favorablePrice &&
          metric.adverseExitPrice === metric.adversePrice,
        `${label} provenance is inconsistent`,
      );
      validateDirectional(metric, metric.entryPrice, label);
    }
  }
  for (const [label, bounds, bias] of [
    ['OKX candle', cell.candleBounds?.okx, record.alertContext.okxBias],
    [
      'External candle',
      cell.candleBounds?.external,
      record.alertContext.externalBias,
    ],
  ] as const) {
    if (!bounds) {
      continue;
    }
    assert(bounds.bias === bias, `${label} bias is inconsistent`);
    const favorable =
      bounds.bias === 'BULLISH'
        ? bounds.favorablePrice - record.reference.midpoint
        : record.reference.midpoint - bounds.favorablePrice;
    const adverse =
      bounds.bias === 'BULLISH'
        ? record.reference.midpoint - bounds.adversePrice
        : bounds.adversePrice - record.reference.midpoint;
    assert(
      close(bounds.favorableBound, Math.max(0, favorable)) &&
        close(bounds.adverseBound, Math.max(0, adverse)),
      `${label} bounds are inconsistent`,
    );
    validatePercent(
      bounds.favorableBound,
      bounds.favorableBoundPercent,
      record.reference.midpoint,
      `${label} favorable`,
    );
    validatePercent(
      bounds.adverseBound,
      bounds.adverseBoundPercent,
      record.reference.midpoint,
      `${label} adverse`,
    );
  }
};

export const parseAlertPathOutcomeRecord = (
  line: string,
): AlertPathOutcomeRecord => {
  const value: unknown = JSON.parse(line);
  assert(isObject(value), 'Path-outcome record must be an object');
  const record = value as unknown as AlertPathOutcomeRecord;
  assert(
    record.recordType === ALERT_PATH_OUTCOME_RECORD_TYPE,
    'Invalid path-outcome record type',
  );
  assert(
    record.schemaVersion === ALERT_PATH_OUTCOME_SCHEMA_VERSION,
    'Unsupported path-outcome schema version',
  );
  assert(
    timestamp(record.recordedAt),
    'recordedAt must be UTC epoch milliseconds',
  );
  assert(
    identifier(record.pathOutcomeId) &&
      record.pathOutcomeId.startsWith('alert-path-outcome:'),
    'Invalid pathOutcomeId',
  );
  assert(
    isPathOutcomeRunId(record.pathOutcomeRunId),
    'Invalid pathOutcomeRunId',
  );
  assert(identifier(record.sourceEvaluationId), 'Invalid sourceEvaluationId');
  assert(
    record.sourceTerminalReturnId === null ||
      (identifier(record.sourceTerminalReturnId) &&
        record.sourceTerminalReturnId.startsWith('alert-terminal-return:')),
    'Invalid sourceTerminalReturnId',
  );
  assert(
    record.evaluatorVersion === PATH_OUTCOME_EVALUATOR_VERSION,
    'Unsupported path-outcome evaluator version',
  );
  assert(
    isObject(record.policy) &&
      isSha256(record.policy.fingerprint) &&
      verifyPathOutcomePolicyFingerprint(record.policy),
    'Invalid path-outcome policy fingerprint',
  );
  assert(
    isObject(record.alertIdentity) &&
      identifier(record.alertIdentity.alertId) &&
      timestamp(record.alertIdentity.alertRecordedAt) &&
      (record.alertIdentity.sourceSessionId === null ||
        identifier(record.alertIdentity.sourceSessionId)) &&
      (record.alertIdentity.alertSequence === null ||
        (Number.isSafeInteger(record.alertIdentity.alertSequence) &&
          record.alertIdentity.alertSequence > 0)) &&
      (record.alertIdentity.semanticFingerprint === null ||
        isSha256(record.alertIdentity.semanticFingerprint)) &&
      (record.alertIdentity.alertSchemaVersion === 1 ||
        record.alertIdentity.alertSchemaVersion === 2),
    'Invalid path alert identity',
  );
  assert(
    isObject(record.instrument) &&
      typeof record.instrument.instId === 'string' &&
      record.instrument.instId.length > 0 &&
      (record.instrument.instType === 'SPOT' ||
        record.instrument.instType === 'SWAP' ||
        record.instrument.instType === null),
    'Invalid path instrument',
  );
  assert(
    isObject(record.alertContext) &&
      EVENTS.has(record.alertContext.eventType) &&
      BIASES.has(record.alertContext.bias) &&
      (record.alertContext.okxBias === null ||
        BIASES.has(record.alertContext.okxBias)) &&
      (record.alertContext.externalBias === null ||
        BIASES.has(record.alertContext.externalBias)) &&
      RELATIONSHIPS.has(record.alertContext.relationship) &&
      SEVERITIES.has(record.alertContext.severity) &&
      finite(record.alertContext.combinedConfidence) &&
      finite(record.alertContext.alertImportance) &&
      finite(record.alertContext.okxConfidence) &&
      finite(record.alertContext.externalEffectiveConfidence),
    'Invalid path alert context',
  );
  assert(
    record.reference === null ||
      (isObject(record.reference) &&
        timestamp(record.reference.referenceTimestamp) &&
        positive(record.reference.midpoint) &&
        positive(record.reference.bestBid) &&
        positive(record.reference.bestAsk) &&
        record.reference.bestAsk >= record.reference.bestBid &&
        timestamp(record.reference.sourceMarketTimestamp) &&
        timestamp(record.reference.sourceSignalTimestamp) &&
        finite(record.reference.spread) &&
        record.reference.spread >= 0 &&
        finite(record.reference.spreadPercent) &&
        record.reference.spreadPercent >= 0 &&
        record.reference.provenance === 'CAPTURED_ALERT_CONTEXT'),
    'Invalid path reference',
  );
  assert(isObject(record.provenance), 'Invalid path provenance');
  assert(
    record.provenance.sourceEvaluationSchemaVersion === 1 &&
      (record.provenance.sourceTerminalReturnSchemaVersion === 1 ||
        record.provenance.sourceTerminalReturnSchemaVersion === null) &&
      isSha256(record.provenance.sourceAlignmentConfigurationFingerprint) &&
      (record.provenance.sourceTerminalReturnPolicyFingerprint === null ||
        isSha256(record.provenance.sourceTerminalReturnPolicyFingerprint)) &&
      Array.isArray(record.provenance.horizonsMs) &&
      record.provenance.horizonsMs.every(
        (horizon) => Number.isSafeInteger(horizon) && horizon > 0,
      ) &&
      new Set(record.provenance.horizonsMs).size ===
        record.provenance.horizonsMs.length &&
      record.provenance.horizonsMs.every(
        (horizon, index) =>
          index === 0 || record.provenance.horizonsMs[index - 1]! < horizon,
      ) &&
      Array.isArray(record.provenance.requestedSources) &&
      record.provenance.requestedSources.every((source) =>
        SOURCES.has(source),
      ) &&
      new Set(record.provenance.requestedSources).size ===
        record.provenance.requestedSources.length &&
      identifier(record.provenance.sourceEvaluationRunId) &&
      (record.provenance.sourceTerminalReturnRunId === null ||
        identifier(record.provenance.sourceTerminalReturnRunId)) &&
      (record.provenance.marketSourceSessionId === null ||
        identifier(record.provenance.marketSourceSessionId)) &&
      (record.provenance.recordingId === null ||
        identifier(record.provenance.recordingId)) &&
      ['CLEAN', 'TRUNCATED', 'LEGACY_UNVERIFIED', 'INVALID'].includes(
        record.provenance.recordingTermination,
      ),
    'Invalid path provenance',
  );
  assert(Array.isArray(record.paths), 'Path matrix must be an array');
  const paths = record.paths.map(validateCell);
  for (const cell of paths) {
    validateCellArithmetic(record, cell);
  }
  const keys = paths.map((cell) => `${cell.horizonMs}\u001f${cell.source}`);
  assert(
    new Set(keys).size === keys.length,
    'Path matrix cells must be unique',
  );
  const expectedKeys = record.provenance.horizonsMs.flatMap((horizon) =>
    record.provenance.requestedSources.map(
      (source) => `${horizon}\u001f${source}`,
    ),
  );
  assert(
    keys.length === expectedKeys.length &&
      keys.every((key, index) => key === expectedKeys[index]),
    'Path matrix must be complete and deterministically ordered',
  );
  assert(
    record.pathOutcomeId ===
      createPathOutcomeId({
        sourceEvaluationId: record.sourceEvaluationId,
        sourceTerminalReturnId: record.sourceTerminalReturnId,
        policyFingerprint: record.policy.fingerprint,
      }),
    'pathOutcomeId does not match immutable inputs',
  );
  return record;
};
