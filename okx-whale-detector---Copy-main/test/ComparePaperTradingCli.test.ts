import { describe, expect, it, vi } from 'vitest';

import type { PaperTradingDocument } from '../src/paperTrading/paperTradingPersistence';
import { runComparePaperTradingCli } from '../src/tools/comparePaperTrading';

const createDocument = (input: {
  generatedAt: number;
  equity: number;
  riskStatus: 'ALLOWED' | 'WARNING' | 'BLOCKED';
  drawdownPercent: number;
}): PaperTradingDocument => ({
  schemaVersion: 1,
  generatorVersion: 'paper-trading-document-v1',
  portfolio: {
    generatedAt: input.generatedAt,
    initialCash: 10_000,
    cash: input.equity,
    realizedPnl: 0,
    feesPaid: 0,
    fills: [],
    positions: [],
  },
  valuation: {
    generatedAt: input.generatedAt,
    cash: input.equity,
    equity: input.equity,
    realizedPnl: 0,
    unrealizedPnl: 0,
    feesPaid: 0,
    grossExposure: 0,
    netExposure: 0,
    positions: [],
  },
  risk: {
    generatedAt: input.generatedAt,
    status: input.riskStatus,
    equity: input.equity,
    drawdownPercent: input.drawdownPercent,
    largestPositionExposure: 0,
    reasons: [],
  },
});

describe('runComparePaperTradingCli', () => {
  it('prints an improved comparison and exits with zero', async () => {
    const baseline = createDocument({
      generatedAt: 100,
      equity: 9_000,
      riskStatus: 'WARNING',
      drawdownPercent: 10,
    });
    const candidate = createDocument({
      generatedAt: 200,
      equity: 9_500,
      riskStatus: 'ALLOWED',
      drawdownPercent: 5,
    });
    const log = vi.fn();

    const exitCode = await runComparePaperTradingCli(
      ['--baseline', 'baseline.json', '--candidate', 'candidate.json'],
      {
        readDocument: async (filePath) =>
          filePath === 'baseline.json' ? baseline : candidate,
        log,
      },
    );

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith('Outcome: IMPROVED');
    expect(log).toHaveBeenCalledWith('Risk status: WARNING -> ALLOWED');
  });

  it('returns one when the candidate worsened', async () => {
    const baseline = createDocument({
      generatedAt: 100,
      equity: 10_000,
      riskStatus: 'ALLOWED',
      drawdownPercent: 0,
    });
    const candidate = createDocument({
      generatedAt: 200,
      equity: 9_000,
      riskStatus: 'BLOCKED',
      drawdownPercent: 10,
    });

    const exitCode = await runComparePaperTradingCli(
      ['--baseline', 'baseline.json', '--candidate', 'candidate.json'],
      {
        readDocument: async (filePath) =>
          filePath === 'baseline.json' ? baseline : candidate,
        log: vi.fn(),
      },
    );

    expect(exitCode).toBe(1);
  });

  it('returns two for missing arguments or read failures', async () => {
    const error = vi.fn();
    expect(await runComparePaperTradingCli([], { error })).toBe(2);

    expect(
      await runComparePaperTradingCli(
        ['--baseline', 'baseline.json', '--candidate', 'candidate.json'],
        {
          readDocument: async () => {
            throw new Error('cannot read');
          },
          error,
        },
      ),
    ).toBe(2);
    expect(error).toHaveBeenCalled();
  });
});
