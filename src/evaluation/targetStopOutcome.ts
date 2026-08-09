import { createHash } from 'node:crypto';

import type {
  AlertAlignmentEvaluationAlertContext,
  AlertAlignmentEvaluationAlertIdentity,
  AlertAlignmentEvaluationInstrument,
  AlertAlignmentEvaluationReference,
} from './alertAlignmentEvaluation';
import type {
  AlignmentCompleteness,
  AlignmentReason,
  PriceSource,
  ValidityInterval,
} from './alignmentTypes';
import { canonicalJsonStringify } from './canonicalJson';
import type { PathOutcomeReason } from './pathOutcome';
import type { TerminalReturnReason } from './terminalReturn';

export const ALERT_TARGET_STOP_OUTCOME_RECORD_TYPE =
  'alertTargetStopOutcome' as const;
export const ALERT_TARGET_STOP_OUTCOME_SCHEMA_VERSION = 1 as const;
export const TARGET_STOP_EVALUATOR_VERSION =
  'target-stop-evaluator-v1' as const;
export const TARGET_STOP_POLICY_VERSION = 'target-stop-policy-v1' as const;

export enum TargetStopReason {
  ALIGNMENT_MISSING = 'ALIGNMENT_MISSING',
  ALIGNMENT_PARTIAL = 'ALIGNMENT_PARTIAL',
  ALIGNMENT_AMBIGUOUS = 'ALIGNMENT_AMBIGUOUS',
  ALIGNMENT_INVALID = 'ALIGNMENT_INVALID',
  PATH_OUTCOME_MISSING = 'PATH_OUTCOME_MISSING',
  PATH_OUTCOME_MISMATCH = 'PATH_OUTCOME_MISMATCH',
  TERMINAL_RETURN_MISMATCH = 'TERMINAL_RETURN_MISMATCH',
  MARKET_RECORDING_MISMATCH = 'MARKET_RECORDING_MISMATCH',
  REFERENCE_PRICE_MISSING = 'REFERENCE_PRICE_MISSING',
  REFERENCE_PRICE_INVALID = 'REFERENCE_PRICE_INVALID',
  REFERENCE_BID_ASK_MISSING = 'REFERENCE_BID_ASK_MISSING',
  REFERENCE_BOOK_CROSSED = 'REFERENCE_BOOK_CROSSED',
  TARGET_PERCENT_INVALID = 'TARGET_PERCENT_INVALID',
  STOP_PERCENT_INVALID = 'STOP_PERCENT_INVALID',
  TARGET_STOP_GEOMETRY_INVALID = 'TARGET_STOP_GEOMETRY_INVALID',
  NO_PATH_SAMPLES = 'NO_PATH_SAMPLES',
  PATH_GAP_INTERSECTION = 'PATH_GAP_INTERSECTION',
  RECORDING_TRUNCATED = 'RECORDING_TRUNCATED',
  RECORDING_ENDED_BEFORE_HORIZON = 'RECORDING_ENDED_BEFORE_HORIZON',
  TARGET_NOT_REACHED = 'TARGET_NOT_REACHED',
  STOP_NOT_REACHED = 'STOP_NOT_REACHED',
  TARGET_STOP_SAME_SAMPLE = 'TARGET_STOP_SAME_SAMPLE',
  TARGET_STOP_ORDER_AMBIGUOUS = 'TARGET_STOP_ORDER_AMBIGUOUS',
  CANDLE_PARTIAL_ALERT_INTERVAL = 'CANDLE_PARTIAL_ALERT_INTERVAL',
  CANDLE_CONFLICTING_DUPLICATE = 'CANDLE_CONFLICTING_DUPLICATE',
  CANDLE_INTERVAL_MISSING = 'CANDLE_INTERVAL_MISSING',
  OKX_BIAS_NEUTRAL = 'OKX_BIAS_NEUTRAL',
  EXTERNAL_BIAS_NEUTRAL = 'EXTERNAL_BIAS_NEUTRAL',
  OKX_BIAS_MISSING = 'OKX_BIAS_MISSING',
  EXTERNAL_BIAS_MISSING = 'EXTERNAL_BIAS_MISSING',
  PATH_SAMPLE_INVALID = 'PATH_SAMPLE_INVALID',
  PATH_SAMPLE_UNAVAILABLE = 'PATH_SAMPLE_UNAVAILABLE',
  NON_FINITE_RESULT = 'NON_FINITE_RESULT',
  POLICY_INELIGIBLE = 'POLICY_INELIGIBLE',
}

export type TargetStopEligibility = 'ELIGIBLE' | 'INELIGIBLE' | 'AMBIGUOUS';
export type TargetStopResult =
  | 'TARGET_FIRST'
  | 'STOP_FIRST'
  | 'NEITHER'
  | 'TIE'
  | 'AMBIGUOUS'
  | 'INELIGIBLE';
export type TargetStopOrderingPrecision =
  'EXACT_ORDER_BOOK' | 'COARSE_CANDLE' | 'NONE';

export interface TargetStopFloatingPointPolicy {
  storage: 'FULL_JAVASCRIPT_NUMBER';
  absoluteTolerance: number;
  relativeTolerance: number;
}

export interface TargetStopPolicyV1 {
  version: typeof TARGET_STOP_POLICY_VERSION;
  fingerprint: string;
  targetPercent: number;
  stopPercent: number;
  targetDefinition: 'DIRECTIONAL_PERCENT_FROM_CAPTURED_REFERENCE';
  stopDefinition: 'DIRECTIONAL_PERCENT_FROM_CAPTURED_REFERENCE';
  directionalBasis: 'OKX_AND_EXTERNAL_SEPARATE';
  executableTriggerPolicy: 'REFERENCE_ASK_OBSERVED_BID_OR_REFERENCE_BID_OBSERVED_ASK';
  gapPolicy: 'ANY_INTERSECTING_BOOK_GAP_INELIGIBLE';
  truncationPolicy: 'REQUIRE_COMPLETE_HORIZON_EVEN_AFTER_OBSERVED_HIT';
  candleAmbiguityPolicy: 'BOTH_CROSSED_SAME_CANDLE_AMBIGUOUS';
  tiePolicy: 'SAME_EXACT_SAMPLE_TIE';
  incompleteEligibility: 'COMPLETE_PATH_ONLY';
  floatingPointPolicy: TargetStopFloatingPointPolicy;
}

export interface TargetStopPolicyInput {
  targetPercent: number;
  stopPercent: number;
  floatingPointPolicy?: Partial<TargetStopFloatingPointPolicy>;
}

export interface DirectionalTargetStopResult {
  bias: 'BULLISH' | 'BEARISH';
  baselinePrice: number;
  targetPrice: number;
  stopPrice: number;
  result: TargetStopResult;
  targetHitTimestamp: number | null;
  stopHitTimestamp: number | null;
  firstHitTimestamp: number | null;
  firstHitAvailabilityTimestamp: number | null;
  firstHitRecordOrdinal: number | null;
  firstHitPrice: number | null;
  timeToTargetMs: number | null;
  timeToStopMs: number | null;
  timeToFirstHitMs: number | null;
  firstHitCandleStart: number | null;
  orderingPrecision: TargetStopOrderingPrecision;
}

export interface TargetStopCell {
  horizonMs: number;
  source: PriceSource;
  alignmentCompleteness: AlignmentCompleteness;
  eligibility: TargetStopEligibility;
  sourceAlignmentReasons: readonly AlignmentReason[];
  sourceTerminalReturnReasons: readonly TerminalReturnReason[];
  sourcePathOutcomeReasons: readonly PathOutcomeReason[];
  reasons: readonly TargetStopReason[];
  targetPercent: number;
  stopPercent: number;
  okx: DirectionalTargetStopResult | null;
  external: DirectionalTargetStopResult | null;
  executableOkx: DirectionalTargetStopResult | null;
  executableExternal: DirectionalTargetStopResult | null;
  candleOkx: DirectionalTargetStopResult | null;
  candleExternal: DirectionalTargetStopResult | null;
  validityGaps: readonly ValidityInterval[];
}

export interface AlertTargetStopOutcomeProvenance {
  sourceEvaluationSchemaVersion: 1;
  sourceTerminalReturnSchemaVersion: 1;
  sourcePathOutcomeSchemaVersion: 1;
  sourceEvaluationRunId: string;
  sourceTerminalReturnRunId: string;
  sourcePathOutcomeRunId: string;
  sourceAlignmentConfigurationFingerprint: string;
  sourceTerminalReturnPolicyFingerprint: string;
  sourcePathOutcomePolicyFingerprint: string;
  horizonsMs: readonly number[];
  requestedSources: readonly PriceSource[];
  marketSourceSessionId: string;
  recordingId: string;
  recordingTermination: 'CLEAN' | 'TRUNCATED';
}

export interface AlertTargetStopOutcomeRecord {
  recordType: typeof ALERT_TARGET_STOP_OUTCOME_RECORD_TYPE;
  schemaVersion: typeof ALERT_TARGET_STOP_OUTCOME_SCHEMA_VERSION;
  recordedAt: number;
  targetStopOutcomeId: string;
  targetStopRunId: string;
  sourceEvaluationId: string;
  sourceTerminalReturnId: string;
  sourcePathOutcomeId: string;
  evaluatorVersion: typeof TARGET_STOP_EVALUATOR_VERSION;
  policy: TargetStopPolicyV1;
  alertIdentity: AlertAlignmentEvaluationAlertIdentity;
  instrument: AlertAlignmentEvaluationInstrument;
  alertContext: AlertAlignmentEvaluationAlertContext;
  reference: AlertAlignmentEvaluationReference;
  provenance: AlertTargetStopOutcomeProvenance;
  outcomes: readonly TargetStopCell[];
}

const DEFAULT_FLOATING_POINT_POLICY =
  Object.freeze<TargetStopFloatingPointPolicy>({
    storage: 'FULL_JAVASCRIPT_NUMBER',
    absoluteTolerance: 1e-12,
    relativeTolerance: 1e-12,
  });

export const createTargetStopPolicy = (
  input: TargetStopPolicyInput,
): TargetStopPolicyV1 => {
  if (!Number.isFinite(input.targetPercent) || input.targetPercent <= 0) {
    throw new Error('targetPercent must be a positive finite percentage');
  }
  if (!Number.isFinite(input.stopPercent) || input.stopPercent <= 0) {
    throw new Error('stopPercent must be a positive finite percentage');
  }
  if (input.targetPercent >= 100 || input.stopPercent >= 100) {
    throw new Error('Target/stop geometry must remain within 100 percent');
  }
  const floatingPointPolicy = {
    ...DEFAULT_FLOATING_POINT_POLICY,
    ...input.floatingPointPolicy,
    storage: 'FULL_JAVASCRIPT_NUMBER' as const,
  };
  if (
    !Number.isFinite(floatingPointPolicy.absoluteTolerance) ||
    floatingPointPolicy.absoluteTolerance < 0 ||
    !Number.isFinite(floatingPointPolicy.relativeTolerance) ||
    floatingPointPolicy.relativeTolerance < 0
  ) {
    throw new Error('Target/stop tolerances must be non-negative');
  }
  const material = {
    version: TARGET_STOP_POLICY_VERSION,
    targetPercent: input.targetPercent,
    stopPercent: input.stopPercent,
    targetDefinition: 'DIRECTIONAL_PERCENT_FROM_CAPTURED_REFERENCE' as const,
    stopDefinition: 'DIRECTIONAL_PERCENT_FROM_CAPTURED_REFERENCE' as const,
    directionalBasis: 'OKX_AND_EXTERNAL_SEPARATE' as const,
    executableTriggerPolicy:
      'REFERENCE_ASK_OBSERVED_BID_OR_REFERENCE_BID_OBSERVED_ASK' as const,
    gapPolicy: 'ANY_INTERSECTING_BOOK_GAP_INELIGIBLE' as const,
    truncationPolicy:
      'REQUIRE_COMPLETE_HORIZON_EVEN_AFTER_OBSERVED_HIT' as const,
    candleAmbiguityPolicy: 'BOTH_CROSSED_SAME_CANDLE_AMBIGUOUS' as const,
    tiePolicy: 'SAME_EXACT_SAMPLE_TIE' as const,
    incompleteEligibility: 'COMPLETE_PATH_ONLY' as const,
    floatingPointPolicy: Object.freeze(floatingPointPolicy),
  };
  const fingerprint = createHash('sha256')
    .update(canonicalJsonStringify(material))
    .digest('hex');
  return Object.freeze({ ...material, fingerprint });
};

export const verifyTargetStopPolicyFingerprint = (
  policy: TargetStopPolicyV1,
): boolean => {
  try {
    return (
      canonicalJsonStringify(
        createTargetStopPolicy({
          targetPercent: policy.targetPercent,
          stopPercent: policy.stopPercent,
          floatingPointPolicy: policy.floatingPointPolicy,
        }),
      ) === canonicalJsonStringify(policy)
    );
  } catch {
    return false;
  }
};

export const createTargetStopOutcomeId = (input: {
  sourceEvaluationId: string;
  sourceTerminalReturnId: string;
  sourcePathOutcomeId: string;
  policyFingerprint: string;
}): string => {
  const digest = createHash('sha256')
    .update(
      canonicalJsonStringify({
        ...input,
        schemaVersion: ALERT_TARGET_STOP_OUTCOME_SCHEMA_VERSION,
        evaluatorVersion: TARGET_STOP_EVALUATOR_VERSION,
      }),
    )
    .digest('hex');
  return `alert-target-stop-outcome:${digest}`;
};

export const isTargetStopRunId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);

export const compareTargetStopOutcomeRecords = (
  left: AlertTargetStopOutcomeRecord,
  right: AlertTargetStopOutcomeRecord,
): number =>
  left.reference.referenceTimestamp - right.reference.referenceTimestamp ||
  left.alertIdentity.alertId.localeCompare(right.alertIdentity.alertId) ||
  left.sourceEvaluationId.localeCompare(right.sourceEvaluationId) ||
  left.policy.fingerprint.localeCompare(right.policy.fingerprint);
