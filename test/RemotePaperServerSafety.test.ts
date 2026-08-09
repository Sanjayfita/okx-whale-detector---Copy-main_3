import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlatformSettingsRepository } from '../src/platform/PlatformSettingsRepository';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';
import { TradingPlatformEngine } from '../src/platform/TradingPlatformEngine';
import { TradingPlatformServer } from '../src/platform/TradingPlatformServer';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('remote paper server safety', () => {
  it('rejects attempts to switch a production dashboard to LIVE mode', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'remote-paper-server-'));
    directories.push(directory);
    const store = new PlatformStateStore({ now: () => Date.now() });
    const engine = new TradingPlatformEngine(store);
    const server = new TradingPlatformServer(store, engine, {
      host: '127.0.0.1',
      port: 0,
      settingsRepository: new PlatformSettingsRepository(
        join(directory, 'settings.json'),
      ),
      allowLiveMonitoringMode: false,
    });

    await server.start();
    try {
      const response = await fetch(`${server.getUrl()}/api/settings`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'LIVE' }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: 'REMOTE_PAPER_ONLY',
        liveExecutionAllowed: false,
      });
      expect(store.getSettings().mode).toBe('PAPER');
    } finally {
      await server.close();
    }
  });
});
