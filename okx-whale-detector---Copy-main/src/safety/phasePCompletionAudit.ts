export type PhasePCompletionAuditStatus = 'COMPLETE' | 'INCOMPLETE';

export interface PhasePCompletionAuditInput {
  readinessGatePresent: boolean;
  readinessPersistencePresent: boolean;
  readinessTrendPresent: boolean;
  unifiedEvidencePresent: boolean;
  releaseQualificationPresent: boolean;
  testnetArchitectureReviewPresent: boolean;
  humanApprovalCheckpointPresent: boolean;
  testnetIntentPresent: boolean;
  testnetIntentPersistencePresent: boolean;
  testnetIntentComparisonPresent: boolean;
  testnetIntentTrendPresent: boolean;
  testnetIntentTrendPersistencePresent: boolean;
  testnetIntentTrendComparisonPresent: boolean;
  deterministicSimulationsPresent: boolean;
}

export interface PhasePCompletionAuditResult {
  status: PhasePCompletionAuditStatus;
  completedChecks: number;
  totalChecks: number;
  missingChecks: readonly string[];
  reasons: readonly string[];
  dryRunOnly: true;
  transportDispatchAllowed: false;
  testnetExecutionAuthorized: false;
  orderExecutionAuthorized: false;
}

const CHECKS: ReadonlyArray<readonly [keyof PhasePCompletionAuditInput, string]> =
  Object.freeze([
    ['readinessGatePresent', 'readiness gate'],
    ['readinessPersistencePresent', 'readiness persistence'],
    ['readinessTrendPresent', 'readiness trend analysis'],
    ['unifiedEvidencePresent', 'unified safety evidence'],
    ['releaseQualificationPresent', 'release qualification policy'],
    ['testnetArchitectureReviewPresent', 'testnet architecture review'],
    ['humanApprovalCheckpointPresent', 'human approval checkpoint'],
    ['testnetIntentPresent', 'testnet order intent'],
    ['testnetIntentPersistencePresent', 'testnet order intent persistence'],
    ['testnetIntentComparisonPresent', 'testnet order intent comparison'],
    ['testnetIntentTrendPresent', 'testnet order intent trend'],
    ['testnetIntentTrendPersistencePresent', 'testnet order intent trend persistence'],
    ['testnetIntentTrendComparisonPresent', 'testnet order intent trend comparison'],
    ['deterministicSimulationsPresent', 'deterministic simulations'],
  ]);

export const runPhasePCompletionAudit = (
  input: PhasePCompletionAuditInput,
): PhasePCompletionAuditResult => {
  const missingChecks = CHECKS.filter(([key]) => !input[key]).map(([, label]) => label);
  const totalChecks = CHECKS.length;
  const completedChecks = totalChecks - missingChecks.length;
  const status: PhasePCompletionAuditStatus =
    missingChecks.length === 0 ? 'COMPLETE' : 'INCOMPLETE';
  const reasons =
    status === 'COMPLETE'
      ? [
          'All Phase P safety, qualification, dry-run intent, persistence, comparison, trend, and simulation capabilities are present',
          'Completion does not authorize testnet or live order execution',
        ]
      : [
          `Phase P is missing ${missingChecks.length} required capability or capabilities`,
          'Completion audit must remain incomplete until every required capability is present',
          'Completion does not authorize testnet or live order execution',
        ];

  return Object.freeze({
    status,
    completedChecks,
    totalChecks,
    missingChecks: Object.freeze(missingChecks),
    reasons: Object.freeze(reasons),
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};
