import type { MarketBias } from '../types/signal';
import type {
  AlertAlignmentEvaluationRecord,
  PersistedAlignmentResult,
} from './alertAlignmentEvaluation';
import { parseAlertAlignmentEvaluationRecord } from './alertAlignmentEvaluationValidation';
import type { PreparedAlertAlignmentMarketRecording } from './alertAlignmentEvaluationGenerator';
import { canonicalJsonStringify } from './canonicalJson';
import {
  CONFIRMED_CANDLE_INTERVALS,
  type NormalizedConfirmedCandle,
} from './candleNormalization';
import { ConfirmedCandleIndex } from './confirmedCandleIndex';
import type {
  AlignmentReason,
  PriceObservation,
  PriceSource,
  ValidityInterval,
} from './alignmentTypes';
import { OrderBookObservationIndex } from './orderBookObservationIndex';
import {
  ALERT_PATH_OUTCOME_RECORD_TYPE,
  ALERT_PATH_OUTCOME_SCHEMA_VERSION,
  PATH_OUTCOME_EVALUATOR_VERSION,
  PathOutcomeReason,
  comparePathOutcomeRecords,
  createPathOutcomeId,
  createPathOutcomePolicy,
  isPathOutcomeRunId,
  verifyPathOutcomePolicyFingerprint,
  type AlertPathOutcomeRecord,
  type CandlePathBounds,
  type DirectionalPathOutcome,
  type ExecutablePathOutcome,
  type PathExcursionOutcome,
  type PathOutcomeCell,
  type PathOutcomePolicyV1,
} from './pathOutcome';
import type {
  AlertTerminalReturnRecord,
  TerminalReturnCell,
} from './terminalReturn';
import { parseAlertTerminalReturnRecord } from './terminalReturnValidation';

export interface GeneratePathOutcomeRecordsRequest {
  evaluations: readonly AlertAlignmentEvaluationRecord[];
  terminalReturns: readonly AlertTerminalReturnRecord[];
  marketRecording: PreparedAlertAlignmentMarketRecording;
  policy?: PathOutcomePolicyV1;
  pathOutcomeRunId: string;
  now: number;
}

interface TimedPrice {
  price: number;
  eventTimestamp: number;
  availabilityTimestamp: number;
  recordOrdinal: number;
}

interface PreparedIndexes {
  orderBooks: OrderBookObservationIndex | null;
  candles: ConfirmedCandleIndex | null;
}

const finitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const sameInstrument = (
  left: { instId: string; instType: string | null },
  right: { instId: string; instType: string | null },
): boolean => left.instId === right.instId && left.instType === right.instType;

const sameCell = (
  left: { horizonMs: number; source: PriceSource },
  right: { horizonMs: number; source: PriceSource },
): boolean =>
  left.horizonMs === right.horizonMs && left.source === right.source;

const uniqueReasons = (
  reasons: readonly PathOutcomeReason[],
): PathOutcomeReason[] => [...new Set(reasons)].sort();

const alignmentReason = (
  alignment: PersistedAlignmentResult,
): PathOutcomeReason | null =>
  ({
    COMPLETE: null,
    MISSING: PathOutcomeReason.ALIGNMENT_MISSING,
    PARTIAL: PathOutcomeReason.ALIGNMENT_PARTIAL,
    AMBIGUOUS: PathOutcomeReason.ALIGNMENT_AMBIGUOUS,
    INVALID: PathOutcomeReason.ALIGNMENT_INVALID,
  })[alignment.completeness];

const biasReasons = (
  okxBias: MarketBias | null,
  externalBias: MarketBias | null,
): PathOutcomeReason[] => {
  const reasons: PathOutcomeReason[] = [];
  if (okxBias === null) {
    reasons.push(PathOutcomeReason.OKX_BIAS_MISSING);
  } else if (okxBias === 'NEUTRAL') {
    reasons.push(PathOutcomeReason.OKX_BIAS_NEUTRAL);
  }
  if (externalBias === null) {
    reasons.push(PathOutcomeReason.EXTERNAL_BIAS_MISSING);
  } else if (externalBias === 'NEUTRAL') {
    reasons.push(PathOutcomeReason.EXTERNAL_BIAS_NEUTRAL);
  }
  return reasons;
};

const compareTimed = (left: TimedPrice, right: TimedPrice): number =>
  left.eventTimestamp - right.eventTimestamp ||
  left.availabilityTimestamp - right.availabilityTimestamp ||
  left.recordOrdinal - right.recordOrdinal;

const selectBetter = (
  candidateValue: number,
  currentValue: number,
  candidate: TimedPrice,
  current: TimedPrice,
): boolean =>
  candidateValue > currentValue ||
  (candidateValue === currentValue && compareTimed(candidate, current) < 0);

const calculatePath = (
  baseline: number,
  referenceTimestamp: number,
  samples: readonly TimedPrice[],
  bias?: 'BULLISH' | 'BEARISH',
): PathExcursionOutcome | DirectionalPathOutcome | null => {
  if (
    !finitePositive(baseline) ||
    samples.some(({ price }) => !finitePositive(price))
  ) {
    return null;
  }
  const baselineSample: TimedPrice = {
    price: baseline,
    eventTimestamp: referenceTimestamp,
    availabilityTimestamp: referenceTimestamp,
    recordOrdinal: -1,
  };
  let favorable = baselineSample;
  let adverse = baselineSample;
  let favorableValue = 0;
  let adverseValue = 0;

  for (const sample of samples) {
    const upward = sample.price - baseline;
    const favorableCandidate = bias === 'BEARISH' ? -upward : upward;
    const adverseCandidate = -favorableCandidate;
    const favorableMagnitude = Math.max(0, favorableCandidate);
    const adverseMagnitude = Math.max(0, adverseCandidate);
    if (selectBetter(favorableMagnitude, favorableValue, sample, favorable)) {
      favorable = sample;
      favorableValue = favorableMagnitude;
    }
    if (selectBetter(adverseMagnitude, adverseValue, sample, adverse)) {
      adverse = sample;
      adverseValue = adverseMagnitude;
    }
  }

  const result: PathExcursionOutcome = {
    favorableExcursion: favorableValue,
    favorableExcursionPercent: (favorableValue / baseline) * 100,
    adverseExcursion: adverseValue,
    adverseExcursionPercent: (adverseValue / baseline) * 100,
    timeToFavorableMs: favorable.eventTimestamp - referenceTimestamp,
    timeToAdverseMs: adverse.eventTimestamp - referenceTimestamp,
    favorablePrice: favorable.price,
    adversePrice: adverse.price,
    favorableTimestamp: favorable.eventTimestamp,
    adverseTimestamp: adverse.eventTimestamp,
  };
  if (
    Object.values(result).some(
      (value) => typeof value === 'number' && !Number.isFinite(value),
    )
  ) {
    return null;
  }
  return bias ? { ...result, bias } : result;
};

const calculateExecutablePath = (
  bias: MarketBias | null,
  referenceBid: number,
  referenceAsk: number,
  referenceTimestamp: number,
  samples: readonly PriceObservation[],
): ExecutablePathOutcome | null => {
  if (bias !== 'BULLISH' && bias !== 'BEARISH') {
    return null;
  }
  const entryPrice = bias === 'BULLISH' ? referenceAsk : referenceBid;
  if (!finitePositive(entryPrice)) {
    return null;
  }
  const exits: TimedPrice[] = [];
  for (const sample of samples) {
    const price = bias === 'BULLISH' ? sample.bestBid : sample.bestAsk;
    if (!finitePositive(price)) {
      return null;
    }
    exits.push({
      price,
      eventTimestamp: sample.eventTimestamp,
      availabilityTimestamp: sample.availabilityTimestamp,
      recordOrdinal: sample.recordOrdinal,
    });
  }
  const path = calculatePath(entryPrice, referenceTimestamp, exits, bias);
  if (!path) {
    return null;
  }
  return {
    ...path,
    bias,
    entryPrice,
    favorableExitPrice: path.favorablePrice,
    adverseExitPrice: path.adversePrice,
    pricePolicy:
      bias === 'BULLISH'
        ? 'REFERENCE_ASK_TO_OBSERVED_BID'
        : 'REFERENCE_BID_TO_OBSERVED_ASK',
  };
};

const calculateCandleBounds = (
  bias: MarketBias | null,
  baseline: number,
  candles: readonly NormalizedConfirmedCandle[],
): CandlePathBounds | null => {
  if (
    (bias !== 'BULLISH' && bias !== 'BEARISH') ||
    !finitePositive(baseline) ||
    candles.length === 0
  ) {
    return null;
  }
  let favorableValue = 0;
  let adverseValue = 0;
  let favorablePrice = baseline;
  let adversePrice = baseline;
  let favorableCandleStart = candles[0]?.intervalStart ?? 0;
  let adverseCandleStart = candles[0]?.intervalStart ?? 0;

  for (const candle of candles) {
    const favorableCandidate =
      bias === 'BULLISH' ? candle.high - baseline : baseline - candle.low;
    const adverseCandidate =
      bias === 'BULLISH' ? baseline - candle.low : candle.high - baseline;
    const nextFavorable = Math.max(0, favorableCandidate);
    const nextAdverse = Math.max(0, adverseCandidate);
    if (
      nextFavorable > favorableValue ||
      (nextFavorable === favorableValue &&
        candle.intervalStart < favorableCandleStart)
    ) {
      favorableValue = nextFavorable;
      favorablePrice =
        nextFavorable === 0
          ? baseline
          : bias === 'BULLISH'
            ? candle.high
            : candle.low;
      favorableCandleStart = candle.intervalStart;
    }
    if (
      nextAdverse > adverseValue ||
      (nextAdverse === adverseValue &&
        candle.intervalStart < adverseCandleStart)
    ) {
      adverseValue = nextAdverse;
      adversePrice =
        nextAdverse === 0
          ? baseline
          : bias === 'BULLISH'
            ? candle.low
            : candle.high;
      adverseCandleStart = candle.intervalStart;
    }
  }
  return {
    bias,
    favorableBound: favorableValue,
    adverseBound: adverseValue,
    favorableBoundPercent: (favorableValue / baseline) * 100,
    adverseBoundPercent: (adverseValue / baseline) * 100,
    favorablePrice,
    adversePrice,
    favorableCandleStart,
    adverseCandleStart,
    orderingKnown: false,
  };
};

const emptyCell = (
  alignment: PersistedAlignmentResult,
  terminal: TerminalReturnCell | null,
  input: {
    eligibility: PathOutcomeCell['eligibility'];
    reasons: readonly PathOutcomeReason[];
    pathStartTimestamp?: number | null;
    pathEndTimestamp?: number | null;
    sampleCount?: number;
    firstSampleTimestamp?: number | null;
    lastSampleTimestamp?: number | null;
    validityGaps?: readonly ValidityInterval[];
  },
): PathOutcomeCell => ({
  horizonMs: alignment.horizonMs,
  source: alignment.source,
  alignmentCompleteness: alignment.completeness,
  eligibility: input.eligibility,
  sourceAlignmentReasons: [...alignment.reasons],
  sourceTerminalReturnReasons: [...(terminal?.reasons ?? [])],
  reasons: uniqueReasons(input.reasons),
  pathStartTimestamp: input.pathStartTimestamp ?? null,
  pathEndTimestamp: input.pathEndTimestamp ?? null,
  sampleCount: input.sampleCount ?? 0,
  firstSampleTimestamp: input.firstSampleTimestamp ?? null,
  lastSampleTimestamp: input.lastSampleTimestamp ?? null,
  raw: null,
  okxDirectional: null,
  externalDirectional: null,
  executableOkx: null,
  executableExternal: null,
  candleBounds: null,
  validityGaps: [...(input.validityGaps ?? [])],
});

const terminalMatrixMatches = (
  evaluation: AlertAlignmentEvaluationRecord,
  terminal: AlertTerminalReturnRecord,
): boolean =>
  terminal.sourceEvaluationId === evaluation.evaluationId &&
  terminal.returns.length === evaluation.alignments.length &&
  terminal.returns.every((cell, index) => {
    const alignment = evaluation.alignments[index];
    return alignment !== undefined && sameCell(cell, alignment);
  }) &&
  sameInstrument(terminal.instrument, evaluation.instrument) &&
  terminal.provenance.recordingId === evaluation.provenance.recordingId &&
  terminal.provenance.marketSourceSessionId ===
    evaluation.provenance.marketSourceSessionId;

const marketMatches = (
  evaluation: AlertAlignmentEvaluationRecord,
  marketRecording: PreparedAlertAlignmentMarketRecording,
): boolean =>
  marketRecording.formatType === 'VERSIONED_V1' &&
  marketRecording.failure === null &&
  marketRecording.header !== null &&
  evaluation.instrument.instType !== null &&
  evaluation.provenance.recordingId === marketRecording.header.recordingId &&
  evaluation.provenance.marketSourceSessionId ===
    marketRecording.header.sourceSessionId &&
  evaluation.alertIdentity.sourceSessionId ===
    marketRecording.header.sourceSessionId &&
  marketRecording.header.instruments.some((instrument) =>
    sameInstrument(instrument, evaluation.instrument),
  );

const intersectingGaps = (
  evaluation: AlertAlignmentEvaluationRecord,
  marketRecording: PreparedAlertAlignmentMarketRecording,
  startTimestamp: number,
  endTimestamp: number,
): ValidityInterval[] =>
  (marketRecording.orderBookReconstruction?.validityGaps ?? [])
    .filter(
      (gap) =>
        sameInstrument(gap.instrument, evaluation.instrument) &&
        gap.startTimestamp <= endTimestamp &&
        (gap.endTimestamp === undefined || gap.endTimestamp >= startTimestamp),
    )
    .map(({ startTimestamp: start, endTimestamp: end, reason }) => ({
      startTimestamp: start,
      ...(end === undefined ? {} : { endTimestamp: end }),
      reason,
    }));

const recordingCompletionReasons = (
  marketRecording: PreparedAlertAlignmentMarketRecording,
  pathEndTimestamp: number,
  evaluation: AlertAlignmentEvaluationRecord,
  source: PriceSource,
): PathOutcomeReason[] => {
  const candles = marketRecording.candleRecording;
  if (candles?.termination === 'CLEAN') {
    return (candles.footer?.endedAt ?? -1) < pathEndTimestamp
      ? [PathOutcomeReason.RECORDING_ENDED_BEFORE_HORIZON]
      : [];
  }
  if (candles?.termination === 'TRUNCATED') {
    const lastAvailability = Math.max(
      marketRecording.header?.startedAt ?? 0,
      ...(source === 'CONFIRMED_CANDLE_CLOSE'
        ? candles.confirmedCandles
            .filter((candle) =>
              sameInstrument(candle.instrument, evaluation.instrument),
            )
            .map((candle) => candle.availabilityTimestamp)
        : (marketRecording.orderBookReconstruction?.observations
            .filter(
              (sample) =>
                sample.source === source &&
                sameInstrument(sample.instrument, evaluation.instrument),
            )
            .map((sample) => sample.availabilityTimestamp) ?? [])),
    );
    return lastAvailability < pathEndTimestamp
      ? [PathOutcomeReason.RECORDING_TRUNCATED]
      : [];
  }
  return [PathOutcomeReason.MARKET_RECORDING_MISMATCH];
};

const createBookCell = (
  evaluation: AlertAlignmentEvaluationRecord,
  alignment: PersistedAlignmentResult,
  terminal: TerminalReturnCell,
  indexes: PreparedIndexes,
  marketRecording: PreparedAlertAlignmentMarketRecording,
  startTimestamp: number,
  endTimestamp: number,
): PathOutcomeCell => {
  if (evaluation.instrument.instType === null || !indexes.orderBooks) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [
        PathOutcomeReason.MARKET_RECORDING_MISMATCH,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
    });
  }
  const result = indexes.orderBooks.findRange(
    {
      instId: evaluation.instrument.instId,
      instType: evaluation.instrument.instType,
    },
    alignment.source as 'ORDER_BOOK_MIDPOINT' | 'ORDER_BOOK_BID_ASK',
    startTimestamp,
    endTimestamp,
  );
  if (!result.valid) {
    return emptyCell(alignment, terminal, {
      eligibility:
        result.completeness === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'INELIGIBLE',
      reasons: [
        PathOutcomeReason.PATH_SAMPLE_INVALID,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
    });
  }
  const allSamples = result.value;
  const unavailable = allSamples.some(
    (sample) => sample.availabilityTimestamp > endTimestamp,
  );
  const samples = allSamples.filter(
    (sample) => sample.availabilityTimestamp <= endTimestamp,
  );
  const gaps = intersectingGaps(
    evaluation,
    marketRecording,
    startTimestamp,
    endTimestamp,
  );
  const completionReasons = recordingCompletionReasons(
    marketRecording,
    endTimestamp,
    evaluation,
    alignment.source,
  );
  const failureReasons = [
    ...(unavailable ? [PathOutcomeReason.PATH_SAMPLE_UNAVAILABLE] : []),
    ...(gaps.length > 0 ? [PathOutcomeReason.PATH_GAP_INTERSECTION] : []),
    ...completionReasons,
    ...(samples.length === 0 ? [PathOutcomeReason.NO_PATH_SAMPLES] : []),
  ];
  if (failureReasons.length > 0) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [...failureReasons, PathOutcomeReason.POLICY_INELIGIBLE],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
      sampleCount: samples.length,
      firstSampleTimestamp: samples[0]?.eventTimestamp ?? null,
      lastSampleTimestamp: samples.at(-1)?.eventTimestamp ?? null,
      validityGaps: gaps,
    });
  }

  const reference = evaluation.reference;
  if (!reference || !finitePositive(reference.midpoint)) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [
        reference
          ? PathOutcomeReason.REFERENCE_PRICE_INVALID
          : PathOutcomeReason.REFERENCE_PRICE_MISSING,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
      sampleCount: samples.length,
    });
  }
  const midpointSamples: TimedPrice[] = [];
  for (const sample of samples) {
    if (
      alignment.source === 'ORDER_BOOK_BID_ASK' &&
      (!finitePositive(sample.bestBid) ||
        !finitePositive(sample.bestAsk) ||
        sample.bestAsk < sample.bestBid)
    ) {
      return emptyCell(alignment, terminal, {
        eligibility: 'INELIGIBLE',
        reasons: [
          PathOutcomeReason.PATH_SAMPLE_INVALID,
          PathOutcomeReason.POLICY_INELIGIBLE,
        ],
        pathStartTimestamp: startTimestamp,
        pathEndTimestamp: endTimestamp,
        sampleCount: samples.length,
      });
    }
    const midpoint =
      sample.midpoint ??
      (finitePositive(sample.bestBid) && finitePositive(sample.bestAsk)
        ? (sample.bestBid + sample.bestAsk) / 2
        : null);
    if (!finitePositive(midpoint)) {
      return emptyCell(alignment, terminal, {
        eligibility: 'INELIGIBLE',
        reasons: [
          PathOutcomeReason.PATH_SAMPLE_INVALID,
          PathOutcomeReason.POLICY_INELIGIBLE,
        ],
        pathStartTimestamp: startTimestamp,
        pathEndTimestamp: endTimestamp,
        sampleCount: samples.length,
      });
    }
    midpointSamples.push({
      price: midpoint,
      eventTimestamp: sample.eventTimestamp,
      availabilityTimestamp: sample.availabilityTimestamp,
      recordOrdinal: sample.recordOrdinal,
    });
  }
  const raw = calculatePath(
    reference.midpoint,
    reference.referenceTimestamp,
    midpointSamples,
  );
  const okxDirectional = calculatePath(
    reference.midpoint,
    reference.referenceTimestamp,
    midpointSamples,
    evaluation.alertContext.okxBias === 'BULLISH' ||
      evaluation.alertContext.okxBias === 'BEARISH'
      ? evaluation.alertContext.okxBias
      : undefined,
  );
  const externalDirectional = calculatePath(
    reference.midpoint,
    reference.referenceTimestamp,
    midpointSamples,
    evaluation.alertContext.externalBias === 'BULLISH' ||
      evaluation.alertContext.externalBias === 'BEARISH'
      ? evaluation.alertContext.externalBias
      : undefined,
  );
  if (!raw) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [
        PathOutcomeReason.NON_FINITE_RESULT,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
      sampleCount: samples.length,
    });
  }
  if (
    alignment.source === 'ORDER_BOOK_BID_ASK' &&
    (!finitePositive(reference.bestBid) ||
      !finitePositive(reference.bestAsk) ||
      reference.bestAsk < reference.bestBid)
  ) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [
        finitePositive(reference.bestBid) && finitePositive(reference.bestAsk)
          ? PathOutcomeReason.REFERENCE_BOOK_CROSSED
          : PathOutcomeReason.REFERENCE_BID_ASK_MISSING,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
      sampleCount: samples.length,
    });
  }

  const base = emptyCell(alignment, terminal, {
    eligibility: 'ELIGIBLE',
    reasons: biasReasons(
      evaluation.alertContext.okxBias,
      evaluation.alertContext.externalBias,
    ),
    pathStartTimestamp: startTimestamp,
    pathEndTimestamp: endTimestamp,
    sampleCount: samples.length,
    firstSampleTimestamp: samples[0]?.eventTimestamp ?? null,
    lastSampleTimestamp: samples.at(-1)?.eventTimestamp ?? null,
    validityGaps: gaps,
  });
  return {
    ...base,
    raw,
    okxDirectional:
      evaluation.alertContext.okxBias === 'BULLISH' ||
      evaluation.alertContext.okxBias === 'BEARISH'
        ? (okxDirectional as DirectionalPathOutcome)
        : null,
    externalDirectional:
      evaluation.alertContext.externalBias === 'BULLISH' ||
      evaluation.alertContext.externalBias === 'BEARISH'
        ? (externalDirectional as DirectionalPathOutcome)
        : null,
    executableOkx:
      alignment.source === 'ORDER_BOOK_BID_ASK'
        ? calculateExecutablePath(
            evaluation.alertContext.okxBias,
            reference.bestBid,
            reference.bestAsk,
            reference.referenceTimestamp,
            samples,
          )
        : null,
    executableExternal:
      alignment.source === 'ORDER_BOOK_BID_ASK'
        ? calculateExecutablePath(
            evaluation.alertContext.externalBias,
            reference.bestBid,
            reference.bestAsk,
            reference.referenceTimestamp,
            samples,
          )
        : null,
  };
};

const createCandleCell = (
  evaluation: AlertAlignmentEvaluationRecord,
  alignment: PersistedAlignmentResult,
  terminal: TerminalReturnCell,
  indexes: PreparedIndexes,
  marketRecording: PreparedAlertAlignmentMarketRecording,
  startTimestamp: number,
  endTimestamp: number,
): PathOutcomeCell => {
  if (
    evaluation.instrument.instType === null ||
    !indexes.candles ||
    !marketRecording.candleRecording
  ) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [
        PathOutcomeReason.MARKET_RECORDING_MISMATCH,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
    });
  }
  const instrument = {
    instId: evaluation.instrument.instId,
    instType: evaluation.instrument.instType,
  };
  const candidates = indexes.candles.getCandidates(
    instrument,
    '1m',
    startTimestamp,
  );
  if (!candidates.valid) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [
        PathOutcomeReason.PATH_SAMPLE_INVALID,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
    });
  }
  const inWindow = candidates.value.filter(
    (candle) =>
      candle.intervalStart >= startTimestamp &&
      candle.intervalEnd <= endTimestamp,
  );
  const hasPartialAlertCandle = candidates.value.some(
    (candle) =>
      candle.intervalStart < startTimestamp &&
      candle.intervalEnd >= startTimestamp &&
      candle.intervalEnd <= endTimestamp,
  );
  if (inWindow.some((candle) => indexes.candles?.isAmbiguous(candle))) {
    return emptyCell(alignment, terminal, {
      eligibility: 'AMBIGUOUS',
      reasons: [
        PathOutcomeReason.CANDLE_CONFLICTING_DUPLICATE,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
      sampleCount: inWindow.length,
    });
  }
  const unavailable = inWindow.some(
    (candle) => candle.availabilityTimestamp > endTimestamp,
  );
  const candles = inWindow.filter(
    (candle) => candle.availabilityTimestamp <= endTimestamp,
  );
  const intervalMs = CONFIRMED_CANDLE_INTERVALS['1m'];
  const firstExpectedStart =
    Math.ceil(startTimestamp / intervalMs) * intervalMs;
  const expectedStarts = new Set<number>();
  for (
    let intervalStart = firstExpectedStart;
    intervalStart + intervalMs <= endTimestamp;
    intervalStart += intervalMs
  ) {
    expectedStarts.add(intervalStart);
  }
  for (const candle of candles) {
    expectedStarts.delete(candle.intervalStart);
  }
  const completionReasons = recordingCompletionReasons(
    marketRecording,
    endTimestamp,
    evaluation,
    alignment.source,
  );
  const failureReasons = [
    ...(unavailable ? [PathOutcomeReason.PATH_SAMPLE_UNAVAILABLE] : []),
    ...(expectedStarts.size > 0
      ? [PathOutcomeReason.CANDLE_INTERVAL_MISSING]
      : []),
    ...completionReasons,
    ...(candles.length === 0 ? [PathOutcomeReason.NO_PATH_SAMPLES] : []),
  ];
  if (failureReasons.length > 0) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [
        ...failureReasons,
        ...(hasPartialAlertCandle
          ? [PathOutcomeReason.CANDLE_PARTIAL_ALERT_INTERVAL]
          : []),
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
      sampleCount: candles.length,
      firstSampleTimestamp: candles[0]?.eventTimestamp ?? null,
      lastSampleTimestamp: candles.at(-1)?.eventTimestamp ?? null,
    });
  }
  const reference = evaluation.reference;
  if (!reference || !finitePositive(reference.midpoint)) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [
        reference
          ? PathOutcomeReason.REFERENCE_PRICE_INVALID
          : PathOutcomeReason.REFERENCE_PRICE_MISSING,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: startTimestamp,
      pathEndTimestamp: endTimestamp,
      sampleCount: candles.length,
    });
  }
  const base = emptyCell(alignment, terminal, {
    eligibility: 'ELIGIBLE',
    reasons: [
      ...biasReasons(
        evaluation.alertContext.okxBias,
        evaluation.alertContext.externalBias,
      ),
      ...(hasPartialAlertCandle
        ? [PathOutcomeReason.CANDLE_PARTIAL_ALERT_INTERVAL]
        : []),
    ],
    pathStartTimestamp: startTimestamp,
    pathEndTimestamp: endTimestamp,
    sampleCount: candles.length,
    firstSampleTimestamp: candles[0]?.eventTimestamp ?? null,
    lastSampleTimestamp: candles.at(-1)?.eventTimestamp ?? null,
  });
  return {
    ...base,
    candleBounds: {
      okx: calculateCandleBounds(
        evaluation.alertContext.okxBias,
        reference.midpoint,
        candles,
      ),
      external: calculateCandleBounds(
        evaluation.alertContext.externalBias,
        reference.midpoint,
        candles,
      ),
    },
  };
};

const createCell = (
  evaluation: AlertAlignmentEvaluationRecord,
  alignment: PersistedAlignmentResult,
  terminal: TerminalReturnCell | null,
  indexes: PreparedIndexes,
  marketRecording: PreparedAlertAlignmentMarketRecording,
  linkageReasons: readonly PathOutcomeReason[],
): PathOutcomeCell => {
  const referenceTimestamp = evaluation.reference?.referenceTimestamp ?? null;
  const pathEndTimestamp =
    referenceTimestamp !== null &&
    Number.isSafeInteger(referenceTimestamp + alignment.horizonMs)
      ? referenceTimestamp + alignment.horizonMs
      : null;
  if (linkageReasons.length > 0 || !terminal) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [
        ...linkageReasons,
        ...(!terminal ? [PathOutcomeReason.SOURCE_RETURN_MISMATCH] : []),
        ...biasReasons(
          evaluation.alertContext.okxBias,
          evaluation.alertContext.externalBias,
        ),
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: referenceTimestamp,
      pathEndTimestamp,
    });
  }
  const incomplete = alignmentReason(alignment);
  if (incomplete) {
    const inheritedReasons = [
      ...(alignment.reasons.includes(
        'RECORDING_TRUNCATED' as AlignmentReason,
      ) || evaluation.provenance.recordingTermination === 'TRUNCATED'
        ? [PathOutcomeReason.RECORDING_TRUNCATED]
        : []),
      ...(alignment.reasons.includes(
        'RECORDING_ENDED_BEFORE_HORIZON' as AlignmentReason,
      )
        ? [PathOutcomeReason.RECORDING_ENDED_BEFORE_HORIZON]
        : []),
    ];
    return emptyCell(alignment, terminal, {
      eligibility:
        alignment.completeness === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'INELIGIBLE',
      reasons: [
        incomplete,
        ...inheritedReasons,
        ...biasReasons(
          evaluation.alertContext.okxBias,
          evaluation.alertContext.externalBias,
        ),
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
      pathStartTimestamp: referenceTimestamp,
      pathEndTimestamp,
      validityGaps: alignment.validityGaps,
    });
  }
  if (referenceTimestamp === null || pathEndTimestamp === null) {
    return emptyCell(alignment, terminal, {
      eligibility: 'INELIGIBLE',
      reasons: [
        PathOutcomeReason.REFERENCE_PRICE_MISSING,
        PathOutcomeReason.POLICY_INELIGIBLE,
      ],
    });
  }
  return alignment.source === 'CONFIRMED_CANDLE_CLOSE'
    ? createCandleCell(
        evaluation,
        alignment,
        terminal,
        indexes,
        marketRecording,
        referenceTimestamp,
        pathEndTimestamp,
      )
    : createBookCell(
        evaluation,
        alignment,
        terminal,
        indexes,
        marketRecording,
        referenceTimestamp,
        pathEndTimestamp,
      );
};

export const generatePathOutcomeRecords = (
  request: GeneratePathOutcomeRecordsRequest,
): AlertPathOutcomeRecord[] => {
  if (!isPathOutcomeRunId(request.pathOutcomeRunId)) {
    throw new Error('pathOutcomeRunId must be a valid identifier');
  }
  if (!Number.isSafeInteger(request.now) || request.now < 0) {
    throw new Error('now must be UTC epoch milliseconds');
  }
  const policy = request.policy ?? createPathOutcomePolicy();
  if (!verifyPathOutcomePolicyFingerprint(policy)) {
    throw new Error('Invalid path-outcome policy fingerprint');
  }
  const evaluations = request.evaluations.map((record) =>
    parseAlertAlignmentEvaluationRecord(canonicalJsonStringify(record)),
  );
  const terminalReturns = request.terminalReturns.map((record) =>
    parseAlertTerminalReturnRecord(canonicalJsonStringify(record)),
  );
  const terminalByEvaluation = new Map<string, AlertTerminalReturnRecord[]>();
  for (const terminal of terminalReturns) {
    const records = terminalByEvaluation.get(terminal.sourceEvaluationId);
    if (records) {
      records.push(terminal);
    } else {
      terminalByEvaluation.set(terminal.sourceEvaluationId, [terminal]);
    }
  }
  const indexes: PreparedIndexes = {
    orderBooks: request.marketRecording.orderBookReconstruction
      ? new OrderBookObservationIndex(
          request.marketRecording.orderBookReconstruction,
        )
      : null,
    candles: request.marketRecording.candleRecording
      ? new ConfirmedCandleIndex(request.marketRecording.candleRecording)
      : null,
  };

  const output = evaluations.map((evaluation): AlertPathOutcomeRecord => {
    const terminalCandidates =
      terminalByEvaluation.get(evaluation.evaluationId) ?? [];
    const terminal =
      terminalCandidates.length === 1 ? (terminalCandidates[0] ?? null) : null;
    const terminalMatches =
      terminal !== null && terminalMatrixMatches(evaluation, terminal);
    const marketIsLinked = marketMatches(evaluation, request.marketRecording);
    const linkageReasons: PathOutcomeReason[] = [];
    if (!terminalMatches) {
      linkageReasons.push(PathOutcomeReason.SOURCE_RETURN_MISMATCH);
    }
    if (!marketIsLinked) {
      linkageReasons.push(PathOutcomeReason.MARKET_RECORDING_MISMATCH);
    }
    const terminalCells = terminalMatches ? (terminal?.returns ?? []) : [];
    const paths = evaluation.alignments.map((alignment, index) =>
      createCell(
        evaluation,
        alignment,
        terminalCells[index] ?? null,
        indexes,
        request.marketRecording,
        linkageReasons,
      ),
    );
    const record: AlertPathOutcomeRecord = {
      recordType: ALERT_PATH_OUTCOME_RECORD_TYPE,
      schemaVersion: ALERT_PATH_OUTCOME_SCHEMA_VERSION,
      recordedAt: request.now,
      pathOutcomeId: createPathOutcomeId({
        sourceEvaluationId: evaluation.evaluationId,
        sourceTerminalReturnId: terminalMatches
          ? (terminal?.outcomeId ?? null)
          : null,
        policyFingerprint: policy.fingerprint,
      }),
      pathOutcomeRunId: request.pathOutcomeRunId,
      sourceEvaluationId: evaluation.evaluationId,
      sourceTerminalReturnId: terminalMatches
        ? (terminal?.outcomeId ?? null)
        : null,
      evaluatorVersion: PATH_OUTCOME_EVALUATOR_VERSION,
      policy,
      alertIdentity: { ...evaluation.alertIdentity },
      instrument: { ...evaluation.instrument },
      alertContext: { ...evaluation.alertContext },
      reference: evaluation.reference ? { ...evaluation.reference } : null,
      provenance: {
        sourceEvaluationSchemaVersion: evaluation.schemaVersion,
        sourceEvaluationRunId: evaluation.evaluationRunId,
        sourceTerminalReturnSchemaVersion: terminalMatches
          ? (terminal?.schemaVersion ?? null)
          : null,
        sourceTerminalReturnRunId: terminalMatches
          ? (terminal?.outcomeRunId ?? null)
          : null,
        sourceAlignmentConfigurationFingerprint:
          evaluation.configuration.fingerprint,
        sourceTerminalReturnPolicyFingerprint: terminalMatches
          ? (terminal?.returnPolicy.fingerprint ?? null)
          : null,
        horizonsMs: [...evaluation.configuration.horizonsMs],
        requestedSources: [...evaluation.configuration.requestedSources],
        marketSourceSessionId:
          request.marketRecording.header?.sourceSessionId ?? null,
        recordingId: request.marketRecording.header?.recordingId ?? null,
        recordingTermination:
          request.marketRecording.formatType === 'VERSIONED_V1'
            ? (request.marketRecording.candleRecording?.termination ??
              'INVALID')
            : request.marketRecording.formatType === 'LEGACY_UNVERSIONED'
              ? 'LEGACY_UNVERIFIED'
              : 'INVALID',
      },
      paths: Object.freeze(paths),
    };
    return Object.freeze(record);
  });
  return output.sort(comparePathOutcomeRecords);
};
