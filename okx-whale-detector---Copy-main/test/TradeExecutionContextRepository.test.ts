import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tradingStrategyConfig } from '../src/config/tradingStrategyConfig';
import { strategyConfigurationFingerprint } from '../src/platform/DeploymentIdentity';
import { TradeExecutionContextRepository } from '../src/platform/TradeExecutionContextRepository';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('TradeExecutionContextRepository', () => {
  it('persists one immutable deployment/config context per paper trade', () => {
    const directory = mkdtempSync(join(tmpdir(), 'trade-context-'));
    directories.push(directory);
    const path = join(directory, 'trade-contexts.json');
    const repository = new TradeExecutionContextRepository(path);
    const context = {
      tradeId: 'paper:BTC-USDT-SWAP:1000',
      instrumentId: 'BTC-USDT-SWAP',
      strategyId: 'ema-trend-crossover-v1',
      strategyVersion: 'ema-trend-crossover-v1',
      timeframe: '15m' as const,
      strategyConfig: tradingStrategyConfig,
      strategyConfigFingerprint: strategyConfigurationFingerprint(
        tradingStrategyConfig,
      ),
      deployment: {
        gitCommit: 'abcdef123456',
        imageVersion: 'phase12-abcdef1',
        configurationVersion: 'phase12-v1',
      },
      recordedAt: 1_000,
    };

    expect(repository.record(context)).toBe(true);
    expect(repository.record(context)).toBe(false);

    const restored = new TradeExecutionContextRepository(path);
    expect(restored.load()).toEqual([context]);
    expect(restored.get(context.tradeId)).toEqual(context);
  });
});
