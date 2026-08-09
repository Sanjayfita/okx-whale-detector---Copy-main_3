import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformSettingsRepository } from '../src/platform/PlatformSettingsRepository';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';
import { TradingPlatformEngine } from '../src/platform/TradingPlatformEngine';
import { TradingPlatformServer } from '../src/platform/TradingPlatformServer';

const cleanup: Array<() => Promise<void>> = [];

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

describe('TradingPlatformServer', () => {
  it('serves health, snapshot, coordinated settings, kill switch and static dashboard', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trading-platform-server-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const webDirectory = join(directory, 'web');
    await mkdir(webDirectory, { recursive: true });
    await writeFile(join(webDirectory, 'index.html'), '<h1>dashboard</h1>', 'utf8');

    const store = new PlatformStateStore({ now: () => 1_000 });
    const engine = new TradingPlatformEngine(store, { now: () => 1_000 });
    const onSettingsChanged = vi.fn(async () => undefined);
    const server = new TradingPlatformServer(store, engine, {
      port: 0,
      staticDirectory: webDirectory,
      settingsRepository: new PlatformSettingsRepository(
        join(directory, 'settings.json'),
      ),
      onSettingsChanged,
    });
    await server.start();
    cleanup.push(() => server.close());

    const health = await fetch(`${server.getUrl()}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual(
      expect.objectContaining({
        status: 'ok',
        strategy: 'ema-trend-crossover-v1',
        timeframe: '1m',
        liveExecutionAllowed: false,
      }),
    );

    const settings = await fetch(`${server.getUrl()}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ riskPerTradePercent: 0.5, timeframe: '15m' }),
    });
    expect(settings.status).toBe(200);
    expect(await settings.json()).toEqual(
      expect.objectContaining({ riskPerTradePercent: 0.5, timeframe: '15m' }),
    );
    expect(onSettingsChanged).toHaveBeenCalledOnce();
    expect(onSettingsChanged.mock.calls[0]?.[0].timeframe).toBe('1m');
    expect(onSettingsChanged.mock.calls[0]?.[1].timeframe).toBe('15m');

    const invalidTimeframe = await fetch(`${server.getUrl()}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeframe: '1h' }),
    });
    expect(invalidTimeframe.status).toBe(500);
    expect(store.getSettings().timeframe).toBe('15m');

    const kill = await fetch(`${server.getUrl()}/api/risk/kill-switch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    expect(kill.status).toBe(200);
    expect(store.snapshot(1_000).risk.killSwitchActive).toBe(true);

    const page = await fetch(server.getUrl());
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('dashboard');
  });

  it('coalesces high-frequency store publications before dashboard websocket sends', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trading-platform-server-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const webDirectory = join(directory, 'web');
    await mkdir(webDirectory, { recursive: true });
    await writeFile(join(webDirectory, 'index.html'), '<h1>dashboard</h1>', 'utf8');

    const store = new PlatformStateStore({ now: () => 1_000 });
    const engine = new TradingPlatformEngine(store, { now: () => 1_000 });
    const server = new TradingPlatformServer(store, engine, {
      port: 0,
      staticDirectory: webDirectory,
      snapshotBroadcastIntervalMs: 20,
      maximumClientBufferedBytes: 64 * 1024,
      settingsRepository: new PlatformSettingsRepository(
        join(directory, 'settings.json'),
      ),
    });
    await server.start();
    cleanup.push(() => server.close());

    const client = new WebSocket(`${server.getUrl().replace('http:', 'ws:')}/ws`);
    cleanup.push(async () => {
      client.terminate();
    });
    let messages = 0;
    client.on('message', () => {
      messages += 1;
    });
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', reject);
    });
    await sleep(20);
    expect(messages).toBeGreaterThanOrEqual(1);

    for (let index = 0; index < 100; index += 1) {
      store.appendCandle({
        instrumentId: 'BTC-USDT-SWAP',
        timeframe: '1m',
        timestamp: 60_000,
        open: 100,
        high: 101,
        low: 99,
        close: 100 + index / 1_000,
        volume: index + 1,
        confirmed: false,
        fastEma: null,
        slowEma: null,
        rsi: null,
        atr: null,
      });
    }

    await sleep(80);
    const metrics = server.getSnapshotTransportMetrics();
    expect(metrics.snapshotInvalidations).toBe(100);
    expect(metrics.snapshotBroadcasts).toBe(1);
    expect(metrics.snapshotBackpressureSkips).toBe(0);
    expect(metrics.dashboardClients).toBe(1);
    expect(metrics.lastSnapshotPayloadBytes).toBeGreaterThan(0);
    expect(messages).toBe(2);
  });
});
