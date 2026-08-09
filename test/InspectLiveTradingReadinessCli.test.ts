import { describe, expect, it, vi } from 'vitest';

import { createLiveTradingReadinessDocument } from '../src/safety/liveTradingReadinessPersistence';
import { runInspectLiveTradingReadinessCli } from '../src/tools/inspectLiveTradingReadiness';

const completeChecklist = {
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
} as const;

describe('runInspectLiveTradingReadinessCli', () => {
  it('prints a ready-for-review document and returns zero', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const document = createLiveTradingReadinessDocument({
      generatedAt: 1_000,
      checklist: completeChecklist,
    });

    const exitCode = await runInspectLiveTradingReadinessCli(
      ['--file', 'readiness.json'],
      { readDocument: async () => document, log, error },
    );

    expect(exitCode).toBe(0);
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Status: READY_FOR_MANUAL_REVIEW');
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
  });

  it('returns one when critical controls are missing', async () => {
    const document = createLiveTradingReadinessDocument({
      generatedAt: 2_000,
      checklist: { ...completeChecklist, emergencyStopImplemented: false },
    });

    const exitCode = await runInspectLiveTradingReadinessCli(
      ['--file', 'readiness.json'],
      { readDocument: async () => document, log: vi.fn(), error: vi.fn() },
    );

    expect(exitCode).toBe(1);
  });

  it('returns two for missing arguments', async () => {
    const error = vi.fn();
    const exitCode = await runInspectLiveTradingReadinessCli([], {
      log: vi.fn(),
      error,
    });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Usage: safety:inspect-readiness -- --file <readiness.json>',
    );
  });

  it('returns two when the document cannot be read', async () => {
    const error = vi.fn();
    const exitCode = await runInspectLiveTradingReadinessCli(
      ['--file', 'broken.json'],
      {
        readDocument: async () => {
          throw new Error('invalid document');
        },
        log: vi.fn(),
        error,
      },
    );

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Live trading readiness inspection failed: invalid document',
    );
  });
});
