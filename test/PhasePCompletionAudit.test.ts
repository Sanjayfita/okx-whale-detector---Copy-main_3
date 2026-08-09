import { describe, expect, it } from 'vitest';

import { runPhasePCompletionAudit } from '../src/safety/phasePCompletionAudit';

const completeInput = {
  readinessGatePresent: true,
  readinessPersistencePresent: true,
  readinessTrendPresent: true,
  unifiedEvidencePresent: true,
  releaseQualificationPresent: true,
  testnetArchitectureReviewPresent: true,
  humanApprovalCheckpointPresent: true,
  testnetIntentPresent: true,
  testnetIntentPersistencePresent: true,
  testnetIntentComparisonPresent: true,
  testnetIntentTrendPresent: true,
  testnetIntentTrendPersistencePresent: true,
  testnetIntentTrendComparisonPresent: true,
  deterministicSimulationsPresent: true,
} as const;

describe('runPhasePCompletionAudit', () => {
  it('marks Phase P complete only when every required capability is present', () => {
    const result = runPhasePCompletionAudit(completeInput);

    expect(result.status).toBe('COMPLETE');
    expect(result.completedChecks).toBe(result.totalChecks);
    expect(result.missingChecks).toEqual([]);
    expect(result.dryRunOnly).toBe(true);
    expect(result.transportDispatchAllowed).toBe(false);
    expect(result.testnetExecutionAuthorized).toBe(false);
    expect(result.orderExecutionAuthorized).toBe(false);
  });

  it('reports missing capabilities and keeps the audit incomplete', () => {
    const result = runPhasePCompletionAudit({
      ...completeInput,
      humanApprovalCheckpointPresent: false,
      deterministicSimulationsPresent: false,
    });

    expect(result.status).toBe('INCOMPLETE');
    expect(result.completedChecks).toBe(result.totalChecks - 2);
    expect(result.missingChecks).toEqual([
      'human approval checkpoint',
      'deterministic simulations',
    ]);
  });
});
