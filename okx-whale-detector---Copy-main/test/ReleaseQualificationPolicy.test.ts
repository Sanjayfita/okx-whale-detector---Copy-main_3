import { describe, expect, it } from 'vitest';

import { evaluateReleaseQualificationPolicy } from '../src/safety/releaseQualificationPolicy';
import {
  createUnifiedSafetyEvidenceBundle,
  type SafetyEvidenceItem,
} from '../src/safety/unifiedSafetyEvidenceBundle';

const evidence = (
  source: SafetyEvidenceItem['source'],
  state: SafetyEvidenceItem['state'] = 'PASS',
): SafetyEvidenceItem => ({
  source,
  generatedAt: 900,
  state,
  summary: `${source} evidence`,
  reasons: ['deterministic test evidence'],
});

const passingBundle = () =>
  createUnifiedSafetyEvidenceBundle({
    generatedAt: 1_000,
    evidence: [
      evidence('LIVE_TRADING_READINESS'),
      evidence('READINESS_TREND'),
      evidence('PAPER_TRADING_RISK'),
      evidence('RUNTIME_HEALTH'),
      evidence('RECORDING_INTEGRITY'),
    ],
  });

const completePolicyInput = () => ({
  evidenceBundle: passingBundle(),
  manualReviewerAssigned: true,
  rollbackPlanDocumented: true,
  testnetEnvironmentIsolated: true,
  productionCredentialsAbsent: true,
});

describe('evaluateReleaseQualificationPolicy', () => {
  it('qualifies complete evidence for manual testnet review only', () => {
    const decision = evaluateReleaseQualificationPolicy(completePolicyInput());

    expect(decision.outcome).toBe('QUALIFIED_FOR_TESTNET_REVIEW');
    expect(decision.completedPolicyChecks).toBe(4);
    expect(decision.missingPolicyChecks).toEqual([]);
    expect(decision.testnetExecutionAuthorized).toBe(false);
    expect(decision.orderExecutionAuthorized).toBe(false);
  });

  it('requires more evidence when a policy check is missing', () => {
    const input = completePolicyInput();
    input.rollbackPlanDocumented = false;

    const decision = evaluateReleaseQualificationPolicy(input);

    expect(decision.outcome).toBe('MORE_EVIDENCE_REQUIRED');
    expect(decision.completedPolicyChecks).toBe(3);
    expect(decision.missingPolicyChecks).toEqual(['rollbackPlanDocumented']);
    expect(decision.orderExecutionAuthorized).toBe(false);
  });

  it('requires more evidence when the bundle is incomplete', () => {
    const decision = evaluateReleaseQualificationPolicy({
      ...completePolicyInput(),
      evidenceBundle: createUnifiedSafetyEvidenceBundle({
        generatedAt: 1_000,
        evidence: [evidence('LIVE_TRADING_READINESS')],
      }),
    });

    expect(decision.outcome).toBe('MORE_EVIDENCE_REQUIRED');
    expect(decision.evidenceStatus).toBe('MORE_EVIDENCE_REQUIRED');
  });

  it('blocks qualification when unified evidence is blocked', () => {
    const decision = evaluateReleaseQualificationPolicy({
      ...completePolicyInput(),
      evidenceBundle: createUnifiedSafetyEvidenceBundle({
        generatedAt: 1_000,
        evidence: [
          evidence('LIVE_TRADING_READINESS'),
          evidence('READINESS_TREND'),
          evidence('PAPER_TRADING_RISK'),
          evidence('RUNTIME_HEALTH', 'FAIL'),
          evidence('RECORDING_INTEGRITY'),
        ],
      }),
    });

    expect(decision.outcome).toBe('BLOCKED');
    expect(decision.reasons).toContain(
      'Unified safety evidence contains a blocking failure',
    );
    expect(decision.testnetExecutionAuthorized).toBe(false);
    expect(decision.orderExecutionAuthorized).toBe(false);
  });
});
