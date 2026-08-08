import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PaperAccountLedger } from '../src/paper/PaperAccountLedger';
import { PaperStateRepository } from '../src/paper/PaperStateRepository';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';
import { TradingRiskManager } from '../src/risk/TradingRiskManager';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('paper reconciliation integrity', () => {
  it('detects corrupted cached values and deterministically rebuilds them from ledger evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-reconcile-integrity-'));
    directories.push(directory);
    const repository = new PaperStateRepository({
      filePath: join(directory, 'paper-state.json'),
    });
    const ledger = new PaperAccountLedger(10_000);
    ledger.openPositionFromFill({
      fillId: 'entry-btc',
      tradeId: 'trade-btc',
      instrumentId: 'BTC-USDT-SWAP',
      direction: 'LONG',
      openedAt: 1_000,
      entryPrice: 100,
      quantityBaseUnits: 2,
      stopLossPrice: 95,
      takeProfitPrice: 110,
      riskAmount: 10,
      entryReason: 'EMA_CROSS',
      entryFee: 1,
      slippageBps: 1,
      strategyId: 'ema-trend-crossover-v1',
      timeframe: '1m',
    });
    ledger.markPosition({
      instrumentId: 'BTC-USDT-SWAP',
      price: 105,
      timestamp: 2_000,
    });
    const valid = ledger.exportState();
    const position = valid.openPositions[0];
    if (position === undefined) throw new Error('expected open position');

    repository.save({
      schemaVersion: 1,
      savedAt: 2_000,
      account: {
        ...valid,
        cashBalance: 123,
        peakEquity: 999_999,
        openPositions: [{ ...position, unrealizedPnl: 9_999 }],
      },
      risk: new TradingRiskManager().exportState(),
      context: {
        activeStrategyId: 'ema-trend-crossover-v1',
        timeframe: '1m',
        lastConfirmedCandleByInstrument: {},
      },
    });

    const restored = new PlatformStateStore({
      paperStateRepository: repository,
      now: () => 3_000,
    });
    const report = restored.restorePaperState();
    const account = restored.account.snapshot(3_000);

    expect(report.result).toBe('WARN');
    expect(report.ledgerIntegrity).toBe('WARN');
    expect(report.warnings.some((warning) => warning.includes('unrealized PnL'))).toBe(
      true,
    );
    expect(report.warnings.some((warning) => warning.includes('Persisted cash'))).toBe(
      true,
    );
    expect(report.warnings.some((warning) => warning.includes('peak equity'))).toBe(
      true,
    );
    expect(account.cashBalance).toBe(9_999);
    expect(account.unrealizedPnl).toBe(10);
    expect(account.equity).toBe(10_009);
    expect(account.peakEquity).toBe(10_009);
  });
});
