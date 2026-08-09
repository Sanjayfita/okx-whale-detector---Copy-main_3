import {
  evaluateReleaseQualificationPolicy,
  type ReleaseQualificationDecision,
} from '../safety/releaseQualificationPolicy';
import {
  createUnifiedSafetyEvidenceBundle,
  type SafetyEvidenceItem,
} from '../safety/unifiedSafetyEvidenceBundle';

export interface ReleaseQualificationSimulationResult {
  qualified: ReleaseQualificationDecision;
  incomplete: ReleaseQualificationDecision;
  blocked: ReleaseQualificationDecision;
  deterministic: boolean;
  testnetExecutionAuthorized: false;
  orderExecutionAuthorized: false;
}

const evidence = (
  source: SafetyEvidenceItem['source'],
  state: SafetyEvidenceItem['state'] = 'PASS',
): SafetyEvidenceItem =>
  Object.freeze({
    source,
    generatedAt: 900,
    state,
    summary: `${source} deterministic simulation evidence`,
    reasons: Object.freeze(['deterministic qualification simulation']),
  });

const completeEvidence = (): SafetyEvidenceItem[] => [
  evidence('LIVE_TRADING_READINESS'),
  evidence('READINESS_TREND'),
  evidence('PAPER_TRADING_RISK'),
  evidence('RUNTIME_HEALTH'),
  evidence('RECORDING_INTEGRITY'),
];

const runScenarios = () => {
  const readyBundle = createUnifiedSafetyEvidenceBundle({
    generatedAt: 1_000,
    evidence: completeEvidence(),
  });
  const incompleteBundle = createUnifiedSafetyEvidenceBundle({
    generatedAt: 1_000,
    evidence: completeEvidence().slice(0, 4),
  });
  const blockedEvidence = completeEvidence();
  blockedEvidence[3] = evidence('RUNTIME_HEALTH', 'FAIL');
  const blockedBundle = createUnifiedSafetyEvidenceBundle({
    generatedAt: 1_000,
    evidence: blockedEvidence,
  });

  return Object.freeze({
    qualified: evaluateReleaseQualificationPolicy({
      evidenceBundle: readyBundle,
      manualReviewerAssigned: true,
      rollbackPlanDocumented: true,
      testnetEnvironmentIsolated: true,
      productionCredentialsAbsent: true,
    }),
    incomplete: evaluateReleaseQualificationPolicy({
      evidenceBundle: incompleteBundle,
      manualReviewerAssigned: true,
      rollbackPlanDocumented: false,
      testnetEnvironmentIsolated: true,
      productionCredentialsAbsent: true,
    }),
    blocked: evaluateReleaseQualificationPolicy({
      evidenceBundle: blockedBundle,
      manualReviewerAssigned: true,
      rollbackPlanDocumented: true,
      testnetEnvironmentIsolated: true,
      productionCredentialsAbsent: true,
    }),
  });
};

export const simulateReleaseQualification = (): ReleaseQualificationSimulationResult => {
  const first = runScenarios();
  const second = runScenarios();
  const deterministic = JSON.stringify(first) === JSON.stringify(second);

  if (first.qualified.outcome !== 'QUALIFIED_FOR_TESTNET_REVIEW') {
    throw new Error('Qualified scenario did not reach testnet review');
  }
  if (first.incomplete.outcome !== 'MORE_EVIDENCE_REQUIRED') {
    throw new Error('Incomplete scenario did not require more evidence');
  }
  if (first.blocked.outcome !== 'BLOCKED') {
    throw new Error('Blocked scenario did not remain blocked');
  }
  if (!deterministic) {
    throw new Error('Release qualification simulation was not deterministic');
  }

  return Object.freeze({
    ...first,
    deterministic,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};

export const runSimulateReleaseQualificationCli = (
  log: (message: string) => void = console.log,
): number => {
  try {
    const result = simulateReleaseQualification();
    log('RELEASE QUALIFICATION SIMULATION');
    log(`Qualified scenario: ${result.qualified.outcome}`);
    log(`Incomplete scenario: ${result.incomplete.outcome}`);
    log(`Blocked scenario: ${result.blocked.outcome}`);
    log(`Deterministic: ${result.deterministic}`);
    log(`Testnet execution authorized: ${result.testnetExecutionAuthorized}`);
    log(`Order execution authorized: ${result.orderExecutionAuthorized}`);
    return 0;
  } catch (cause) {
    console.error(
      `Release qualification simulation failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 1;
  }
};

if (require.main === module) {
  process.exitCode = runSimulateReleaseQualificationCli();
}
