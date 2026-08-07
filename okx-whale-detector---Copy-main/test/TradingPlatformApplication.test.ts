import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TradingPlatformApplication } from '../src/platform/TradingPlatformApplication';

describe('TradingPlatformApplication', () => {
  it('starts the dashboard composition root with paper mode and live orders disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trading-platform-app-'));
    const webDirectory = join(directory, 'web');
    await mkdir(webDirectory, { recursive: true });
    await writeFile(join(webDirectory, 'index.html'), '<h1>platform</h1>', 'utf8');

    const application = new TradingPlatformApplication({
      mode: 'PAPER',
      startingEquity: 7_500,
      server: {
        port: 0,
        staticDirectory: webDirectory,
      },
      environment: {},
      now: () => 1_000,
    });

    try {
      await application.start();
      const snapshot = application.store.snapshot(1_000);
      expect(snapshot.overview.accountEquity).toBe(7_500);
      expect(snapshot.overview.mode).toBe('PAPER');
      expect(snapshot.liveExecutionAllowed).toBe(false);
      expect(application.getUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    } finally {
      await application.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
