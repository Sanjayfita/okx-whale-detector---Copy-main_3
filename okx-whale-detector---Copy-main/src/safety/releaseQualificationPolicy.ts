import type { UnifiedSafetyEvidenceBundle } from './unifiedSafetyEvidenceBundle';

export type ReleaseQualificationOutcome =
  | 'BLOCKED'
  | 'MORE_EVIDENCE_REQUIRED'
  | 'QUALIFIED_FOR_TESTNET_REVIEW';

export interface ReleaseQualificationPolicyInput {
  evidenceBundle: UnifiedSafetyEvidenceBundle;
  manualReviewerAssigned: boolean;
  rollbackPlanDocumented: boolean;
  testnetEnvironmentIsolated: boolean;
  productionCredentialsAbsent: boolean;
}

export interface ReleaseQualificationDecision {
  outcome: ReleaseQualificationOutcome;
  evidenceStatus: UnifiedSafetyEvidenceBundle['status'];
  completedPolicyChecks: number;
  totalPolicyChecks: number;
  missingPolicyChecks: readonly string[];
  reasons: readonly string[];
  testnetExecutionAuthorized: false;
  orderExecutionAuthorized: false;
}

const POLICY_CHECKS = Object.freeze([
  'manualReviewerAssigned',
  'rollbackPlanDocumented',
  'testnetEnvironmentIsolated',
  'productionCredentialsAbsent',
] as const);

type PolicyCheck = (typeof POLICY_CHECKS)[number];

export const evaluateReleaseQualificationPolicy = (
  input: ReleaseQualificationPolicyInput,
): ReleaseQualificationDecision => {
  const missingPolicyChecks = POLICY_CHECKS.filter((check) => !input[check]);
  const completedPolicyChecks = POLICY_CHECKS.length - missingPolicyChecks.length;
  const reasons: string[] = [];
  let outcome: ReleaseQualificationOutcome;

  if (input.evidenceBundle.status === 'BLOCKED') {
    outcome = 'BLOCKED';
    reasons.push('Unified safety evidence contains a blocking failure');
  } else if (
    input.evidenceBundle.status === 'MORE_EVIDENCE_REQUIRED' ||
    missingPolicyChecks.length > 0
  ) {
    outcome = 'MORE_EVIDENCE_REQUIRED';
    reasons.push('Qualification evidence or required review controls are incomplete');
  } else {
    outcome = 'QUALIFIED_FOR_TESTNET_REVIEW';
    reasons.push('Safety evidence and review controls are ready for manual testnet review');
  }

  for (const check of missingPolicyChecks) {
    reasons.push(`Missing release qualification check: ${check}`);
  }

  reasons.push('Qualification never authorizes testnet or real-order execution');

  return Object.freeze({
    outcome,
    evidenceStatus: input.evidenceBundle.status,
    completedPolicyChecks,
    totalPolicyChecks: POLICY_CHECKS.length,
    missingPolicyChecks: Object.freeze([...missingPolicyChecks] as PolicyCheck[]),
    reasons: Object.freeze(reasons),
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};
