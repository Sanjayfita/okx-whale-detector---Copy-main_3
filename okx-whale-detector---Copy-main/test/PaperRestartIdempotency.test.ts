import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PaperStateRepository } from '../src/paper/PaperStateRepository';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';

const directories: string[] = [];

const entry = {
  fillId: 'restart-entry-1',
  tradeId: 'restart-trade-1',
  instrumentId: 'BTC-USDT-SWAP',
  direction: 'LONG' as const,
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
  timeframe: '1m' as const,
};

const funding = {
  fundingId: 'restart-funding-1',
  instrumentId: 'BTC-USDT-SWAP',
  timestamp: 2_000,
  positionNotional: 200,
  fundingRatePercent: 0.1,
  fundingPnl: -0.2,
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('paper event idempotency across restart', () => {
  it('does not replay a previously persisted fill or funding event after recovery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-restart-idempotency-'));
    directories.push(directory);
    const repository = new PaperStateRepository({
      filePath: join(directory, 'paper-state.json'),
    });
    const before = new PlatformStateStore({
      paperStateRepository: repository,
      now: () => 2_000,
    });
    expect(before.account.openPositionFromFill(entry).applied).toBe(true);
    expect(before.account.applyFundingEvent(funding).applied).toBe(true);
    before.persistPaperState(2_000);

    const after = new PlatformStateStore({
      paperStateRepository: repository,
      now: () => 3_000,
    });
    expect(after.restorePaperState().result).toBe('PASS');
    const recoveredBeforeReplay = after.account.snapshot(3_000);

    expect(after.account.openPositionFromFill(entry).applied).toBe(false);
    expect(after.account.applyFundingEvent(funding).applied).toBe(false);
    const recoveredAfterReplay = after.account.snapshot(3_000);

    expect(recoveredAfterReplay.cashBalance).toBeCloseTo(
      recoveredBeforeReplay.cashBalance,
    );
    expect(recoveredAfterReplay.openPositions).toHaveLength(1);
    expect(recoveredAfterReplay.fills).toHaveLength(1);
    expect(recoveredAfterReplay.fundingEvents).toHaveLength(1);
    expect(recoveredAfterReplay.openPositions[0]?.fundingPnl).toBeCloseTo(-0.2);
  });
});
