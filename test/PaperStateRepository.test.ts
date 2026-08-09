import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PaperAccountLedger } from '../src/paper/PaperAccountLedger';
import {
  PaperStateRepository,
  type PersistedPaperRuntimeState,
} from '../src/paper/PaperStateRepository';
import { TradingRiskManager } from '../src/risk/TradingRiskManager';

const directories: string[] = [];

const stateAt = (savedAt: number): PersistedPaperRuntimeState => {
  const account = new PaperAccountLedger(10_000);
  const risk = new TradingRiskManager();
  return {
    schemaVersion: 1,
    savedAt,
    account: account.exportState(),
    risk: risk.exportState(),
    context: {
      activeStrategyId: 'ema-trend-crossover-v1',
      timeframe: '15m',
      lastConfirmedCandleByInstrument: {
        'BTC-USDT-SWAP': 1_800_000,
      },
    },
  };
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('PaperStateRepository', () => {
  it('atomically saves and reloads an explicit versioned paper state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-state-'));
    directories.push(directory);
    const filePath = join(directory, 'paper-state.json');
    const repository = new PaperStateRepository({ filePath });

    repository.save(stateAt(1_000));

    expect(repository.load()).toMatchObject({
      schemaVersion: 1,
      savedAt: 1_000,
      context: {
        timeframe: '15m',
        lastConfirmedCandleByInstrument: {
          'BTC-USDT-SWAP': 1_800_000,
        },
      },
    });
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
      savedAt: 1_000,
    });
  });

  it('keeps the previous valid state when a crash occurs before atomic rename', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-state-crash-'));
    directories.push(directory);
    const filePath = join(directory, 'paper-state.json');
    new PaperStateRepository({ filePath }).save(stateAt(1_000));

    const crashing = new PaperStateRepository({
      filePath,
      beforeCommit: () => {
        throw new Error('simulated process crash');
      },
    });
    expect(() => crashing.save(stateAt(2_000))).toThrow(/simulated process crash/u);

    const recovered = new PaperStateRepository({ filePath }).load();
    expect(recovered?.savedAt).toBe(1_000);
  });

  it('returns null for a fresh installation with no paper state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-state-empty-'));
    directories.push(directory);
    const repository = new PaperStateRepository({
      filePath: join(directory, 'missing.json'),
    });

    expect(repository.load()).toBeNull();
  });
});
