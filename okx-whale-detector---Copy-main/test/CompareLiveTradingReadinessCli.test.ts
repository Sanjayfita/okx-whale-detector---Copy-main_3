import { describe, expect, it, vi } from 'vitest';

import type { LiveTradingReadinessChecklist } from '../src/safety/liveTradingReadiness';
import {
  createLiveTradingReadinessDocument,
  type LiveTradingReadinessDocument,
} from '../src/safety/liveTradingReadinessPersistence';
import { runCompareLiveTradingReadinessCli } from '../src/tools/compareLiveTradingReadiness';

const checklist = (
  overrides: Partial<LiveTradingReadinessChecklist> = {},
): LiveTradingReadinessChecklist => ({
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
  ...overrides,
});

const document = (
  generatedAt: number,
  overrides: Partial<LiveTradingReadinessChecklist> = {},
): LiveTradingReadinessDocument =>
  createLiveTradingReadinessDocument({
    generatedAt,
    checklist: checklist(overrides),
  });

const readerFor = (documents: Record<string, LiveTradingReadinessDocument>) =>
  vi.fn(async (filePath: string) => {
    const result = documents[filePath];
    if (result === undefined) throw new Error(`Missing fixture: ${filePath}`);
    return result;
  });

describe('runCompareLiveTradingReadinessCli', () => {
  it('prints an improved comparison and returns zero', async () => {
    const log = vi.fn();
    const error = vi.fn();
    const readDocument = readerFor({
      baseline: document(100, { independentSecurityReviewCompleted: false }),
      candidate: document(200),
    });

    const exitCode = await runCompareLiveTradingReadinessCli(
      ['--baseline', 'baseline', '--candidate', 'candidate'],
      { readDocument, log, error },
    );

    expect(exitCode).toBe(0);
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Outcome: IMPROVED');
    expect(log).toHaveBeenCalledWith(
      'Newly completed: independentSecurityReviewCompleted',
    );
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
  });

  it('returns one when a safety control regresses', async () => {
    const log = vi.fn();
    const readDocument = readerFor({
      baseline: document(100),
      candidate: document(200, { emergencyStopImplemented: false }),
    });

    const exitCode = await runCompareLiveTradingReadinessCli(
      ['--baseline', 'baseline', '--candidate', 'candidate'],
      { readDocument, log },
    );

    expect(exitCode).toBe(1);
    expect(log).toHaveBeenCalledWith('Outcome: WORSENED');
    expect(log).toHaveBeenCalledWith('Regressed: emergencyStopImplemented');
  });

  it('returns two when required arguments are missing', async () => {
    const error = vi.fn();

    const exitCode = await runCompareLiveTradingReadinessCli([], { error });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Usage: safety:compare-readiness -- --baseline <baseline.json> --candidate <candidate.json>',
    );
  });

  it('returns two when reading or comparison fails', async () => {
    const error = vi.fn();
    const readDocument = vi.fn(async () => {
      throw new Error('read failed');
    });

    const exitCode = await runCompareLiveTradingReadinessCli(
      ['--baseline', 'baseline', '--candidate', 'candidate'],
      { readDocument, error },
    );

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Live trading readiness comparison failed: read failed',
    );
  });
});
