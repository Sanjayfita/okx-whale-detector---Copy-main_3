import { createHash } from 'node:crypto';

import type {
  AlertAlignmentEvaluationAlertContext,
  AlertAlignmentEvaluationAlertIdentity,
  AlertAlignmentEvaluationInstrument,
  AlertAlignmentEvaluationProvenance,
  AlertAlignmentEvaluationReference,
} from './alertAlignmentEvaluation';
import type {
  AlignmentCompleteness,
  AlignmentReason,
  PriceSource,
} from './alignmentTypes';
import { canonicalJsonStringify } from './canonicalJson';

export const ALERT_TERMINAL_RETURN_RECORD_TYPE = 'alertTerminalReturn' as const;
export const ALERT_TERMINAL_RETURN_SCHEMA_VERSION = 1 as const;
export const TERMINAL_RETURN_EVALUATOR_VERSION =
  'terminal-return-evaluator-v1' as const;
export const TERMINAL_RETURN_POLICY_VERSION =
  'terminal-return-policy-v1' as const;

export enum TerminalReturnReason {
  ALIGNMENT_MISSING = 'ALIGNMENT_MISSING',
  ALIGNMENT_PARTIAL = 'ALIGNMENT_PARTIAL',
  ALIGNMENT_AMBIGUOUS = 'ALIGNMENT_AMBIGUOUS',
  ALIGNMENT_INVALID = 'ALIGNMENT_INVALID',
  REFERENCE_PRICE_MISSING = 'REFERENCE_PRICE_MISSING',
  REFERENCE_PRICE_INVALID = 'REFERENCE_PRICE_INVALID',
  TERMINAL_PRICE_MISSING = 'TERMINAL_PRICE_MISSING',
  TERMINAL_PRICE_INVALID = 'TERMINAL_PRICE_INVALID',
  REFERENCE_BID_ASK_MISSING = 'REFERENCE_BID_ASK_MISSING',
  REFERENCE_BOOK_CROSSED = 'REFERENCE_BOOK_CROSSED',
  TERMINAL_BID_ASK_MISSING = 'TERMINAL_BID_ASK_MISSING',
  TERMINAL_BOOK_CROSSED = 'TERMINAL_BOOK_CROSSED',
  OKX_BIAS_NEUTRAL = 'OKX_BIAS_NEUTRAL',
  EXTERNAL_BIAS_NEUTRAL = 'EXTERNAL_BIAS_NEUTRAL',
  OKX_BIAS_MISSING = 'OKX_BIAS_MISSING',
  EXTERNAL_BIAS_MISSING = 'EXTERNAL_BIAS_MISSING',
  DIRECTION_UNSUPPORTED = 'DIRECTION_UNSUPPORTED',
  NON_FINITE_RESULT = 'NON_FINITE_RESULT',
  POLICY_INELIGIBLE = 'POLICY_INELIGIBLE',
}

export type TerminalReturnEligibility = 'ELIGIBLE' | 'INELIGIBLE' | 'AMBIGUOUS';

export interface TerminalReturnFloatingPointPolicy {
  storage: 'FULL_JAVASCRIPT_NUMBER';
  absoluteTolerance: number;
  relativeTolerance: number;
}

export interface TerminalReturnPolicyV1 {
  version: typeof TERMINAL_RETURN_POLICY_VERSION;
  fingerprint: string;
  directionalBasis: 'OKX_AND_EXTERNAL_SEPARATE';
  executablePricePolicy: 'REFERENCE_ASK_TO_TERMINAL_BID_OR_REFERENCE_BID_TO_TERMINAL_ASK';
  incompleteEligibility: 'COMPLETE_ONLY';
  ambiguousEligibility: 'INELIGIBLE';
  neutralBiasHandling: 'OMIT_DIRECTIONAL_METRIC';
  zeroReferencePolicy: 'INVALID';
  floatingPointPolicy: TerminalReturnFloatingPointPolicy;
}

export interface TerminalReturnPolicyInput {
  floatingPointPolicy?: Partial<TerminalReturnFloatingPointPolicy>;
}

export interface ExecutableDirectionalReturn {
  bias: 'BULLISH' | 'BEARISH';
  entryPrice: number;
  exitPrice: number;
  rawReturn: number;
  rawReturnPercent: number;
  directionalReturn: number;
  directionalReturnPercent: number;
}

export interface TerminalReturnCell {
  horizonMs: number;
  source: PriceSource;
  alignmentCompleteness: AlignmentCompleteness;
  eligibility: TerminalReturnEligibility;
  sourceAlignmentReasons: readonly AlignmentReason[];
  reasons: readonly TerminalReturnReason[];
  rawPriceBasis:
    | 'CAPTURED_MIDPOINT_TO_TERMINAL_MIDPOINT'
    | 'CAPTURED_MIDPOINT_TO_TERMINAL_CANDLE_CLOSE'
    | null;
  referencePrice: number | null;
  terminalPrice: number | null;
  rawReturn: number | null;
  rawReturnPercent: number | null;
  okxDirectionalReturn: number | null;
  okxDirectionalReturnPercent: number | null;
  externalDirectionalReturn: number | null;
  externalDirectionalReturnPercent: number | null;
  okxExecutable: ExecutableDirectionalReturn | null;
  externalExecutable: ExecutableDirectionalReturn | null;
  observationTimestamp: number | null;
  availabilityTimestamp: number | null;
}

export interface AlertTerminalReturnProvenance {
  sourceEvaluationSchemaVersion: 1;
  sourceEvaluationRunId: string;
  sourceAlignmentEvaluatorVersion: string;
  sourceAlignmentConfigurationFingerprint: string;
  horizonsMs: readonly number[];
  requestedSources: readonly PriceSource[];
  alertProvenance: AlertAlignmentEvaluationProvenance['alertProvenance'];
  marketRecordingFormat: AlertAlignmentEvaluationProvenance['marketRecordingFormat'];
  marketSourceSessionId: string | null;
  recordingId: string | null;
  recordingTermination: AlertAlignmentEvaluationProvenance['recordingTermination'];
}

export interface AlertTerminalReturnRecord {
  recordType: typeof ALERT_TERMINAL_RETURN_RECORD_TYPE;
  schemaVersion: typeof ALERT_TERMINAL_RETURN_SCHEMA_VERSION;
  recordedAt: number;
  outcomeId: string;
  outcomeRunId: string;
  sourceEvaluationId: string;
  evaluatorVersion: typeof TERMINAL_RETURN_EVALUATOR_VERSION;
  returnPolicy: TerminalReturnPolicyV1;
  alertIdentity: AlertAlignmentEvaluationAlertIdentity;
  instrument: AlertAlignmentEvaluationInstrument;
  alertContext: AlertAlignmentEvaluationAlertContext;
  reference: AlertAlignmentEvaluationReference | null;
  provenance: AlertTerminalReturnProvenance;
  returns: readonly TerminalReturnCell[];
}

const DEFAULT_FLOATING_POINT_POLICY =
  Object.freeze<TerminalReturnFloatingPointPolicy>({
    storage: 'FULL_JAVASCRIPT_NUMBER',
    absoluteTolerance: 1e-12,
    relativeTolerance: 1e-12,
  });

const policyMaterial = (
  policy: Omit<TerminalReturnPolicyV1, 'fingerprint'>,
): unknown => policy;

export const createTerminalReturnPolicy = (
  input: TerminalReturnPolicyInput = {},
): TerminalReturnPolicyV1 => {
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
    throw new Error('Terminal-return tolerances must be non-negative');
  }

  const material = {
    version: TERMINAL_RETURN_POLICY_VERSION,
    directionalBasis: 'OKX_AND_EXTERNAL_SEPARATE' as const,
    executablePricePolicy:
      'REFERENCE_ASK_TO_TERMINAL_BID_OR_REFERENCE_BID_TO_TERMINAL_ASK' as const,
    incompleteEligibility: 'COMPLETE_ONLY' as const,
    ambiguousEligibility: 'INELIGIBLE' as const,
    neutralBiasHandling: 'OMIT_DIRECTIONAL_METRIC' as const,
    zeroReferencePolicy: 'INVALID' as const,
    floatingPointPolicy: Object.freeze(floatingPointPolicy),
  };
  const fingerprint = createHash('sha256')
    .update(canonicalJsonStringify(policyMaterial(material)))
    .digest('hex');

  return Object.freeze({ ...material, fingerprint });
};

export const verifyTerminalReturnPolicyFingerprint = (
  policy: TerminalReturnPolicyV1,
): boolean => {
  try {
    return (
      createTerminalReturnPolicy({
        floatingPointPolicy: policy.floatingPointPolicy,
      }).fingerprint === policy.fingerprint &&
      policy.version === TERMINAL_RETURN_POLICY_VERSION &&
      policy.directionalBasis === 'OKX_AND_EXTERNAL_SEPARATE' &&
      policy.executablePricePolicy ===
        'REFERENCE_ASK_TO_TERMINAL_BID_OR_REFERENCE_BID_TO_TERMINAL_ASK' &&
      policy.incompleteEligibility === 'COMPLETE_ONLY' &&
      policy.ambiguousEligibility === 'INELIGIBLE' &&
      policy.neutralBiasHandling === 'OMIT_DIRECTIONAL_METRIC' &&
      policy.zeroReferencePolicy === 'INVALID'
    );
  } catch {
    return false;
  }
};

export const createTerminalReturnOutcomeId = (input: {
  sourceEvaluationId: string;
  policyFingerprint: string;
}): string => {
  const digest = createHash('sha256')
    .update(
      canonicalJsonStringify({
        sourceEvaluationId: input.sourceEvaluationId,
        policyFingerprint: input.policyFingerprint,
        schemaVersion: ALERT_TERMINAL_RETURN_SCHEMA_VERSION,
        evaluatorVersion: TERMINAL_RETURN_EVALUATOR_VERSION,
      }),
    )
    .digest('hex');
  return `alert-terminal-return:${digest}`;
};

export const isOutcomeRunId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);

export const compareTerminalReturnRecords = (
  left: AlertTerminalReturnRecord,
  right: AlertTerminalReturnRecord,
): number =>
  (left.reference?.referenceTimestamp ?? Number.MAX_SAFE_INTEGER) -
    (right.reference?.referenceTimestamp ?? Number.MAX_SAFE_INTEGER) ||
  left.alertIdentity.alertId.localeCompare(right.alertIdentity.alertId) ||
  left.sourceEvaluationId.localeCompare(right.sourceEvaluationId) ||
  left.returnPolicy.fingerprint.localeCompare(right.returnPolicy.fingerprint);
