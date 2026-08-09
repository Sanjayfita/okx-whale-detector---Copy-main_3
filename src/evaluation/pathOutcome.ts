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
import type { TerminalReturnReason } from './terminalReturn';

export const ALERT_PATH_OUTCOME_RECORD_TYPE = 'alertPathOutcome' as const;
export const ALERT_PATH_OUTCOME_SCHEMA_VERSION = 1 as const;
export const PATH_OUTCOME_EVALUATOR_VERSION =
  'path-outcome-evaluator-v1' as const;
export const PATH_OUTCOME_POLICY_VERSION = 'path-outcome-policy-v1' as const;

export enum PathOutcomeReason {
  ALIGNMENT_MISSING = 'ALIGNMENT_MISSING',
  ALIGNMENT_PARTIAL = 'ALIGNMENT_PARTIAL',
  ALIGNMENT_AMBIGUOUS = 'ALIGNMENT_AMBIGUOUS',
  ALIGNMENT_INVALID = 'ALIGNMENT_INVALID',
  NO_PATH_SAMPLES = 'NO_PATH_SAMPLES',
  PATH_GAP_INTERSECTION = 'PATH_GAP_INTERSECTION',
  RECORDING_TRUNCATED = 'RECORDING_TRUNCATED',
  RECORDING_ENDED_BEFORE_HORIZON = 'RECORDING_ENDED_BEFORE_HORIZON',
  REFERENCE_PRICE_MISSING = 'REFERENCE_PRICE_MISSING',
  REFERENCE_PRICE_INVALID = 'REFERENCE_PRICE_INVALID',
  REFERENCE_BID_ASK_MISSING = 'REFERENCE_BID_ASK_MISSING',
  REFERENCE_BOOK_CROSSED = 'REFERENCE_BOOK_CROSSED',
  PATH_SAMPLE_INVALID = 'PATH_SAMPLE_INVALID',
  PATH_SAMPLE_UNAVAILABLE = 'PATH_SAMPLE_UNAVAILABLE',
  CANDLE_PARTIAL_ALERT_INTERVAL = 'CANDLE_PARTIAL_ALERT_INTERVAL',
  CANDLE_CONFLICTING_DUPLICATE = 'CANDLE_CONFLICTING_DUPLICATE',
  CANDLE_INTERVAL_MISSING = 'CANDLE_INTERVAL_MISSING',
  OKX_BIAS_NEUTRAL = 'OKX_BIAS_NEUTRAL',
  EXTERNAL_BIAS_NEUTRAL = 'EXTERNAL_BIAS_NEUTRAL',
  OKX_BIAS_MISSING = 'OKX_BIAS_MISSING',
  EXTERNAL_BIAS_MISSING = 'EXTERNAL_BIAS_MISSING',
  NON_FINITE_RESULT = 'NON_FINITE_RESULT',
  POLICY_INELIGIBLE = 'POLICY_INELIGIBLE',
  SOURCE_EVALUATION_MISMATCH = 'SOURCE_EVALUATION_MISMATCH',
  SOURCE_RETURN_MISMATCH = 'SOURCE_RETURN_MISMATCH',
  MARKET_RECORDING_MISMATCH = 'MARKET_RECORDING_MISMATCH',
}

export type PathOutcomeEligibility = 'ELIGIBLE' | 'INELIGIBLE' | 'AMBIGUOUS';

export interface PathOutcomeFloatingPointPolicy {
  storage: 'FULL_JAVASCRIPT_NUMBER';
  absoluteTolerance: number;
  relativeTolerance: number;
}

export interface PathOutcomePolicyV1 {
  version: typeof PATH_OUTCOME_POLICY_VERSION;
  fingerprint: string;
  pathStartPolicy: 'CAPTURED_REFERENCE_TIMESTAMP_INCLUSIVE';
  pathEndPolicy: 'REFERENCE_PLUS_HORIZON_INCLUSIVE';
  sourcePolicies: {
    orderBook: 'SYNCHRONIZED_SAMPLES_ONLY';
    candle: 'FULLY_POST_ALERT_CONFIRMED_1M_BOUNDS_ONLY';
    fallback: 'NONE';
  };
  incompleteEligibility: 'COMPLETE_ONLY';
  gapPolicy: 'ANY_INTERSECTING_BOOK_GAP_INELIGIBLE';
  truncationPolicy: 'REQUIRE_RECORDING_COVERAGE_THROUGH_HORIZON';
  candleBoundPolicy: 'OHLC_BOUNDS_ORDER_UNKNOWN';
  tieBreakingPolicy: 'EARLIEST_EVENT_THEN_AVAILABILITY_THEN_ORDINAL';
  neutralBiasBehavior: 'OMIT_DIRECTIONAL_METRIC';
  floatingPointPolicy: PathOutcomeFloatingPointPolicy;
}

export interface PathOutcomePolicyInput {
  floatingPointPolicy?: Partial<PathOutcomeFloatingPointPolicy>;
}

export interface PathExcursionOutcome {
  favorableExcursion: number;
  favorableExcursionPercent: number;
  adverseExcursion: number;
  adverseExcursionPercent: number;
  timeToFavorableMs: number;
  timeToAdverseMs: number;
  favorablePrice: number;
  adversePrice: number;
  favorableTimestamp: number;
  adverseTimestamp: number;
}

export interface DirectionalPathOutcome extends PathExcursionOutcome {
  bias: 'BULLISH' | 'BEARISH';
}

export interface ExecutablePathOutcome extends PathExcursionOutcome {
  bias: 'BULLISH' | 'BEARISH';
  entryPrice: number;
  favorableExitPrice: number;
  adverseExitPrice: number;
  pricePolicy:
    'REFERENCE_ASK_TO_OBSERVED_BID' | 'REFERENCE_BID_TO_OBSERVED_ASK';
}

export interface CandlePathBounds {
  bias: 'BULLISH' | 'BEARISH';
  favorableBound: number;
  adverseBound: number;
  favorableBoundPercent: number;
  adverseBoundPercent: number;
  favorablePrice: number;
  adversePrice: number;
  favorableCandleStart: number;
  adverseCandleStart: number;
  orderingKnown: false;
}

export interface DirectionalCandlePathBounds {
  okx: CandlePathBounds | null;
  external: CandlePathBounds | null;
}

export interface PathOutcomeCell {
  horizonMs: number;
  source: PriceSource;
  alignmentCompleteness: AlignmentCompleteness;
  eligibility: PathOutcomeEligibility;
  sourceAlignmentReasons: readonly AlignmentReason[];
  sourceTerminalReturnReasons: readonly TerminalReturnReason[];
  reasons: readonly PathOutcomeReason[];
  pathStartTimestamp: number | null;
  pathEndTimestamp: number | null;
  sampleCount: number;
  firstSampleTimestamp: number | null;
  lastSampleTimestamp: number | null;
  raw: PathExcursionOutcome | null;
  okxDirectional: DirectionalPathOutcome | null;
  externalDirectional: DirectionalPathOutcome | null;
  executableOkx: ExecutablePathOutcome | null;
  executableExternal: ExecutablePathOutcome | null;
  candleBounds: DirectionalCandlePathBounds | null;
  validityGaps: readonly ValidityInterval[];
}

export interface AlertPathOutcomeProvenance {
  sourceEvaluationSchemaVersion: 1;
  sourceEvaluationRunId: string;
  sourceTerminalReturnSchemaVersion: 1 | null;
  sourceTerminalReturnRunId: string | null;
  sourceAlignmentConfigurationFingerprint: string;
  sourceTerminalReturnPolicyFingerprint: string | null;
  horizonsMs: readonly number[];
  requestedSources: readonly PriceSource[];
  marketSourceSessionId: string | null;
  recordingId: string | null;
  recordingTermination: 'CLEAN' | 'TRUNCATED' | 'LEGACY_UNVERIFIED' | 'INVALID';
}

export interface AlertPathOutcomeRecord {
  recordType: typeof ALERT_PATH_OUTCOME_RECORD_TYPE;
  schemaVersion: typeof ALERT_PATH_OUTCOME_SCHEMA_VERSION;
  recordedAt: number;
  pathOutcomeId: string;
  pathOutcomeRunId: string;
  sourceEvaluationId: string;
  sourceTerminalReturnId: string | null;
  evaluatorVersion: typeof PATH_OUTCOME_EVALUATOR_VERSION;
  policy: PathOutcomePolicyV1;
  alertIdentity: AlertAlignmentEvaluationAlertIdentity;
  instrument: AlertAlignmentEvaluationInstrument;
  alertContext: AlertAlignmentEvaluationAlertContext;
  reference: AlertAlignmentEvaluationReference | null;
  provenance: AlertPathOutcomeProvenance;
  paths: readonly PathOutcomeCell[];
}

const DEFAULT_FLOATING_POINT_POLICY =
  Object.freeze<PathOutcomeFloatingPointPolicy>({
    storage: 'FULL_JAVASCRIPT_NUMBER',
    absoluteTolerance: 1e-12,
    relativeTolerance: 1e-12,
  });

export const createPathOutcomePolicy = (
  input: PathOutcomePolicyInput = {},
): PathOutcomePolicyV1 => {
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
    throw new Error('Path-outcome tolerances must be non-negative');
  }
  const material = {
    version: PATH_OUTCOME_POLICY_VERSION,
    pathStartPolicy: 'CAPTURED_REFERENCE_TIMESTAMP_INCLUSIVE' as const,
    pathEndPolicy: 'REFERENCE_PLUS_HORIZON_INCLUSIVE' as const,
    sourcePolicies: Object.freeze({
      orderBook: 'SYNCHRONIZED_SAMPLES_ONLY' as const,
      candle: 'FULLY_POST_ALERT_CONFIRMED_1M_BOUNDS_ONLY' as const,
      fallback: 'NONE' as const,
    }),
    incompleteEligibility: 'COMPLETE_ONLY' as const,
    gapPolicy: 'ANY_INTERSECTING_BOOK_GAP_INELIGIBLE' as const,
    truncationPolicy: 'REQUIRE_RECORDING_COVERAGE_THROUGH_HORIZON' as const,
    candleBoundPolicy: 'OHLC_BOUNDS_ORDER_UNKNOWN' as const,
    tieBreakingPolicy: 'EARLIEST_EVENT_THEN_AVAILABILITY_THEN_ORDINAL' as const,
    neutralBiasBehavior: 'OMIT_DIRECTIONAL_METRIC' as const,
    floatingPointPolicy: Object.freeze(floatingPointPolicy),
  };
  const fingerprint = createHash('sha256')
    .update(canonicalJsonStringify(material))
    .digest('hex');
  return Object.freeze({ ...material, fingerprint });
};

export const verifyPathOutcomePolicyFingerprint = (
  policy: PathOutcomePolicyV1,
): boolean => {
  try {
    const expected = createPathOutcomePolicy({
      floatingPointPolicy: policy.floatingPointPolicy,
    });
    return canonicalJsonStringify(expected) === canonicalJsonStringify(policy);
  } catch {
    return false;
  }
};

export const createPathOutcomeId = (input: {
  sourceEvaluationId: string;
  sourceTerminalReturnId: string | null;
  policyFingerprint: string;
}): string => {
  const digest = createHash('sha256')
    .update(
      canonicalJsonStringify({
        sourceEvaluationId: input.sourceEvaluationId,
        sourceTerminalReturnId: input.sourceTerminalReturnId,
        policyFingerprint: input.policyFingerprint,
        schemaVersion: ALERT_PATH_OUTCOME_SCHEMA_VERSION,
        evaluatorVersion: PATH_OUTCOME_EVALUATOR_VERSION,
      }),
    )
    .digest('hex');
  return `alert-path-outcome:${digest}`;
};

export const isPathOutcomeRunId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);

export const comparePathOutcomeRecords = (
  left: AlertPathOutcomeRecord,
  right: AlertPathOutcomeRecord,
): number =>
  (left.reference?.referenceTimestamp ?? Number.MAX_SAFE_INTEGER) -
    (right.reference?.referenceTimestamp ?? Number.MAX_SAFE_INTEGER) ||
  left.alertIdentity.alertId.localeCompare(right.alertIdentity.alertId) ||
  left.sourceEvaluationId.localeCompare(right.sourceEvaluationId) ||
  left.policy.fingerprint.localeCompare(right.policy.fingerprint);
