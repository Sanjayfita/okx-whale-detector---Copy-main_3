import type { MarketBias } from '../types/signal';
import type {
  AlertAlignmentEvaluationRecord,
  PersistedAlignmentResult,
} from './alertAlignmentEvaluation';
import { parseAlertAlignmentEvaluationRecord } from './alertAlignmentEvaluationValidation';
import type { PreparedAlertAlignmentMarketRecording } from './alertAlignmentEvaluationGenerator';
import { canonicalJsonStringify } from './canonicalJson';
import type { NormalizedConfirmedCandle } from './candleNormalization';
import { ConfirmedCandleIndex } from './confirmedCandleIndex';
import type { PriceSource } from './alignmentTypes';
import { OrderBookObservationIndex } from './orderBookObservationIndex';
import type { AlertPathOutcomeRecord, PathOutcomeCell } from './pathOutcome';
import { parseAlertPathOutcomeRecord } from './pathOutcomeValidation';
import type {
  AlertTerminalReturnRecord,
  TerminalReturnCell,
} from './terminalReturn';
import { parseAlertTerminalReturnRecord } from './terminalReturnValidation';
import {
  ALERT_TARGET_STOP_OUTCOME_RECORD_TYPE,
  ALERT_TARGET_STOP_OUTCOME_SCHEMA_VERSION,
  TARGET_STOP_EVALUATOR_VERSION,
  TargetStopReason,
  compareTargetStopOutcomeRecords,
  createTargetStopOutcomeId,
  isTargetStopRunId,
  verifyTargetStopPolicyFingerprint,
  type AlertTargetStopOutcomeRecord,
  type DirectionalTargetStopResult,
  type TargetStopCell,
  type TargetStopPolicyV1,
} from './targetStopOutcome';

export interface GenerateTargetStopOutcomeRecordsRequest {
  evaluations: readonly AlertAlignmentEvaluationRecord[];
  terminalReturns: readonly AlertTerminalReturnRecord[];
  pathOutcomes: readonly AlertPathOutcomeRecord[];
  marketRecording: PreparedAlertAlignmentMarketRecording;
  policy: TargetStopPolicyV1;
  targetStopRunId: string;
  now: number;
}

interface OrderedHitSample {
  price: number;
  eventTimestamp: number;
  availabilityTimestamp: number;
  recordOrdinal: number;
  candleStart: number | null;
}

const finitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const sameInstrument = (
  left: { instId: string; instType: string | null },
  right: { instId: string; instType: string | null },
): boolean => left.instId === right.instId && left.instType === right.instType;

const sameMatrix = (
  left: readonly { horizonMs: number; source: PriceSource }[],
  right: readonly { horizonMs: number; source: PriceSource }[],
): boolean =>
  left.length === right.length &&
  left.every(
    (cell, index) =>
      cell.horizonMs === right[index]?.horizonMs &&
      cell.source === right[index]?.source,
  );

const uniqueReasons = (
  reasons: readonly TargetStopReason[],
): TargetStopReason[] => [...new Set(reasons)].sort();

const biasReasons = (
  okxBias: MarketBias | null,
  externalBias: MarketBias | null,
): TargetStopReason[] => {
  const reasons: TargetStopReason[] = [];
  if (okxBias === null) {
    reasons.push(TargetStopReason.OKX_BIAS_MISSING);
  } else if (okxBias === 'NEUTRAL') {
    reasons.push(TargetStopReason.OKX_BIAS_NEUTRAL);
  }
  if (externalBias === null) {
    reasons.push(TargetStopReason.EXTERNAL_BIAS_MISSING);
  } else if (externalBias === 'NEUTRAL') {
    reasons.push(TargetStopReason.EXTERNAL_BIAS_NEUTRAL);
  }
  return reasons;
};

const targetAndStop = (
  bias: 'BULLISH' | 'BEARISH',
  baselinePrice: number,
  policy: TargetStopPolicyV1,
): { targetPrice: number; stopPrice: number } => ({
  targetPrice:
    baselinePrice *
    (1 + (bias === 'BULLISH' ? 1 : -1) * (policy.targetPercent / 100)),
  stopPrice:
    baselinePrice *
    (1 + (bias === 'BULLISH' ? -1 : 1) * (policy.stopPercent / 100)),
});

const qualifies = (
  bias: 'BULLISH' | 'BEARISH',
  price: number,
  targetPrice: number,
  stopPrice: number,
  policy: TargetStopPolicyV1,
): { target: boolean; stop: boolean } => ({
  target:
    bias === 'BULLISH'
      ? price >= targetPrice - comparisonTolerance(price, targetPrice, policy)
      : price <= targetPrice + comparisonTolerance(price, targetPrice, policy),
  stop:
    bias === 'BULLISH'
      ? price <= stopPrice + comparisonTolerance(price, stopPrice, policy)
      : price >= stopPrice - comparisonTolerance(price, stopPrice, policy),
});

const comparisonTolerance = (
  left: number,
  right: number,
  policy: TargetStopPolicyV1,
): number =>
  Math.max(
    policy.floatingPointPolicy.absoluteTolerance,
    policy.floatingPointPolicy.relativeTolerance *
      Math.max(Math.abs(left), Math.abs(right)),
  );

const evaluateOrderedPath = (
  bias: MarketBias | null,
  baselinePrice: number,
  referenceTimestamp: number,
  samples: readonly OrderedHitSample[],
  policy: TargetStopPolicyV1,
  precision: 'EXACT_ORDER_BOOK' | 'COARSE_CANDLE',
): DirectionalTargetStopResult | null => {
  if (
    (bias !== 'BULLISH' && bias !== 'BEARISH') ||
    !finitePositive(baselinePrice)
  ) {
    return null;
  }
  const { targetPrice, stopPrice } = targetAndStop(bias, baselinePrice, policy);
  let targetHit: OrderedHitSample | null = null;
  let stopHit: OrderedHitSample | null = null;
  let result: DirectionalTargetStopResult['result'] = 'NEITHER';
  let firstHit: OrderedHitSample | null = null;

  for (const sample of samples) {
    const hit = qualifies(bias, sample.price, targetPrice, stopPrice, policy);
    if (hit.target && !targetHit) {
      targetHit = sample;
    }
    if (hit.stop && !stopHit) {
      stopHit = sample;
    }
    if (!firstHit && (hit.target || hit.stop)) {
      firstHit = sample;
      if (hit.target && hit.stop) {
        result = precision === 'COARSE_CANDLE' ? 'AMBIGUOUS' : 'TIE';
      } else {
        result = hit.target ? 'TARGET_FIRST' : 'STOP_FIRST';
      }
    }
  }
  const ambiguous = result === 'AMBIGUOUS';
  return {
    bias,
    baselinePrice,
    targetPrice,
    stopPrice,
    result,
    targetHitTimestamp: targetHit?.eventTimestamp ?? null,
    stopHitTimestamp: stopHit?.eventTimestamp ?? null,
    firstHitTimestamp: ambiguous ? null : (firstHit?.eventTimestamp ?? null),
    firstHitAvailabilityTimestamp: ambiguous
      ? null
      : (firstHit?.availabilityTimestamp ?? null),
    firstHitRecordOrdinal: ambiguous ? null : (firstHit?.recordOrdinal ?? null),
    firstHitPrice: ambiguous ? null : (firstHit?.price ?? null),
    timeToTargetMs: targetHit
      ? targetHit.eventTimestamp - referenceTimestamp
      : null,
    timeToStopMs: stopHit ? stopHit.eventTimestamp - referenceTimestamp : null,
    timeToFirstHitMs:
      !ambiguous && firstHit
        ? firstHit.eventTimestamp - referenceTimestamp
        : null,
    firstHitCandleStart: !ambiguous && firstHit ? firstHit.candleStart : null,
    orderingPrecision: precision,
  };
};

const evaluateCandlePath = (
  bias: MarketBias | null,
  baselinePrice: number,
  referenceTimestamp: number,
  candles: readonly NormalizedConfirmedCandle[],
  policy: TargetStopPolicyV1,
): DirectionalTargetStopResult | null => {
  if (
    (bias !== 'BULLISH' && bias !== 'BEARISH') ||
    !finitePositive(baselinePrice)
  ) {
    return null;
  }
  const { targetPrice, stopPrice } = targetAndStop(bias, baselinePrice, policy);
  let targetHit: OrderedHitSample | null = null;
  let stopHit: OrderedHitSample | null = null;
  let firstHit: OrderedHitSample | null = null;
  let result: DirectionalTargetStopResult['result'] = 'NEITHER';

  for (const candle of candles) {
    const target =
      bias === 'BULLISH'
        ? candle.high >= targetPrice
        : candle.low <= targetPrice;
    const stop =
      bias === 'BULLISH' ? candle.low <= stopPrice : candle.high >= stopPrice;
    const common = {
      eventTimestamp: candle.intervalEnd,
      availabilityTimestamp: candle.availabilityTimestamp,
      recordOrdinal: candle.recordOrdinal,
      candleStart: candle.intervalStart,
    };
    if (target && !targetHit) {
      targetHit = {
        ...common,
        price: bias === 'BULLISH' ? candle.high : candle.low,
      };
    }
    if (stop && !stopHit) {
      stopHit = {
        ...common,
        price: bias === 'BULLISH' ? candle.low : candle.high,
      };
    }
    if (!firstHit && (target || stop)) {
      if (target && stop) {
        result = 'AMBIGUOUS';
        firstHit = { ...common, price: candle.close };
      } else if (target) {
        result = 'TARGET_FIRST';
        firstHit = targetHit;
      } else {
        result = 'STOP_FIRST';
        firstHit = stopHit;
      }
    }
  }
  const ambiguous = result === 'AMBIGUOUS';
  return {
    bias,
    baselinePrice,
    targetPrice,
    stopPrice,
    result,
    targetHitTimestamp: targetHit?.eventTimestamp ?? null,
    stopHitTimestamp: stopHit?.eventTimestamp ?? null,
    firstHitTimestamp: ambiguous ? null : (firstHit?.eventTimestamp ?? null),
    firstHitAvailabilityTimestamp: ambiguous
      ? null
      : (firstHit?.availabilityTimestamp ?? null),
    firstHitRecordOrdinal: ambiguous ? null : (firstHit?.recordOrdinal ?? null),
    firstHitPrice: ambiguous ? null : (firstHit?.price ?? null),
    timeToTargetMs: targetHit
      ? targetHit.eventTimestamp - referenceTimestamp
      : null,
    timeToStopMs: stopHit ? stopHit.eventTimestamp - referenceTimestamp : null,
    timeToFirstHitMs:
      !ambiguous && firstHit
        ? firstHit.eventTimestamp - referenceTimestamp
        : null,
    firstHitCandleStart: !ambiguous && firstHit ? firstHit.candleStart : null,
    orderingPrecision: 'COARSE_CANDLE',
  };
};

const emptyCell = (
  alignment: PersistedAlignmentResult,
  terminal: TerminalReturnCell | null,
  path: PathOutcomeCell | null,
  policy: TargetStopPolicyV1,
  eligibility: TargetStopCell['eligibility'],
  reasons: readonly TargetStopReason[],
): TargetStopCell => ({
  horizonMs: alignment.horizonMs,
  source: alignment.source,
  alignmentCompleteness: alignment.completeness,
  eligibility,
  sourceAlignmentReasons: [...alignment.reasons],
  sourceTerminalReturnReasons: [...(terminal?.reasons ?? [])],
  sourcePathOutcomeReasons: [...(path?.reasons ?? [])],
  reasons: uniqueReasons(reasons),
  targetPercent: policy.targetPercent,
  stopPercent: policy.stopPercent,
  okx: null,
  external: null,
  executableOkx: null,
  executableExternal: null,
  candleOkx: null,
  candleExternal: null,
  validityGaps: [...(path?.validityGaps ?? alignment.validityGaps)],
});

const outcomeReasons = (
  results: readonly (DirectionalTargetStopResult | null)[],
): TargetStopReason[] => {
  const reasons: TargetStopReason[] = [];
  if (results.some((result) => result?.result === 'AMBIGUOUS')) {
    reasons.push(TargetStopReason.TARGET_STOP_ORDER_AMBIGUOUS);
  }
  if (results.some((result) => result?.result === 'TIE')) {
    reasons.push(TargetStopReason.TARGET_STOP_SAME_SAMPLE);
  }
  if (results.some((result) => result?.result === 'NEITHER')) {
    reasons.push(
      TargetStopReason.TARGET_NOT_REACHED,
      TargetStopReason.STOP_NOT_REACHED,
    );
  }
  return reasons;
};

const createCell = (
  evaluation: AlertAlignmentEvaluationRecord,
  alignment: PersistedAlignmentResult,
  terminal: TerminalReturnCell | null,
  path: PathOutcomeCell | null,
  policy: TargetStopPolicyV1,
  orderBooks: OrderBookObservationIndex | null,
  candles: ConfirmedCandleIndex | null,
  linkageReasons: readonly TargetStopReason[],
): TargetStopCell => {
  if (linkageReasons.length > 0 || !terminal || !path) {
    return emptyCell(alignment, terminal, path, policy, 'INELIGIBLE', [
      ...linkageReasons,
      ...(!terminal ? [TargetStopReason.TERMINAL_RETURN_MISMATCH] : []),
      ...(!path ? [TargetStopReason.PATH_OUTCOME_MISSING] : []),
      TargetStopReason.POLICY_INELIGIBLE,
    ]);
  }
  if (path.eligibility !== 'ELIGIBLE') {
    const mapped = path.reasons.flatMap((reason): TargetStopReason[] => {
      const value = TargetStopReason[reason as keyof typeof TargetStopReason];
      return value ? [value] : [];
    });
    return emptyCell(alignment, terminal, path, policy, path.eligibility, [
      ...mapped,
      TargetStopReason.POLICY_INELIGIBLE,
    ]);
  }
  const reference = evaluation.reference;
  if (!reference || evaluation.instrument.instType === null) {
    return emptyCell(alignment, terminal, path, policy, 'INELIGIBLE', [
      TargetStopReason.REFERENCE_PRICE_MISSING,
      TargetStopReason.POLICY_INELIGIBLE,
    ]);
  }
  const start = reference.referenceTimestamp;
  const end = start + alignment.horizonMs;
  const instrument = {
    instId: evaluation.instrument.instId,
    instType: evaluation.instrument.instType,
  };
  const commonReasons = biasReasons(
    evaluation.alertContext.okxBias,
    evaluation.alertContext.externalBias,
  );
  let okx: DirectionalTargetStopResult | null = null;
  let external: DirectionalTargetStopResult | null = null;
  let executableOkx: DirectionalTargetStopResult | null = null;
  let executableExternal: DirectionalTargetStopResult | null = null;
  let candleOkx: DirectionalTargetStopResult | null = null;
  let candleExternal: DirectionalTargetStopResult | null = null;

  if (alignment.source === 'CONFIRMED_CANDLE_CLOSE') {
    if (!candles) {
      return emptyCell(alignment, terminal, path, policy, 'INELIGIBLE', [
        TargetStopReason.MARKET_RECORDING_MISMATCH,
        TargetStopReason.POLICY_INELIGIBLE,
      ]);
    }
    const candidates = candles.getCandidates(instrument, '1m', start);
    if (!candidates.valid) {
      return emptyCell(
        alignment,
        terminal,
        path,
        policy,
        candidates.completeness === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'INELIGIBLE',
        [
          TargetStopReason.CANDLE_CONFLICTING_DUPLICATE,
          TargetStopReason.POLICY_INELIGIBLE,
        ],
      );
    }
    const selected = candidates.value.filter(
      (candle) =>
        candle.intervalStart >= start &&
        candle.intervalEnd <= end &&
        candle.availabilityTimestamp <= end,
    );
    if (selected.some((candle) => candles.isAmbiguous(candle))) {
      return emptyCell(alignment, terminal, path, policy, 'AMBIGUOUS', [
        TargetStopReason.CANDLE_CONFLICTING_DUPLICATE,
        TargetStopReason.POLICY_INELIGIBLE,
      ]);
    }
    candleOkx = evaluateCandlePath(
      evaluation.alertContext.okxBias,
      reference.midpoint,
      start,
      selected,
      policy,
    );
    candleExternal = evaluateCandlePath(
      evaluation.alertContext.externalBias,
      reference.midpoint,
      start,
      selected,
      policy,
    );
  } else {
    if (!orderBooks) {
      return emptyCell(alignment, terminal, path, policy, 'INELIGIBLE', [
        TargetStopReason.MARKET_RECORDING_MISMATCH,
        TargetStopReason.POLICY_INELIGIBLE,
      ]);
    }
    const range = orderBooks.findRange(
      instrument,
      alignment.source,
      start,
      end,
    );
    if (!range.valid) {
      return emptyCell(alignment, terminal, path, policy, 'INELIGIBLE', [
        TargetStopReason.NO_PATH_SAMPLES,
        TargetStopReason.POLICY_INELIGIBLE,
      ]);
    }
    const samples = range.value.filter(
      (sample) => sample.availabilityTimestamp <= end,
    );
    if (samples.length === 0) {
      return emptyCell(alignment, terminal, path, policy, 'INELIGIBLE', [
        TargetStopReason.NO_PATH_SAMPLES,
        TargetStopReason.POLICY_INELIGIBLE,
      ]);
    }
    if (alignment.source === 'ORDER_BOOK_MIDPOINT') {
      const ordered = samples.map((sample): OrderedHitSample => ({
        price: sample.midpoint!,
        eventTimestamp: sample.eventTimestamp,
        availabilityTimestamp: sample.availabilityTimestamp,
        recordOrdinal: sample.recordOrdinal,
        candleStart: null,
      }));
      okx = evaluateOrderedPath(
        evaluation.alertContext.okxBias,
        reference.midpoint,
        start,
        ordered,
        policy,
        'EXACT_ORDER_BOOK',
      );
      external = evaluateOrderedPath(
        evaluation.alertContext.externalBias,
        reference.midpoint,
        start,
        ordered,
        policy,
        'EXACT_ORDER_BOOK',
      );
    } else {
      if (
        !finitePositive(reference.bestBid) ||
        !finitePositive(reference.bestAsk) ||
        reference.bestAsk < reference.bestBid ||
        samples.some(
          (sample) =>
            !finitePositive(sample.bestBid) ||
            !finitePositive(sample.bestAsk) ||
            sample.bestAsk < sample.bestBid,
        )
      ) {
        return emptyCell(alignment, terminal, path, policy, 'INELIGIBLE', [
          TargetStopReason.REFERENCE_BOOK_CROSSED,
          TargetStopReason.POLICY_INELIGIBLE,
        ]);
      }
      const toOrdered = (bias: MarketBias | null): OrderedHitSample[] =>
        samples.map((sample) => ({
          price: bias === 'BEARISH' ? sample.bestAsk! : sample.bestBid!,
          eventTimestamp: sample.eventTimestamp,
          availabilityTimestamp: sample.availabilityTimestamp,
          recordOrdinal: sample.recordOrdinal,
          candleStart: null,
        }));
      executableOkx = evaluateOrderedPath(
        evaluation.alertContext.okxBias,
        evaluation.alertContext.okxBias === 'BEARISH'
          ? reference.bestBid
          : reference.bestAsk,
        start,
        toOrdered(evaluation.alertContext.okxBias),
        policy,
        'EXACT_ORDER_BOOK',
      );
      executableExternal = evaluateOrderedPath(
        evaluation.alertContext.externalBias,
        evaluation.alertContext.externalBias === 'BEARISH'
          ? reference.bestBid
          : reference.bestAsk,
        start,
        toOrdered(evaluation.alertContext.externalBias),
        policy,
        'EXACT_ORDER_BOOK',
      );
    }
  }
  const results = [
    okx,
    external,
    executableOkx,
    executableExternal,
    candleOkx,
    candleExternal,
  ];
  const ambiguous = results.some((result) => result?.result === 'AMBIGUOUS');
  const base = emptyCell(
    alignment,
    terminal,
    path,
    policy,
    ambiguous ? 'AMBIGUOUS' : 'ELIGIBLE',
    [...commonReasons, ...outcomeReasons(results)],
  );
  return {
    ...base,
    okx,
    external,
    executableOkx,
    executableExternal,
    candleOkx,
    candleExternal,
  };
};

export const generateTargetStopOutcomeRecords = (
  request: GenerateTargetStopOutcomeRecordsRequest,
): AlertTargetStopOutcomeRecord[] => {
  if (!isTargetStopRunId(request.targetStopRunId)) {
    throw new Error('targetStopRunId must be a valid identifier');
  }
  if (!Number.isSafeInteger(request.now) || request.now < 0) {
    throw new Error('now must be UTC epoch milliseconds');
  }
  if (!verifyTargetStopPolicyFingerprint(request.policy)) {
    throw new Error('Invalid target/stop policy fingerprint');
  }
  const evaluations = request.evaluations.map((record) =>
    parseAlertAlignmentEvaluationRecord(canonicalJsonStringify(record)),
  );
  const terminals = request.terminalReturns.map((record) =>
    parseAlertTerminalReturnRecord(canonicalJsonStringify(record)),
  );
  const paths = request.pathOutcomes.map((record) =>
    parseAlertPathOutcomeRecord(canonicalJsonStringify(record)),
  );
  const terminalByEvaluation = new Map(
    terminals.map((record) => [record.sourceEvaluationId, record]),
  );
  const pathByEvaluation = new Map(
    paths.map((record) => [record.sourceEvaluationId, record]),
  );
  const orderBooks = request.marketRecording.orderBookReconstruction
    ? new OrderBookObservationIndex(
        request.marketRecording.orderBookReconstruction,
      )
    : null;
  const candles = request.marketRecording.candleRecording
    ? new ConfirmedCandleIndex(request.marketRecording.candleRecording)
    : null;

  const output = evaluations.map((evaluation): AlertTargetStopOutcomeRecord => {
    const terminal =
      terminalByEvaluation.get(evaluation.evaluationId) ?? terminals[0];
    const path = pathByEvaluation.get(evaluation.evaluationId) ?? paths[0];
    const header = request.marketRecording.header;
    const terminalMatches =
      terminal !== undefined &&
      terminal.sourceEvaluationId === evaluation.evaluationId &&
      sameMatrix(evaluation.alignments, terminal.returns);
    const pathMatches =
      path !== undefined &&
      path.sourceEvaluationId === evaluation.evaluationId &&
      path.sourceTerminalReturnId === terminal?.outcomeId &&
      sameMatrix(evaluation.alignments, path.paths);
    const marketMatches =
      header !== null &&
      request.marketRecording.formatType === 'VERSIONED_V1' &&
      request.marketRecording.failure === null &&
      evaluation.provenance.recordingId === header.recordingId &&
      evaluation.provenance.marketSourceSessionId === header.sourceSessionId &&
      terminal !== undefined &&
      path !== undefined &&
      sameInstrument(evaluation.instrument, terminal.instrument) &&
      sameInstrument(evaluation.instrument, path.instrument);
    const linkageReasons: TargetStopReason[] = [];
    if (!terminalMatches) {
      linkageReasons.push(TargetStopReason.TERMINAL_RETURN_MISMATCH);
    }
    if (!pathMatches) {
      linkageReasons.push(TargetStopReason.PATH_OUTCOME_MISMATCH);
    }
    if (!marketMatches) {
      linkageReasons.push(TargetStopReason.MARKET_RECORDING_MISMATCH);
    }
    if (
      !evaluation.reference ||
      !terminal ||
      !path ||
      !header ||
      !request.marketRecording.candleRecording
    ) {
      throw new Error(
        'Phase G requires versioned Phase D, E, F, and market records',
      );
    }
    const outcomes = evaluation.alignments.map((alignment, index) =>
      createCell(
        evaluation,
        alignment,
        terminalMatches ? (terminal.returns[index] ?? null) : null,
        pathMatches ? (path.paths[index] ?? null) : null,
        request.policy,
        orderBooks,
        candles,
        linkageReasons,
      ),
    );
    return Object.freeze({
      recordType: ALERT_TARGET_STOP_OUTCOME_RECORD_TYPE,
      schemaVersion: ALERT_TARGET_STOP_OUTCOME_SCHEMA_VERSION,
      recordedAt: request.now,
      targetStopOutcomeId: createTargetStopOutcomeId({
        sourceEvaluationId: evaluation.evaluationId,
        sourceTerminalReturnId: terminal.outcomeId,
        sourcePathOutcomeId: path.pathOutcomeId,
        policyFingerprint: request.policy.fingerprint,
      }),
      targetStopRunId: request.targetStopRunId,
      sourceEvaluationId: evaluation.evaluationId,
      sourceTerminalReturnId: terminal.outcomeId,
      sourcePathOutcomeId: path.pathOutcomeId,
      evaluatorVersion: TARGET_STOP_EVALUATOR_VERSION,
      policy: request.policy,
      alertIdentity: { ...evaluation.alertIdentity },
      instrument: { ...evaluation.instrument },
      alertContext: { ...evaluation.alertContext },
      reference: { ...evaluation.reference },
      provenance: {
        sourceEvaluationSchemaVersion: evaluation.schemaVersion,
        sourceTerminalReturnSchemaVersion: terminal.schemaVersion,
        sourcePathOutcomeSchemaVersion: path.schemaVersion,
        sourceEvaluationRunId: evaluation.evaluationRunId,
        sourceTerminalReturnRunId: terminal.outcomeRunId,
        sourcePathOutcomeRunId: path.pathOutcomeRunId,
        sourceAlignmentConfigurationFingerprint:
          evaluation.configuration.fingerprint,
        sourceTerminalReturnPolicyFingerprint:
          terminal.returnPolicy.fingerprint,
        sourcePathOutcomePolicyFingerprint: path.policy.fingerprint,
        horizonsMs: [...evaluation.configuration.horizonsMs],
        requestedSources: [...evaluation.configuration.requestedSources],
        marketSourceSessionId: header.sourceSessionId,
        recordingId: header.recordingId,
        recordingTermination:
          request.marketRecording.candleRecording.termination,
      },
      outcomes: Object.freeze(outcomes),
    });
  });
  return output.sort(compareTargetStopOutcomeRecords);
};
