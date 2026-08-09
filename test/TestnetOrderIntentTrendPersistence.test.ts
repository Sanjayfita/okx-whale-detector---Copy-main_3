import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { TestnetOrderIntentTrendSummary } from '../src/safety/testnetOrderIntentTrend';
import {
  createTestnetOrderIntentTrendDocument,
  readTestnetOrderIntentTrendDocument,
  readTestnetOrderIntentTrendDocumentFromText,
  serializeTestnetOrderIntentTrendDocument,
  validateTestnetOrderIntentTrendDocument,
  writeTestnetOrderIntentTrendDocument,
} from '../src/safety/testnetOrderIntentTrendPersistence';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const trend = (): TestnetOrderIntentTrendSummary => ({
  instrumentId: 'BTC-USDT',
  side: 'BUY',
  orderType: 'MARKET',
  direction: 'DECREASING_RISK',
  points: [
    {
      generatedAt: 1_000,
      status: 'PREPARED_FOR_DRY_RUN',
      estimatedNotional: 200,
      maximumNotional: 250,
      quantity: 2,
      referencePrice: 100,
    },
    {
      generatedAt: 2_000,
      status: 'REJECTED',
      estimatedNotional: 100,
      maximumNotional: 150,
      quantity: 1,
      referencePrice: 100,
    },
  ],
  estimatedNotionalChange: -100,
  maximumNotionalChange: -100,
  riskIncreases: 0,
  riskReductions: 1,
  highestEstimatedNotional: 200,
  lowestEstimatedNotional: 100,
  reasons: ['Dry-run intent exposure decreased'],
  dryRunOnly: true,
  transportDispatchAllowed: false,
  testnetExecutionAuthorized: false,
  orderExecutionAuthorized: false,
});

describe('testnet order intent trend persistence', () => {
  it('creates and serializes deterministic versioned documents', () => {
    const document = createTestnetOrderIntentTrendDocument({
      generatedAt: 3_000,
      trend: trend(),
    });

    expect(document.schemaVersion).toBe(1);
    expect(document.generatorVersion).toBe('testnet-order-intent-trend-v1');
    expect(document.trend.direction).toBe('DECREASING_RISK');
    expect(document.trend.orderExecutionAuthorized).toBe(false);
    expect(serializeTestnetOrderIntentTrendDocument(document)).toBe(
      serializeTestnetOrderIntentTrendDocument(document),
    );
  });

  it('writes and reads a document without changing its contents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intent-trend-'));
    directories.push(directory);
    const filePath = join(directory, 'trend.json');
    const document = createTestnetOrderIntentTrendDocument({
      generatedAt: 3_000,
      trend: trend(),
    });

    await writeTestnetOrderIntentTrendDocument(filePath, document);

    expect(await readTestnetOrderIntentTrendDocument(filePath)).toEqual(document);
    expect(await readFile(filePath, 'utf8')).toBe(
      serializeTestnetOrderIntentTrendDocument(document),
    );
  });

  it('rejects malformed JSON and unsupported versions', () => {
    expect(() => readTestnetOrderIntentTrendDocumentFromText('{')).toThrow(
      'Malformed testnet order intent trend JSON',
    );

    expect(() =>
      validateTestnetOrderIntentTrendDocument({
        ...createTestnetOrderIntentTrendDocument({ generatedAt: 3_000, trend: trend() }),
        schemaVersion: 2,
      }),
    ).toThrow('Unsupported testnet order intent trend schema version');
  });

  it('rejects inconsistent derived values and unsafe authorization flags', () => {
    const document = createTestnetOrderIntentTrendDocument({
      generatedAt: 3_000,
      trend: trend(),
    });

    expect(() =>
      validateTestnetOrderIntentTrendDocument({
        ...document,
        trend: { ...document.trend, estimatedNotionalChange: 1 },
      }),
    ).toThrow('trend.estimatedNotionalChange is inconsistent');

    expect(() =>
      validateTestnetOrderIntentTrendDocument({
        ...document,
        trend: { ...document.trend, orderExecutionAuthorized: true },
      }),
    ).toThrow('trend execution safeguards are invalid');
  });

  it('rejects non-chronological points and future trend points', () => {
    const summary = trend();

    expect(() =>
      createTestnetOrderIntentTrendDocument({
        generatedAt: 3_000,
        trend: { ...summary, points: [...summary.points].reverse() },
      }),
    ).toThrow('trend.points must be strictly chronological');

    expect(() =>
      createTestnetOrderIntentTrendDocument({
        generatedAt: 1_500,
        trend: summary,
      }),
    ).toThrow('Latest trend point cannot be newer than document generatedAt');
  });
});
