import {
  AlignmentReason,
  generateAlertAlignmentEvaluations,
  generateTerminalReturnRecords,
  type AlertAlignmentEvaluationRecord,
  type AlertTerminalReturnRecord,
} from '../../src/evaluation';
import {
  EVALUATION_NOW,
  createDefaultEvaluationConfiguration,
  createEvaluationAlert,
  createPreparedEvaluationMarket,
} from './alignmentEvaluationFixtures';

export const TERMINAL_RETURN_NOW = EVALUATION_NOW + 7_200_000;

export const createReturnEvaluation = (
  overrides: {
    sequence?: number;
    okxBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | null;
    externalBias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | null;
    relationship?:
      'AGREEMENT' | 'CONTRADICTION' | 'EXTERNAL_ONLY' | 'OKX_ONLY' | 'NEUTRAL';
    midpoint?: number;
    bestBid?: number;
    bestAsk?: number;
    candleClose?: number;
  } = {},
): AlertAlignmentEvaluationRecord => {
  const evaluation = generateAlertAlignmentEvaluations({
    alerts: [createEvaluationAlert({ sequence: overrides.sequence ?? 1 })],
    marketRecording: createPreparedEvaluationMarket(),
    configuration: createDefaultEvaluationConfiguration(),
    evaluationRunId: 'evaluation-run:terminal-return-fixture',
    now: TERMINAL_RETURN_NOW,
  })[0]!;
  evaluation.alertContext.okxBias =
    overrides.okxBias === undefined ? 'BULLISH' : overrides.okxBias;
  evaluation.alertContext.externalBias =
    overrides.externalBias === undefined ? 'BULLISH' : overrides.externalBias;
  evaluation.alertContext.relationship = overrides.relationship ?? 'AGREEMENT';

  for (const alignment of evaluation.alignments) {
    const observation = alignment.selectedObservation;
    if (!observation) {
      continue;
    }
    if (alignment.source === 'ORDER_BOOK_MIDPOINT') {
      observation.midpoint = overrides.midpoint ?? 110;
    } else if (alignment.source === 'ORDER_BOOK_BID_ASK') {
      observation.bestBid = overrides.bestBid ?? 109;
      observation.bestAsk = overrides.bestAsk ?? 111;
    } else {
      observation.close = overrides.candleClose ?? 110;
    }
  }

  return evaluation;
};

export const setAlignmentCompleteness = (
  evaluation: AlertAlignmentEvaluationRecord,
  index: number,
  completeness: 'PARTIAL' | 'MISSING' | 'AMBIGUOUS' | 'INVALID',
): void => {
  const alignment = evaluation.alignments[index];
  if (!alignment) {
    throw new Error('Missing fixture alignment');
  }
  const reason = {
    PARTIAL: AlignmentReason.RECORDING_TRUNCATED,
    MISSING: AlignmentReason.NO_SAMPLE_AFTER_HORIZON,
    AMBIGUOUS: AlignmentReason.CONFLICTING_DUPLICATE,
    INVALID: AlignmentReason.BOOK_INVALID,
  }[completeness];
  alignment.completeness = completeness;
  alignment.primaryReason = reason;
  alignment.reasons = [reason];
  if (completeness !== 'PARTIAL' && completeness !== 'AMBIGUOUS') {
    alignment.selectedObservation = null;
    alignment.observationDelayMs = null;
    alignment.availabilityDelayMs = null;
  }
};

export const createTerminalReturnRecord = (
  evaluation = createReturnEvaluation(),
  overrides: {
    outcomeRunId?: string;
    now?: number;
  } = {},
): AlertTerminalReturnRecord =>
  generateTerminalReturnRecords({
    evaluations: [evaluation],
    outcomeRunId: overrides.outcomeRunId ?? 'terminal-return-run:test',
    now: overrides.now ?? TERMINAL_RETURN_NOW,
  })[0]!;
