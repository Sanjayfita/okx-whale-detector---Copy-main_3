import { describe, expect, it, vi } from 'vitest';

import type { PaperTradingDocument } from '../src/paperTrading/paperTradingPersistence';
import { runInspectPaperTradingCli } from '../src/tools/inspectPaperTrading';

const createDocument = (status: 'ALLOWED' | 'WARNING' | 'BLOCKED'): PaperTradingDocument => ({
  schemaVersion: 1,
  generatorVersion: 'paper-trading-document-v1',
  portfolio: {
    generatedAt: 100,
    initialCash: 10_000,
    cash: 9_000,
    realizedPnl: 100,
    feesPaid: 5,
    fills: [],
    positions: [],
  },
  valuation: {
    generatedAt: 101,
    cash: 9_000,
    equity: 10_100,
    realizedPnl: 100,
    unrealizedPnl: 5,
    feesPaid: 5,
    grossExposure: 1_100,
    netExposure: 1_100,
    positions: [
      {
        instrumentId: 'BTC-USDT',
        quantity: 0.01,
        averageEntryPrice: 100_000,
        markPrice: 110_000,
        marketValue: 1_100,
        unrealizedPnl: 100,
        realizedPnl: 0,
      },
    ],
  },
  risk: {
    generatedAt: 101,
    status,
    equity: 10_100,
    drawdownPercent: 0,
    largestPositionExposure: 1_100,
    reasons: status === 'ALLOWED' ? [] : ['Exposure requires review'],
  },
});

describe('paper trading inspector CLI', () => {
  it('prints a report and returns zero for allowed or warning documents', async () => {
    const log = vi.fn();
    const exitCode = await runInspectPaperTradingCli(['--file', 'paper.json'], {
      readDocument: vi.fn().mockResolvedValue(createDocument('WARNING')),
      log,
    });

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith('PAPER TRADING REPORT');
    expect(log).toHaveBeenCalledWith('Risk status: WARNING');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('BTC-USDT'));
    expect(log).toHaveBeenCalledWith('RISK | Exposure requires review');
  });

  it('returns one for blocked documents', async () => {
    const exitCode = await runInspectPaperTradingCli(['--file', 'paper.json'], {
      readDocument: vi.fn().mockResolvedValue(createDocument('BLOCKED')),
      log: vi.fn(),
    });
    expect(exitCode).toBe(1);
  });

  it('returns two when the file argument is missing', async () => {
    const error = vi.fn();
    expect(await runInspectPaperTradingCli([], { error })).toBe(2);
    expect(error).toHaveBeenCalledWith('Usage: paper:inspect -- --file <paper-trading.json>');
  });

  it('returns two when reading fails', async () => {
    const error = vi.fn();
    const exitCode = await runInspectPaperTradingCli(['--file', 'bad.json'], {
      readDocument: vi.fn().mockRejectedValue(new Error('invalid document')),
      error,
    });
    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith('Paper trading inspection failed: invalid document');
  });
});
