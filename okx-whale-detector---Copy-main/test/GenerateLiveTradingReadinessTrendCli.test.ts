import { describe, expect, it, vi } from 'vitest';

import { createLiveTradingReadinessDocument } from '../src/safety/liveTradingReadinessPersistence';
import type { LiveTradingReadinessChecklist } from '../src/safety/liveTradingReadiness';
import { runGenerateLiveTradingReadinessTrendCli } from '../src/tools/generateLiveTradingReadinessTrend';

const checklist = (completed: number): LiveTradingReadinessChecklist => {
  const keys: Array<keyof LiveTradingReadinessChecklist> = [
    'credentialsIsolated',
    'tradePermissionDisabledByDefault',
    'maximumOrderNotionalConfigured',
    'maximumDailyLossConfigured',
    'emergencyStopImplemented',
    'duplicateOrderProtectionImplemented',
    'exchangeReconciliationImplemented',
    'auditLoggingImplemented',
    'manualApprovalRequired',
    'testnetValidationCompleted',
    'independentSecurityReviewCompleted',
  ];
  return Object.freeze(
    Object.fromEntries(keys.map((key, index) => [key, index < completed])),
  ) as unknown as LiveTradingReadinessChecklist;
};

describe('runGenerateLiveTradingReadinessTrendCli', () => {
  it('generates and writes an improving trend document', async () => {
    const documents = new Map([
      ['first.json', createLiveTradingReadinessDocument({ generatedAt: 100, checklist: checklist(7) })],
      ['second.json', createLiveTradingReadinessDocument({ generatedAt: 200, checklist: checklist(11) })],
    ]);
    const writeDocument = vi.fn(async () => undefined);
    const log = vi.fn();

    const exitCode = await runGenerateLiveTradingReadinessTrendCli(
      ['--file', 'first.json', '--file', 'second.json', '--output', 'trend.json'],
      {
        readDocument: async (filePath) => documents.get(filePath)!,
        writeDocument,
        now: () => 300,
        log,
      },
    );

    expect(exitCode).toBe(0);
    expect(writeDocument).toHaveBeenCalledTimes(1);
    expect(writeDocument.mock.calls[0]![0]).toBe('trend.json');
    expect(writeDocument.mock.calls[0]![1].trend.direction).toBe('IMPROVING');
    expect(writeDocument.mock.calls[0]![1].orderExecutionAuthorized).toBeUndefined();
    expect(writeDocument.mock.calls[0]![1].trend.orderExecutionAuthorized).toBe(false);
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
  });

  it('returns 1 for a deteriorating trend', async () => {
    const documents = new Map([
      ['first.json', createLiveTradingReadinessDocument({ generatedAt: 100, checklist: checklist(11) })],
      ['second.json', createLiveTradingReadinessDocument({ generatedAt: 200, checklist: checklist(7) })],
    ]);

    const exitCode = await runGenerateLiveTradingReadinessTrendCli(
      ['--file', 'first.json', '--file', 'second.json', '--output', 'trend.json'],
      {
        readDocument: async (filePath) => documents.get(filePath)!,
        writeDocument: async () => undefined,
        now: () => 300,
      },
    );

    expect(exitCode).toBe(1);
  });

  it('returns 2 when fewer than two input files are supplied', async () => {
    const error = vi.fn();
    const exitCode = await runGenerateLiveTradingReadinessTrendCli(
      ['--file', 'only.json', '--output', 'trend.json'],
      { error },
    );

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('returns 2 when generation fails', async () => {
    const error = vi.fn();
    const exitCode = await runGenerateLiveTradingReadinessTrendCli(
      ['--file', 'first.json', '--file', 'second.json', '--output', 'trend.json'],
      {
        readDocument: async () => {
          throw new Error('read failed');
        },
        error,
      },
    );

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Live trading readiness trend generation failed: read failed',
    );
  });
});
