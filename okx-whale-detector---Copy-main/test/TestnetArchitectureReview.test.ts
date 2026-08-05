import { describe, expect, it } from 'vitest';

import {
  reviewTestnetArchitecture,
  type TestnetArchitectureChecklist,
} from '../src/safety/testnetArchitectureReview';

const completeChecklist = (): TestnetArchitectureChecklist => ({
  testnetEndpointHardCoded: true,
  productionEndpointRejected: true,
  credentialsDisabledByDefault: true,
  testnetCredentialsIsolated: true,
  maximumOrderNotionalConfigured: true,
  maximumDailyLossConfigured: true,
  emergencyStopImplemented: true,
  duplicateOrderProtectionImplemented: true,
  clientOrderIdRequired: true,
  exchangeReconciliationImplemented: true,
  auditLoggingImplemented: true,
  manualApprovalRequired: true,
  startupSafetyValidationImplemented: true,
  productionExecutionCodeAbsent: true,
});

describe('reviewTestnetArchitecture', () => {
  it('returns ready for manual review when every control is present', () => {
    const review = reviewTestnetArchitecture(completeChecklist());

    expect(review.status).toBe('READY_FOR_MANUAL_REVIEW');
    expect(review.completedChecks).toBe(review.totalChecks);
    expect(review.missingChecks).toEqual([]);
    expect(review.blockers).toEqual([]);
    expect(review.testnetExecutionAuthorized).toBe(false);
    expect(review.orderExecutionAuthorized).toBe(false);
  });

  it('requires changes for a missing non-blocking control', () => {
    const checklist = completeChecklist();
    checklist.auditLoggingImplemented = false;

    const review = reviewTestnetArchitecture(checklist);

    expect(review.status).toBe('CHANGES_REQUIRED');
    expect(review.missingChecks).toEqual(['auditLoggingImplemented']);
    expect(review.blockers).toEqual([]);
  });

  it('blocks review when testnet isolation is incomplete', () => {
    const checklist = completeChecklist();
    checklist.productionEndpointRejected = false;
    checklist.emergencyStopImplemented = false;

    const review = reviewTestnetArchitecture(checklist);

    expect(review.status).toBe('BLOCKED');
    expect(review.blockers).toEqual([
      'productionEndpointRejected',
      'emergencyStopImplemented',
    ]);
    expect(review.testnetExecutionAuthorized).toBe(false);
    expect(review.orderExecutionAuthorized).toBe(false);
  });

  it('is deterministic and does not mutate the checklist', () => {
    const checklist = completeChecklist();
    const snapshot = { ...checklist };

    const first = reviewTestnetArchitecture(checklist);
    const second = reviewTestnetArchitecture(checklist);

    expect(second).toEqual(first);
    expect(checklist).toEqual(snapshot);
  });
});
