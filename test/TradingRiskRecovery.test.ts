import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PaperStateRepository } from '../src/paper/PaperStateRepository';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';

const directories: string[] = [];

const recordLoss = (
  store: PlatformStateStore,
  instrumentId: string,
  sequence: number,
): void => {
  const openedAt = 1_000 + sequence * 1_000;
  const closedAt = openedAt + 500;
  store.account.openPositionFromFill({
    fillId: `${instrumentId}:entry`,
    tradeId: `${instrumentId}:trade`,
    instrumentId,
    direction: 'LONG',
    openedAt,
    entryPrice: 100,
    quantityBaseUnits: 1,
    stopLossPrice: 90,
    takeProfitPrice: 120,
    riskAmount: 10,
    entryReason: 'TEST_ENTRY',
    entryFee: 0,
    slippageBps: 0,
    strategyId: 'ema-trend-crossover-v1',
    timeframe: '1m',
  });
  const closed = store.account.closePositionFromFill({
    fillId: `${instrumentId}:exit`,
    instrumentId,
    exitPrice: 90,
    quantityBaseUnits: 1,
    closedAt,
    exitReason: 'STOP_LOSS',
    exitFee: 0,
    slippageBps: 0,
  });
  if (closed.trade === null) throw new Error('expected closed trade');
  store.riskManager.recordClosedTrade({
    closedAt,
    netPnl: closed.trade.netPnl,
  });
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('paper risk restart recovery', () => {
  it('restores daily realized loss, trade count, cooldown, circuit breaker and kill switch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-risk-recovery-'));
    directories.push(directory);
    const repository = new PaperStateRepository({
      filePath: join(directory, 'paper-state.json'),
    });
    const before = new PlatformStateStore({
      paperStateRepository: repository,
      now: () => 10_000,
    });

    ['BTC-USDT-SWAP', 'ETH-USDT-SWAP', 'SOL-USDT-SWAP', 'XRP-USDT-SWAP'].forEach(
      (instrumentId, index) => recordLoss(before, instrumentId, index),
    );
    before.riskManager.setKillSwitch(true);
    before.persistPaperState(10_000);

    expect(before.account.getRealizedPnlForDay(10_000)).toBe(-40);
    expect(before.account.getTradesForDay(10_000)).toBe(4);
    expect(before.riskManager.getStatus()).toMatchObject({
      killSwitchActive: true,
      circuitBreakerActive: true,
      consecutiveLosses: 4,
    });

    const after = new PlatformStateStore({
      paperStateRepository: repository,
      now: () => 11_000,
    });
    expect(after.restorePaperState().result).toBe('PASS');

    expect(after.account.getRealizedPnlForDay(11_000)).toBe(-40);
    expect(after.account.getTradesForDay(11_000)).toBe(4);
    const status = after.riskManager.getStatus();
    expect(status).toMatchObject({
      killSwitchActive: true,
      circuitBreakerActive: true,
      consecutiveLosses: 4,
    });
    expect(status.cooldownUntil).not.toBeNull();

    const account = after.account.snapshot(11_000);
    const decision = after.riskManager.evaluateNewTrade({
      timestamp: 11_000,
      startingDayEquity: 10_000,
      currentEquity: account.equity,
      peakEquity: account.peakEquity,
      openPositions: 0,
      tradesToday: after.account.getTradesForDay(11_000),
      realizedPnlToday: after.account.getRealizedPnlForDay(11_000),
      requestedRiskPercent: 1,
      requestedLeverage: 2,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('KILL_SWITCH_ACTIVE');
    expect(decision.reasons).toContain('CIRCUIT_BREAKER_ACTIVE');
    expect(decision.reasons).toContain('LOSS_COOLDOWN_ACTIVE');
  });
});
