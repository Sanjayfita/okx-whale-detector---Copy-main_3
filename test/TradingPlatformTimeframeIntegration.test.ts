import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const historyMock = vi.hoisted(() => ({
  calls: [] as Array<{
    instrumentId: string;
    interval: string;
    intervalMs: number;
    limit: number;
  }>,
  failIntervals: new Set<string>(),
}));

vi.mock('../src/clients/okx/OKXHistoricalDataClient', () => ({
  OKXHistoricalDataClient: class MockHistoricalDataClient {
    public async fetchCandlesPage(input: {
      readonly instrumentId: string;
      readonly interval: string;
      readonly intervalMs: number;
      readonly limit?: number;
    }): Promise<{
      readonly records: readonly {
        readonly kind: 'CANDLE';
        readonly instrumentId: string;
        readonly observedAt: number;
        readonly receivedAt: number;
        readonly source: 'OKX_REST';
        readonly intervalMs: number;
        readonly open: number;
        readonly high: number;
        readonly low: number;
        readonly close: number;
        readonly contractVolume: number;
        readonly baseVolume: number;
        readonly quoteVolume: number;
        readonly confirmed: boolean;
      }[];
      readonly nextBefore: null;
      readonly nextAfter: null;
    }> {
      const limit = input.limit ?? 100;
      historyMock.calls.push({
        instrumentId: input.instrumentId,
        interval: input.interval,
        intervalMs: input.intervalMs,
        limit,
      });
      if (historyMock.failIntervals.has(input.interval)) {
        throw new Error(`simulated OKX ${input.interval} history failure`);
      }

      const supported = ['1m', '3m', '5m', '15m', '30m', '1H', '2H', '4H'];
      const timeframeIndex = supported.indexOf(input.interval);
      if (timeframeIndex < 0) throw new Error(`unexpected interval ${input.interval}`);
      const start = 1_800_000_000_000 + timeframeIndex * 50_000_000_000;
      const basePrice = 100 + timeframeIndex * 100;
      const records = Array.from({ length: limit }, (_, index) => {
        const close =
          basePrice + index * 0.45 + (index % 4 === 0 ? -0.3 : index % 4 === 2 ? 0.25 : 0);
        const open = close - (index % 2 === 0 ? 0.18 : -0.12);
        return {
          kind: 'CANDLE' as const,
          instrumentId: input.instrumentId,
          observedAt: start + index * input.intervalMs,
          receivedAt: start + index * input.intervalMs + 250,
          source: 'OKX_REST' as const,
          intervalMs: input.intervalMs,
          open,
          high: Math.max(open, close) + 0.8,
          low: Math.min(open, close) - 0.8,
          close,
          contractVolume: 10 + index,
          baseVolume: 5 + index / 2,
          quoteVolume: close * (5 + index / 2),
          // Include one incomplete OKX candle so the integration path proves it
          // is filtered before indicator state is rebuilt.
          confirmed: index !== limit - 2,
        };
      });

      // OKX commonly returns newest-first pages; the real bridge must normalize
      // them to chronological order before feeding the strategy.
      return { records: records.reverse(), nextBefore: null, nextAfter: null };
    }
  },
}));

import {
  TRADING_TIMEFRAMES,
  tradingTimeframeSpec,
  type TradingTimeframe,
} from '../src/config/tradingTimeframes';
import { PlatformSettingsRepository } from '../src/platform/PlatformSettingsRepository';
import { TradingPlatformApplication } from '../src/platform/TradingPlatformApplication';
import type { CandleTimeframeController } from '../src/platform/TradingPlatformObserver';

const directories: string[] = [];
const instrumentId = 'BTC-USDT-SWAP';
const integrationTestTimeoutMs = 15_000;

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for asynchronous rebuild');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
};

const createController = (): CandleTimeframeController & {
  readonly calls: TradingTimeframe[];
  current: TradingTimeframe;
} => {
  const calls: TradingTimeframe[] = [];
  return {
    calls,
    current: '1m',
    setTimeframe(timeframe) {
      this.current = timeframe;
      calls.push(timeframe);
    },
    getTimeframe() {
      return this.current;
    },
  };
};

const createFixture = async (settingsPath?: string) => {
  const directory = await mkdtemp(join(tmpdir(), 'platform-timeframe-integration-'));
  directories.push(directory);
  const webDirectory = join(directory, 'web');
  await mkdir(webDirectory, { recursive: true });
  await writeFile(join(webDirectory, 'index.html'), '<h1>dashboard</h1>', 'utf8');
  const repository = new PlatformSettingsRepository(
    settingsPath ?? join(directory, 'settings.json'),
  );
  const application = new TradingPlatformApplication({
    mode: 'PAPER',
    server: {
      port: 0,
      staticDirectory: webDirectory,
      settingsRepository: repository,
    },
    environment: {},
    now: () => 1_900_000_000_000,
  });
  await application.start();
  return { directory, repository, application };
};

const patchTimeframe = async (
  application: TradingPlatformApplication,
  timeframe: TradingTimeframe,
): Promise<Response> =>
  fetch(`${application.getUrl()}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timeframe }),
  });

const assertRebuiltState = (
  application: TradingPlatformApplication,
  timeframe: TradingTimeframe,
): void => {
  const snapshot = application.store.snapshot(1_900_000_000_000);
  expect(snapshot.settings.timeframe).toBe(timeframe);
  expect(snapshot.overview.timeframe).toBe(timeframe);
  expect(snapshot.timeframe).toMatchObject({ selected: timeframe, state: 'READY' });
  const candles = snapshot.candles[instrumentId] ?? [];
  expect(candles.length).toBeGreaterThan(52);
  expect(candles.every((candle) => candle.timeframe === timeframe)).toBe(true);
  expect(candles.every((candle) => candle.confirmed)).toBe(true);
  expect(candles.map((candle) => candle.timestamp)).toEqual(
    candles.map((candle) => candle.timestamp).slice().sort((a, b) => a - b),
  );
  const last = candles.at(-1);
  expect(last?.fastEma).not.toBeNull();
  expect(last?.slowEma).not.toBeNull();
  expect(last?.rsi).not.toBeNull();
  expect(last?.atr).not.toBeNull();
  expect(snapshot.positions).toHaveLength(0);
  expect(snapshot.trades).toHaveLength(0);
};

afterEach(async () => {
  historyMock.calls.length = 0;
  historyMock.failIntervals.clear();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('trading platform timeframe end-to-end lifecycle', () => {
  it('runs 1m -> 5m -> 15m -> 1H -> 4H -> 1m through the real settings API and rebuilds indicators', async () => {
    const { application } = await createFixture();
    const controller = createController();
    try {
      await application.prepareCandleRuntime({ symbols: [instrumentId], controller });
      assertRebuiltState(application, '1m');

      for (const timeframe of ['5m', '15m', '1H', '4H', '1m'] as const) {
        const before = application.store.snapshot().candles[instrumentId] ?? [];
        const previousTimeframe = application.store.getSettings().timeframe;
        const response = await patchTimeframe(application, timeframe);
        expect(response.status).toBe(200);
        expect((await response.json()) as { timeframe: string }).toMatchObject({ timeframe });
        expect(controller.current).toBe(timeframe);
        assertRebuiltState(application, timeframe);

        const latestHistoryCall = historyMock.calls.at(-1);
        const spec = tradingTimeframeSpec(timeframe);
        expect(latestHistoryCall).toMatchObject({
          instrumentId,
          interval: spec.okxBar,
          intervalMs: spec.intervalMs,
        });
        if (timeframe !== previousTimeframe) {
          const after = application.store.snapshot().candles[instrumentId] ?? [];
          const beforeTimestamps = new Set(before.map((candle) => candle.timestamp));
          expect(after.some((candle) => beforeTimestamps.has(candle.timestamp))).toBe(false);
        }

        // The historical rebuild itself must never create a paper trade. Once the
        // rebuild is READY, a new confirmed live candle is evaluated normally.
        const rebuilt = application.store.snapshot().candles[instrumentId] ?? [];
        const last = rebuilt.at(-1);
        if (!last) throw new Error('expected rebuilt history');
        const liveTimestamp = last.timestamp + spec.intervalMs;
        application.onCandle({
          instId: instrumentId,
          interval: timeframe,
          timestamp: liveTimestamp,
          open: last.close,
          high: last.close + 1,
          low: last.close - 1,
          close: last.close + 0.2,
          volume: 25,
          volumeCurrency: 12,
          volumeCurrencyQuote: (last.close + 0.2) * 12,
          confirm: true,
        });
        const afterLive = application.store.snapshot();
        expect(afterLive.strategyStatus['ema-trend-crossover-v1']?.updatedAt).toBe(
          liveTimestamp,
        );
      }
    } finally {
      await application.close();
    }
  });

  it(
    'accepts every advertised timeframe through the backend and uses its native OKX interval',
    async () => {
      const { application } = await createFixture();
      const controller = createController();
      try {
        await application.prepareCandleRuntime({ symbols: [instrumentId], controller });
        for (const timeframe of TRADING_TIMEFRAMES) {
          if (application.store.getSettings().timeframe !== timeframe) {
            const response = await patchTimeframe(application, timeframe);
            expect(response.status).toBe(200);
          }
          assertRebuiltState(application, timeframe);
          const spec = tradingTimeframeSpec(timeframe);
          expect(historyMock.calls.at(-1)).toMatchObject({
            interval: spec.okxBar,
            intervalMs: spec.intervalMs,
          });
          expect(controller.current).toBe(timeframe);
        }
      } finally {
        await application.close();
      }
    },
    integrationTestTimeoutMs,
  );

  it('persists 15m and restarts directly on 15m without an initial 1m history request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-timeframe-persistence-'));
    directories.push(directory);
    const webDirectory = join(directory, 'web');
    const settingsPath = join(directory, 'settings.json');
    await mkdir(webDirectory, { recursive: true });
    await writeFile(join(webDirectory, 'index.html'), '<h1>dashboard</h1>', 'utf8');
    const repository = new PlatformSettingsRepository(settingsPath);

    const first = new TradingPlatformApplication({
      mode: 'PAPER',
      server: { port: 0, staticDirectory: webDirectory, settingsRepository: repository },
      environment: {},
    });
    const firstController = createController();
    await first.start();
    try {
      await first.prepareCandleRuntime({ symbols: [instrumentId], controller: firstController });
      expect((await patchTimeframe(first, '15m')).status).toBe(200);
      expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({ timeframe: '15m' });
    } finally {
      await first.close();
    }

    historyMock.calls.length = 0;
    const second = new TradingPlatformApplication({
      mode: 'PAPER',
      server: { port: 0, staticDirectory: webDirectory, settingsRepository: repository },
      environment: {},
    });
    const secondController = createController();
    await second.start();
    try {
      expect(second.store.getSettings().timeframe).toBe('15m');
      await second.prepareCandleRuntime({ symbols: [instrumentId], controller: secondController });
      expect(secondController.calls[0]).toBe('15m');
      expect(historyMock.calls[0]?.interval).toBe('15m');
      expect(historyMock.calls.some((call) => call.interval === '1m')).toBe(false);
      assertRebuiltState(second, '15m');
    } finally {
      await second.close();
    }
  });

  it(
    'rolls a failed 4H rebuild back to a coherent 1m subscription, settings, and indicator state',
    async () => {
      const { application } = await createFixture();
      const controller = createController();
      try {
        await application.prepareCandleRuntime({ symbols: [instrumentId], controller });
        historyMock.failIntervals.add('4H');
        const response = await patchTimeframe(application, '4H');
        expect(response.status).toBe(500);
        expect(controller.current).toBe('1m');
        expect(historyMock.calls.slice(-2).map((call) => call.interval)).toEqual([
          '4H',
          '1m',
        ]);
        assertRebuiltState(application, '1m');
        expect(application.store.snapshot().timeframe.message).toContain('1m');
      } finally {
        await application.close();
      }
    },
    integrationTestTimeoutMs,
  );

  it('reconciles a reconnect on 15m without falling back to 1m or duplicating candles', async () => {
    const { application } = await createFixture();
    const controller = createController();
    try {
      await application.prepareCandleRuntime({ symbols: [instrumentId], controller });
      expect((await patchTimeframe(application, '15m')).status).toBe(200);
      const before = application.store.snapshot().candles[instrumentId] ?? [];
      const historyCallsBefore = historyMock.calls.length;

      application.resetSymbols([instrumentId]);
      await waitFor(() => historyMock.calls.length > historyCallsBefore);
      await waitFor(() => application.store.snapshot().timeframe.state === 'READY');

      const after = application.store.snapshot().candles[instrumentId] ?? [];
      expect(historyMock.calls.at(-1)?.interval).toBe('15m');
      expect(controller.current).toBe('15m');
      expect(after).toHaveLength(before.length);
      expect(new Set(after.map((candle) => candle.timestamp)).size).toBe(after.length);
      expect(after.every((candle) => candle.timeframe === '15m')).toBe(true);
      expect(historyMock.calls.slice(historyCallsBefore).some((call) => call.interval === '1m')).toBe(false);
    } finally {
      await application.close();
    }
  });
});
