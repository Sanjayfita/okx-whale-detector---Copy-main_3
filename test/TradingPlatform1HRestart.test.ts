import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OKXHistoricalDataClient } from '../src/clients/okx/OKXHistoricalDataClient';
import { PlatformSettingsRepository } from '../src/platform/PlatformSettingsRepository';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';
import { TradingPlatformApplication } from '../src/platform/TradingPlatformApplication';
import type { CandleTimeframeController } from '../src/platform/TradingPlatformObserver';
import type { TradingTimeframe } from '../src/config/tradingTimeframes';

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('trading platform 1H restart', () => {
  it('loads persisted 1H settings before history and live subscription initialization', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-1h-restart-'));
    directories.push(directory);
    const webDirectory = join(directory, 'web');
    const settingsPath = join(directory, 'settings.json');
    await mkdir(webDirectory, { recursive: true });
    await writeFile(join(webDirectory, 'index.html'), '<h1>dashboard</h1>', 'utf8');

    const repository = new PlatformSettingsRepository(settingsPath);
    const seed = new PlatformStateStore();
    seed.updateSettings({ timeframe: '1H' });
    await repository.save(seed.getSettings());

    const historyIntervals: string[] = [];
    vi.spyOn(OKXHistoricalDataClient.prototype, 'fetchCandlesPage').mockImplementation(
      async (input) => {
        historyIntervals.push(input.interval);
        const records = Array.from({ length: 75 }, (_, index) => {
          const close = 10_000 + index * 2 + (index % 3 === 0 ? -1 : 1);
          return {
            kind: 'CANDLE' as const,
            instrumentId: input.instrumentId,
            observedAt: 1_800_000_000_000 + index * input.intervalMs,
            receivedAt: 1_900_000_000_000,
            source: 'OKX_REST' as const,
            intervalMs: input.intervalMs,
            open: close - 0.5,
            high: close + 3,
            low: close - 3,
            close,
            contractVolume: 100 + index,
            baseVolume: 10 + index,
            quoteVolume: close * (10 + index),
            confirmed: true,
          };
        });
        return { records: records.reverse(), nextBefore: null, nextAfter: null };
      },
    );

    const controllerCalls: TradingTimeframe[] = [];
    let current: TradingTimeframe = '1m';
    const controller: CandleTimeframeController = {
      setTimeframe: (timeframe) => {
        current = timeframe;
        controllerCalls.push(timeframe);
      },
      getTimeframe: () => current,
    };

    const application = new TradingPlatformApplication({
      mode: 'PAPER',
      server: {
        port: 0,
        staticDirectory: webDirectory,
        settingsRepository: repository,
      },
      environment: {},
    });
    await application.start();
    try {
      expect(application.store.getSettings().timeframe).toBe('1H');
      await application.prepareCandleRuntime({
        symbols: ['BTC-USDT-SWAP'],
        controller,
      });

      expect(controllerCalls[0]).toBe('1H');
      expect(current).toBe('1H');
      expect(historyIntervals).toEqual(['1H']);
      expect(historyIntervals).not.toContain('1m');
      const snapshot = application.store.snapshot();
      expect(snapshot.timeframe).toMatchObject({ selected: '1H', state: 'READY' });
      expect(snapshot.candles['BTC-USDT-SWAP']?.every((candle) => candle.timeframe === '1H')).toBe(true);
      expect(snapshot.candles['BTC-USDT-SWAP']?.at(-1)?.fastEma).not.toBeNull();
      expect(snapshot.candles['BTC-USDT-SWAP']?.at(-1)?.slowEma).not.toBeNull();
      expect(snapshot.candles['BTC-USDT-SWAP']?.at(-1)?.rsi).not.toBeNull();
      expect(snapshot.candles['BTC-USDT-SWAP']?.at(-1)?.atr).not.toBeNull();
      expect(snapshot.trades).toHaveLength(0);
    } finally {
      await application.close();
    }
  });
});
