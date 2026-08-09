import { canonicalJsonStringify } from './canonicalJson';
import { parseAlertAlignmentEvaluationRecord } from './alertAlignmentEvaluationValidation';
import type {
  AlertAlignmentEvaluationRecord,
  PersistedAlignmentResult,
} from './alertAlignmentEvaluation';
import type { MarketBias } from '../types/signal';
import {
  ALERT_TERMINAL_RETURN_RECORD_TYPE,
  ALERT_TERMINAL_RETURN_SCHEMA_VERSION,
  TERMINAL_RETURN_EVALUATOR_VERSION,
  TerminalReturnReason,
  compareTerminalReturnRecords,
  createTerminalReturnOutcomeId,
  createTerminalReturnPolicy,
  isOutcomeRunId,
  verifyTerminalReturnPolicyFingerprint,
  type AlertTerminalReturnRecord,
  type ExecutableDirectionalReturn,
  type TerminalReturnCell,
  type TerminalReturnPolicyV1,
} from './terminalReturn';

export interface GenerateTerminalReturnRecordsRequest {
  evaluations: readonly AlertAlignmentEvaluationRecord[];
  policy?: TerminalReturnPolicyV1;
  outcomeRunId: string;
  now: number;
}

interface RawReturnValues {
  rawReturn: number;
  rawReturnPercent: number;
}

const finitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const calculateRawReturn = (
  referencePrice: number,
  terminalPrice: number,
): RawReturnValues | null => {
  if (!finitePositive(referencePrice) || !finitePositive(terminalPrice)) {
    return null;
  }
  const rawReturn = terminalPrice - referencePrice;
  const rawReturnPercent = (rawReturn / referencePrice) * 100;
  return Number.isFinite(rawReturn) && Number.isFinite(rawReturnPercent)
    ? { rawReturn, rawReturnPercent }
    : null;
};

const calculateDirectionalReturn = (
  bias: MarketBias | null,
  referencePrice: number,
  terminalPrice: number,
): RawReturnValues | null => {
  if (bias !== 'BULLISH' && bias !== 'BEARISH') {
    return null;
  }
  const directionalReturn =
    bias === 'BULLISH'
      ? terminalPrice - referencePrice
      : referencePrice - terminalPrice;
  const directionalReturnPercent = (directionalReturn / referencePrice) * 100;
  return Number.isFinite(directionalReturn) &&
    Number.isFinite(directionalReturnPercent)
    ? {
        rawReturn: directionalReturn,
        rawReturnPercent: directionalReturnPercent,
      }
    : null;
};

const calculateExecutable = (
  bias: MarketBias | null,
  referenceBid: number,
  referenceAsk: number,
  terminalBid: number,
  terminalAsk: number,
): ExecutableDirectionalReturn | null => {
  if (bias !== 'BULLISH' && bias !== 'BEARISH') {
    return null;
  }
  const entryPrice = bias === 'BULLISH' ? referenceAsk : referenceBid;
  const exitPrice = bias === 'BULLISH' ? terminalBid : terminalAsk;
  if (!finitePositive(entryPrice) || !finitePositive(exitPrice)) {
    return null;
  }
  const rawReturn =
    bias === 'BULLISH' ? exitPrice - entryPrice : entryPrice - exitPrice;
  const rawReturnPercent = (rawReturn / entryPrice) * 100;
  if (!Number.isFinite(rawReturn) || !Number.isFinite(rawReturnPercent)) {
    return null;
  }
  return {
    bias,
    entryPrice,
    exitPrice,
    rawReturn,
    rawReturnPercent,
    directionalReturn: rawReturn,
    directionalReturnPercent: rawReturnPercent,
  };
};

const alignmentEligibility = (
  alignment: PersistedAlignmentResult,
): {
  eligibility: TerminalReturnCell['eligibility'];
  reasons: TerminalReturnReason[];
} => {
  if (alignment.completeness === 'COMPLETE') {
    return { eligibility: 'ELIGIBLE', reasons: [] };
  }
  const reason = {
    MISSING: TerminalReturnReason.ALIGNMENT_MISSING,
    PARTIAL: TerminalReturnReason.ALIGNMENT_PARTIAL,
    AMBIGUOUS: TerminalReturnReason.ALIGNMENT_AMBIGUOUS,
    INVALID: TerminalReturnReason.ALIGNMENT_INVALID,
  }[alignment.completeness];
  return {
    eligibility:
      alignment.completeness === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'INELIGIBLE',
    reasons: [reason, TerminalReturnReason.POLICY_INELIGIBLE],
  };
};

const emptyCell = (
  alignment: PersistedAlignmentResult,
  eligibility: TerminalReturnCell['eligibility'],
  reasons: readonly TerminalReturnReason[],
): TerminalReturnCell => ({
  horizonMs: alignment.horizonMs,
  source: alignment.source,
  alignmentCompleteness: alignment.completeness,
  eligibility,
  sourceAlignmentReasons: [...alignment.reasons],
  reasons: [...new Set(reasons)].sort(),
  rawPriceBasis: null,
  referencePrice: null,
  terminalPrice: null,
  rawReturn: null,
  rawReturnPercent: null,
  okxDirectionalReturn: null,
  okxDirectionalReturnPercent: null,
  externalDirectionalReturn: null,
  externalDirectionalReturnPercent: null,
  okxExecutable: null,
  externalExecutable: null,
  observationTimestamp: null,
  availabilityTimestamp: null,
});

const biasReasons = (
  okxBias: MarketBias | null,
  externalBias: MarketBias | null,
): TerminalReturnReason[] => {
  const reasons: TerminalReturnReason[] = [];
  if (okxBias === null) {
    reasons.push(TerminalReturnReason.OKX_BIAS_MISSING);
  } else if (okxBias === 'NEUTRAL') {
    reasons.push(TerminalReturnReason.OKX_BIAS_NEUTRAL);
  }
  if (externalBias === null) {
    reasons.push(TerminalReturnReason.EXTERNAL_BIAS_MISSING);
  } else if (externalBias === 'NEUTRAL') {
    reasons.push(TerminalReturnReason.EXTERNAL_BIAS_NEUTRAL);
  }
  return reasons;
};

const terminalPrice = (
  alignment: PersistedAlignmentResult,
): {
  price: number | null;
  basis: TerminalReturnCell['rawPriceBasis'];
} => {
  const observation = alignment.selectedObservation;
  if (!observation) {
    return { price: null, basis: null };
  }
  if (alignment.source === 'ORDER_BOOK_MIDPOINT') {
    return {
      price: observation.midpoint ?? null,
      basis: 'CAPTURED_MIDPOINT_TO_TERMINAL_MIDPOINT',
    };
  }
  if (alignment.source === 'CONFIRMED_CANDLE_CLOSE') {
    return {
      price: observation.close ?? null,
      basis: 'CAPTURED_MIDPOINT_TO_TERMINAL_CANDLE_CLOSE',
    };
  }
  if (
    finitePositive(observation.bestBid) &&
    finitePositive(observation.bestAsk) &&
    observation.bestAsk >= observation.bestBid
  ) {
    return {
      price: (observation.bestBid + observation.bestAsk) / 2,
      basis: 'CAPTURED_MIDPOINT_TO_TERMINAL_MIDPOINT',
    };
  }
  return { price: null, basis: null };
};

const createCell = (
  evaluation: AlertAlignmentEvaluationRecord,
  alignment: PersistedAlignmentResult,
): TerminalReturnCell => {
  const initialEligibility = alignmentEligibility(alignment);
  if (initialEligibility.eligibility !== 'ELIGIBLE') {
    return emptyCell(
      alignment,
      initialEligibility.eligibility,
      initialEligibility.reasons,
    );
  }

  const reference = evaluation.reference;
  if (!reference) {
    return emptyCell(alignment, 'INELIGIBLE', [
      TerminalReturnReason.REFERENCE_PRICE_MISSING,
      TerminalReturnReason.POLICY_INELIGIBLE,
    ]);
  }
  if (!finitePositive(reference.midpoint)) {
    return emptyCell(alignment, 'INELIGIBLE', [
      TerminalReturnReason.REFERENCE_PRICE_INVALID,
      TerminalReturnReason.POLICY_INELIGIBLE,
    ]);
  }
  const observed = terminalPrice(alignment);
  if (observed.price === null) {
    return emptyCell(alignment, 'INELIGIBLE', [
      alignment.selectedObservation
        ? TerminalReturnReason.TERMINAL_PRICE_INVALID
        : TerminalReturnReason.TERMINAL_PRICE_MISSING,
      TerminalReturnReason.POLICY_INELIGIBLE,
    ]);
  }
  const raw = calculateRawReturn(reference.midpoint, observed.price);
  if (!raw) {
    return emptyCell(alignment, 'INELIGIBLE', [
      TerminalReturnReason.NON_FINITE_RESULT,
      TerminalReturnReason.POLICY_INELIGIBLE,
    ]);
  }

  const okx = calculateDirectionalReturn(
    evaluation.alertContext.okxBias,
    reference.midpoint,
    observed.price,
  );
  const external = calculateDirectionalReturn(
    evaluation.alertContext.externalBias,
    reference.midpoint,
    observed.price,
  );
  let okxExecutable: ExecutableDirectionalReturn | null = null;
  let externalExecutable: ExecutableDirectionalReturn | null = null;
  const reasons = biasReasons(
    evaluation.alertContext.okxBias,
    evaluation.alertContext.externalBias,
  );

  if (alignment.source === 'ORDER_BOOK_BID_ASK') {
    const observation = alignment.selectedObservation;
    if (
      !finitePositive(reference.bestBid) ||
      !finitePositive(reference.bestAsk)
    ) {
      return emptyCell(alignment, 'INELIGIBLE', [
        TerminalReturnReason.REFERENCE_BID_ASK_MISSING,
        TerminalReturnReason.POLICY_INELIGIBLE,
      ]);
    }
    if (reference.bestAsk < reference.bestBid) {
      return emptyCell(alignment, 'INELIGIBLE', [
        TerminalReturnReason.REFERENCE_BOOK_CROSSED,
        TerminalReturnReason.POLICY_INELIGIBLE,
      ]);
    }
    if (
      !observation ||
      !finitePositive(observation.bestBid) ||
      !finitePositive(observation.bestAsk)
    ) {
      return emptyCell(alignment, 'INELIGIBLE', [
        TerminalReturnReason.TERMINAL_BID_ASK_MISSING,
        TerminalReturnReason.POLICY_INELIGIBLE,
      ]);
    }
    if (observation.bestAsk < observation.bestBid) {
      return emptyCell(alignment, 'INELIGIBLE', [
        TerminalReturnReason.TERMINAL_BOOK_CROSSED,
        TerminalReturnReason.POLICY_INELIGIBLE,
      ]);
    }
    okxExecutable = calculateExecutable(
      evaluation.alertContext.okxBias,
      reference.bestBid,
      reference.bestAsk,
      observation.bestBid,
      observation.bestAsk,
    );
    externalExecutable = calculateExecutable(
      evaluation.alertContext.externalBias,
      reference.bestBid,
      reference.bestAsk,
      observation.bestBid,
      observation.bestAsk,
    );
  }

  const observation = alignment.selectedObservation;
  return {
    horizonMs: alignment.horizonMs,
    source: alignment.source,
    alignmentCompleteness: alignment.completeness,
    eligibility: 'ELIGIBLE',
    sourceAlignmentReasons: [...alignment.reasons],
    reasons: [...new Set(reasons)].sort(),
    rawPriceBasis: observed.basis,
    referencePrice: reference.midpoint,
    terminalPrice: observed.price,
    rawReturn: raw.rawReturn,
    rawReturnPercent: raw.rawReturnPercent,
    okxDirectionalReturn: okx?.rawReturn ?? null,
    okxDirectionalReturnPercent: okx?.rawReturnPercent ?? null,
    externalDirectionalReturn: external?.rawReturn ?? null,
    externalDirectionalReturnPercent: external?.rawReturnPercent ?? null,
    okxExecutable,
    externalExecutable,
    observationTimestamp: observation?.eventTimestamp ?? null,
    availabilityTimestamp: observation?.availabilityTimestamp ?? null,
  };
};

export const generateTerminalReturnRecords = (
  request: GenerateTerminalReturnRecordsRequest,
): AlertTerminalReturnRecord[] => {
  if (!isOutcomeRunId(request.outcomeRunId)) {
    throw new Error('outcomeRunId must be a valid identifier');
  }
  if (!Number.isSafeInteger(request.now) || request.now < 0) {
    throw new Error('now must be UTC epoch milliseconds');
  }
  const policy = request.policy ?? createTerminalReturnPolicy();
  if (!verifyTerminalReturnPolicyFingerprint(policy)) {
    throw new Error('Invalid terminal-return policy fingerprint');
  }
  const records = request.evaluations.map((input) => {
    const evaluation = parseAlertAlignmentEvaluationRecord(
      canonicalJsonStringify(input),
    );
    const output: AlertTerminalReturnRecord = {
      recordType: ALERT_TERMINAL_RETURN_RECORD_TYPE,
      schemaVersion: ALERT_TERMINAL_RETURN_SCHEMA_VERSION,
      recordedAt: request.now,
      outcomeId: createTerminalReturnOutcomeId({
        sourceEvaluationId: evaluation.evaluationId,
        policyFingerprint: policy.fingerprint,
      }),
      outcomeRunId: request.outcomeRunId,
      sourceEvaluationId: evaluation.evaluationId,
      evaluatorVersion: TERMINAL_RETURN_EVALUATOR_VERSION,
      returnPolicy: policy,
      alertIdentity: { ...evaluation.alertIdentity },
      instrument: { ...evaluation.instrument },
      alertContext: { ...evaluation.alertContext },
      reference: evaluation.reference ? { ...evaluation.reference } : null,
      provenance: {
        sourceEvaluationSchemaVersion: evaluation.schemaVersion,
        sourceEvaluationRunId: evaluation.evaluationRunId,
        sourceAlignmentEvaluatorVersion: evaluation.provenance.evaluatorVersion,
        sourceAlignmentConfigurationFingerprint:
          evaluation.configuration.fingerprint,
        horizonsMs: [...evaluation.configuration.horizonsMs],
        requestedSources: [...evaluation.configuration.requestedSources],
        alertProvenance: evaluation.provenance.alertProvenance,
        marketRecordingFormat: evaluation.provenance.marketRecordingFormat,
        marketSourceSessionId: evaluation.provenance.marketSourceSessionId,
        recordingId: evaluation.provenance.recordingId,
        recordingTermination: evaluation.provenance.recordingTermination,
      },
      returns: evaluation.alignments.map((alignment) =>
        createCell(evaluation, alignment),
      ),
    };
    return Object.freeze(output);
  });

  return records.sort(compareTerminalReturnRecords);
};
