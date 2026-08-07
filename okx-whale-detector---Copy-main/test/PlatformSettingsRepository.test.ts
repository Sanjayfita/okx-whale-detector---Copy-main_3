import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { DashboardSettings } from '../src/platform/PlatformContracts';
import { PlatformSettingsRepository } from '../src/platform/PlatformSettingsRepository';

const directories: string[] = [];

const settings: DashboardSettings = {
  mode: 'PAPER',
  activeStrategyId: 'ema-trend-crossover-v1',
  fastEmaLength: 20,
  slowEmaLength: 50,
  rsiPeriod: 14,
  atrPeriod: 14,
  atrMultiplier: 1.5,
  minimumAtrPercent: 0.25,
  maximumAtrPercent: 5,
  riskPerTradePercent: 0.5,
  stopLossPercent: 1,
  takeProfitPercent: 2,
  trailingStopEnabled: true,
  trailingStopPercent: 1,
  autoSave: true,
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('PlatformSettingsRepository', () => {
  it('atomically persists and reloads dashboard settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-settings-'));
    directories.push(directory);
    const path = join(directory, 'nested', 'settings.json');
    const repository = new PlatformSettingsRepository(path);

    expect(await repository.load()).toBeNull();
    await repository.save(settings);
    expect(await repository.load()).toEqual(settings);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(settings);
  });
});
