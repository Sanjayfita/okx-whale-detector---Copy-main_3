import { describe, expect, it } from 'vitest';

import { compareLiveTradingReadinessDocuments } from '../src/safety/liveTradingReadinessComparison';
import { createLiveTradingReadinessDocument } from '../src/safety/liveTradingReadinessPersistence';

const checklist = (overrides: Partial<Record<string, boolean>> = {}) => ({
  credentialsIsolated: true,
  tradePermissionDisabledByDefault: true,
  maximumOrderNotionalConfigured: true,
  maximumDailyLossConfigured: true,
  emergencyStopImplemented: true,
  duplicateOrderProtectionImplemented: true,
  exchangeReconciliationImplemented: false,
  auditLoggingImplemented: false,
  manualApprovalRequired: true,
  testnetValidationCompleted: false,
  independentSecurityReviewCompleted: false,
  ...overrides,
});

describe('compareLiveTradingReadinessDocuments', () => {
  it('reports improvement when controls are completed without regression', () => {
    const baseline = createLiveTradingReadinessDocument({
      generatedAt: 100,
      checklist: checklist(),
    });
    const candidate = createLiveTradingReadinessDocument({
      generatedAt: 200,
      checklist: checklist({ auditLoggingImplemented: true }),
    });

    const result = compareLiveTradingReadinessDocuments({ baseline, candidate });

    expect(result.outcome).toBe('IMPROVED');
    expect(result.completedChecksDelta).toBe(1);
    expect(result.newlyCompletedChecks).toEqual(['auditLoggingImplemented']);
    expect(result.regressedChecks).toEqual([]);
    expect(result.orderExecutionAuthorized).toBe(false);
  });

  it('reports regression when a completed control becomes missing', () => {
    const baseline = createLiveTradingReadinessDocument({
      generatedAt: 100,
      checklist: checklist({ auditLoggingImplemented: true }),
    });
    const candidate = createLiveTradingReadinessDocument({
      generatedAt: 200,
      checklist: checklist({ emergencyStopImplemented: false }),
    });

    const result = compareLiveTradingReadinessDocuments({ baseline, candidate });

    expect(result.outcome).toBe('WORSENED');
    expect(result.regressedChecks).toEqual([
      'auditLoggingImplemented',
      'emergencyStopImplemented',
    ]);
    expect(result.candidateStatus).toBe('NOT_READY');
  });

  it('reports unchanged for identical checklists', () => {
    const baseline = createLiveTradingReadinessDocument({
      generatedAt: 100,
      checklist: checklist(),
    });
    const candidate = createLiveTradingReadinessDocument({
      generatedAt: 200,
      checklist: checklist(),
    });

    expect(
      compareLiveTradingReadinessDocuments({ baseline, candidate }).outcome,
    ).toBe('UNCHANGED');
  });

  it('rejects an older candidate', () => {
    const baseline = createLiveTradingReadinessDocument({
      generatedAt: 200,
      checklist: checklist(),
    });
    const candidate = createLiveTradingReadinessDocument({
      generatedAt: 100,
      checklist: checklist(),
    });

    expect(() =>
      compareLiveTradingReadinessDocuments({ baseline, candidate }),
    ).toThrow('Candidate readiness document cannot be older than baseline');
  });
});
