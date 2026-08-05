import { describe, expect, it } from 'vitest';

import {
  assessLiveTradingReadiness,
  type LiveTradingReadinessChecklist,
} from '../src/safety/liveTradingReadiness';

const completeChecklist = (): LiveTradingReadinessChecklist => ({
  credentialsIsolated: true,
  tradePermissionDisabledByDefault: true,
  maximumOrderNotionalConfigured: true,
  maximumDailyLossConfigured: true,
  emergencyStopImplemented: true,
  duplicateOrderProtectionImplemented: true,
  exchangeReconciliationImplemented: true,
  auditLoggingImplemented: true,
  manualApprovalRequired: true,
  testnetValidationCompleted: true,
  independentSecurityReviewCompleted: true,
});

describe('assessLiveTradingReadiness', () => {
  it('returns NOT_READY when a critical control is missing', () => {
    const checklist = completeChecklist();
    checklist.emergencyStopImplemented = false;

    const assessment = assessLiveTradingReadiness(checklist);

    expect(assessment.status).toBe('NOT_READY');
    expect(assessment.missingChecks).toEqual(['emergencyStopImplemented']);
    expect(assessment.orderExecutionAuthorized).toBe(false);
  });

  it('returns REVIEW_REQUIRED when only non-critical checks are incomplete', () => {
    const checklist = completeChecklist();
    checklist.testnetValidationCompleted = false;

    const assessment = assessLiveTradingReadiness(checklist);

    expect(assessment.status).toBe('REVIEW_REQUIRED');
    expect(assessment.completedChecks).toBe(10);
    expect(assessment.totalChecks).toBe(11);
    expect(assessment.orderExecutionAuthorized).toBe(false);
  });

  it('requires manual review even when every checklist item is complete', () => {
    const assessment = assessLiveTradingReadiness(completeChecklist());

    expect(assessment.status).toBe('READY_FOR_MANUAL_REVIEW');
    expect(assessment.missingChecks).toEqual([]);
    expect(assessment.reasons).toContain(
      'All checklist items are complete; independent manual approval is still required',
    );
    expect(assessment.orderExecutionAuthorized).toBe(false);
  });
});
