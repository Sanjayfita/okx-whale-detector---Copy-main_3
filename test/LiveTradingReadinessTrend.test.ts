import { describe, expect, it } from 'vitest';

import { summarizeLiveTradingReadinessTrend } from '../src/safety/liveTradingReadinessTrend';
import { createLiveTradingReadinessDocument } from '../src/safety/liveTradingReadinessPersistence';
import type { LiveTradingReadinessChecklist } from '../src/safety/liveTradingReadiness';

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

const documentAt = (
  generatedAt: number,
  overrides: Partial<LiveTradingReadinessChecklist>,
) =>
  createLiveTradingReadinessDocument({
    generatedAt,
    checklist: { ...completeChecklist(), ...overrides },
  });

describe('summarizeLiveTradingReadinessTrend', () => {
  it('reports an improving readiness trend', () => {
    const summary = summarizeLiveTradingReadinessTrend([
      documentAt(100, {
        credentialsIsolated: false,
        testnetValidationCompleted: false,
        independentSecurityReviewCompleted: false,
      }),
      documentAt(200, {
        testnetValidationCompleted: false,
        independentSecurityReviewCompleted: false,
      }),
      documentAt(300, {}),
    ]);

    expect(summary.direction).toBe('IMPROVING');
    expect(summary.completedChecksChange).toBe(3);
    expect(summary.readinessEscalations).toBe(2);
    expect(summary.readinessRegressions).toBe(0);
    expect(summary.bestCompletedChecks).toBe(11);
    expect(summary.worstCompletedChecks).toBe(8);
    expect(summary.orderExecutionAuthorized).toBe(false);
  });

  it('reports a deteriorating readiness trend', () => {
    const summary = summarizeLiveTradingReadinessTrend([
      documentAt(100, {}),
      documentAt(200, { auditLoggingImplemented: false }),
      documentAt(300, {
        auditLoggingImplemented: false,
        emergencyStopImplemented: false,
      }),
    ]);

    expect(summary.direction).toBe('DETERIORATING');
    expect(summary.completedChecksChange).toBe(-2);
    expect(summary.readinessRegressions).toBe(2);
    expect(summary.orderExecutionAuthorized).toBe(false);
  });

  it('sorts documents chronologically and reports a stable trend', () => {
    const summary = summarizeLiveTradingReadinessTrend([
      documentAt(300, { independentSecurityReviewCompleted: false }),
      documentAt(100, { independentSecurityReviewCompleted: false }),
      documentAt(200, { independentSecurityReviewCompleted: false }),
    ]);

    expect(summary.direction).toBe('STABLE');
    expect(summary.points.map((point) => point.generatedAt)).toEqual([100, 200, 300]);
    expect(summary.completedChecksChange).toBe(0);
  });

  it('rejects fewer than two documents', () => {
    expect(() => summarizeLiveTradingReadinessTrend([documentAt(100, {})])).toThrow(
      'At least two readiness documents are required',
    );
  });

  it('rejects duplicate timestamps', () => {
    expect(() =>
      summarizeLiveTradingReadinessTrend([documentAt(100, {}), documentAt(100, {})]),
    ).toThrow('Duplicate readiness timestamp: 100');
  });
});
