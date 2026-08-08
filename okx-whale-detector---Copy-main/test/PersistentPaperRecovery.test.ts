import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PaperStateRepository } from '../src/paper/PaperStateRepository';
import { PlatformSettingsRepository } from '../src/platform/PlatformSettingsRepository';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';
import { TradingPlatformApplication } from '../src/platform/TradingPlatformApplication';

const directories: string[] = [];

const openPersistentPosition = (store: PlatformStateStore): void => {
  store.account.openPositionFromFill({
    fillId: 'entry-btc-1',
    tradeId: 'trade-btc-1',
    instrumentId: 'BTC-USDT-SWAP',
    direction: 'LONG',
    openedAt: 1_000,
    entryPrice: 100_000,
    quantityBaseUnits: 0.01,
    stopLossPrice: 98_500,
    takeProfitPrice: 103_000,
    trailingStopPrice: 99_250,
    riskAmount: 15,
    entryReason: 'EMA_CROSS',
    entryFee: 0.5,
    slippageBps: 1.25,
    strategyId: 'ema-trend-crossover-v1',
    timeframe: '1H',
  });
  store.account.markPosition({
    instrumentId: 'BTC-USDT-SWAP',
    price: 101_000,
    timestamp: 2_000,
    trailingStopPrice: 100_200,
    auditEventId: 'trailing-btc-2000',
  });
  store.account.applyFundingEvent({
    fundingId: 'funding-btc-3000',
    instrumentId: 'BTC-USDT-SWAP',
    timestamp: 3_000,
    positionNotional: 1_010,
    fundingRatePercent: 0.01,
    fundingPnl: -0.101,
  });
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('persistent paper restart reconciliation', () => {
  it('restores an open position, stop, target, trailing state, funding, equity and risk lockouts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-recovery-'));
    directories.push(directory);
    const repository = new PaperStateRepository({
      filePath: join(directory, 'paper-state.json'),
    });

    const before = new PlatformStateStore({
      paperStateRepository: repository,
      now: () => 4_000,
    });
    before.updateSettings({ timeframe: '1H' });
    openPersistentPosition(before);
    before.riskManager.recordClosedTrade({ closedAt: 3_500, netPnl: -72 });
    before.account.recordAuditEvent({
      eventId: 'risk-loss-3500',
      type: 'RISK_STATE_UPDATE',
      timestamp: 3_500,
      instrumentId: 'PORTFOLIO',
      details: { netPnl: -72, consecutiveLosses: 1 },
    });
    before.appendCandle({
      instrumentId: 'BTC-USDT-SWAP',
      timeframe: '1H',
      timestamp: 3_600_000,
      open: 100_000,
      high: 101_500,
      low: 99_500,
      close: 101_000,
      volume: 100,
      confirmed: true,
      fastEma: 100_500,
      slowEma: 100_200,
      rsi: 58,
      atr: 1_100,
    });
    before.persistPaperState(4_000);
    const expected = before.account.snapshot(4_000);

    const after = new PlatformStateStore({
      paperStateRepository: repository,
      now: () => 5_000,
    });
    after.updateSettings({ timeframe: '1H' });
    const report = after.restorePaperState();
    const restored = after.account.snapshot(5_000);

    expect(report).toMatchObject({
      stateLoaded: true,
      positionsRestored: 1,
      riskStateRestored: true,
      fundingEventsRestored: 1,
      duplicateEvents: 0,
      result: 'PASS',
    });
    expect(restored.openPositions[0]).toMatchObject({
      tradeId: 'trade-btc-1',
      instrumentId: 'BTC-USDT-SWAP',
      direction: 'LONG',
      entryPrice: 100_000,
      quantityBaseUnits: 0.01,
      stopLossPrice: 98_500,
      takeProfitPrice: 103_000,
      trailingStopPrice: 100_200,
      fundingPnl: -0.101,
      strategyId: 'ema-trend-crossover-v1',
      timeframe: '1H',
    });
    expect(restored.cashBalance).toBeCloseTo(expected.cashBalance);
    expect(restored.unrealizedPnl).toBeCloseTo(expected.unrealizedPnl);
    expect(restored.equity).toBeCloseTo(expected.equity);
    expect(after.riskManager.getStatus()).toMatchObject({
      consecutiveLosses: 1,
      lastLossAt: 3_500,
      cooldownUntil: 3_500 + 30 * 60 * 1_000,
    });
    expect(after.getRecoveredCandleTimestamp('BTC-USDT-SWAP', '1H')).toBe(
      3_600_000,
    );
  });

  it('keeps a completed trade closed across restart and reconstructs daily account evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-closed-recovery-'));
    directories.push(directory);
    const repository = new PaperStateRepository({
      filePath: join(directory, 'paper-state.json'),
    });
    const before = new PlatformStateStore({
      paperStateRepository: repository,
      now: () => 3_000,
    });
    before.account.openPositionFromFill({
      fillId: 'entry-eth',
      tradeId: 'trade-eth',
      instrumentId: 'ETH-USDT-SWAP',
      direction: 'SHORT',
      openedAt: 1_000,
      entryPrice: 100,
      quantityBaseUnits: 2,
      stopLossPrice: 105,
      takeProfitPrice: 90,
      riskAmount: 10,
      entryReason: 'EMA_CROSS',
      entryFee: 1,
      slippageBps: 1,
      strategyId: 'ema-trend-crossover-v1',
      timeframe: '1m',
    });
    before.account.closePositionFromFill({
      fillId: 'exit-eth',
      instrumentId: 'ETH-USDT-SWAP',
      exitPrice: 95,
      quantityBaseUnits: 2,
      closedAt: 2_000,
      exitReason: 'TAKE_PROFIT',
      exitFee: 1,
      slippageBps: 1.5,
    });
    before.persistPaperState(3_000);

    const after = new PlatformStateStore({
      paperStateRepository: repository,
      now: () => 4_000,
    });
    expect(after.restorePaperState().result).toBe('PASS');
    const restored = after.account.snapshot(4_000);
    expect(restored.openPositions).toHaveLength(0);
    expect(restored.trades).toHaveLength(1);
    expect(restored.trades[0]).toMatchObject({
      tradeId: 'trade-eth',
      exitFillId: 'exit-eth',
      exitReason: 'TAKE_PROFIT',
    });
    expect(restored.fills).toHaveLength(2);
    expect(restored.equity).toBeCloseTo(10_008);
  });

  it('loads persisted paper state before the real application exposes its first runtime snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-app-restart-'));
    directories.push(directory);
    const webDirectory = join(directory, 'web');
    await mkdir(webDirectory, { recursive: true });
    await writeFile(join(webDirectory, 'index.html'), '<h1>dashboard</h1>', 'utf8');
    const paperStateRepository = new PaperStateRepository({
      filePath: join(directory, 'paper-state.json'),
    });
    const seed = new PlatformStateStore({
      paperStateRepository,
      now: () => 4_000,
    });
    seed.updateSettings({ timeframe: '1H' });
    openPersistentPosition(seed);
    seed.persistPaperState(4_000);

    const settingsRepository = new PlatformSettingsRepository(
      join(directory, 'settings.json'),
    );
    await settingsRepository.save(seed.getSettings());

    const application = new TradingPlatformApplication({
      server: {
        port: 0,
        staticDirectory: webDirectory,
        settingsRepository,
      },
      paperStateRepository,
      paperCheckpointIntervalMs: 60_000,
      now: () => 5_000,
      environment: {},
    });
    await application.start();
    try {
      const snapshot = application.store.snapshot(5_000);
      expect(snapshot.settings.timeframe).toBe('1H');
      expect(snapshot.positions).toHaveLength(1);
      expect(snapshot.positions[0]).toMatchObject({
        instrumentId: 'BTC-USDT-SWAP',
        stopLossPrice: 98_500,
        takeProfitPrice: 103_000,
        trailingStopPrice: 100_200,
      });
      expect(
        snapshot.logs.some(
          (entry) => entry.message === 'Paper account reconciliation completed',
        ),
      ).toBe(true);
    } finally {
      await application.close();
    }
  });
});
