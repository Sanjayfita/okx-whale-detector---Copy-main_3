import { describe, expect, it } from 'vitest';

import {
  ContinuousDerivativesCollector,
  type ContinuousCollectionCheckpoint,
  type ContinuousCollectionManifest,
  type ContinuousCollectionStore,
  type ContinuousCollectionSource,
} from '../src/data/ContinuousDerivativesCollector';
import type { ResearchMarketDataRecord } from '../src/data/ResearchMarketData';

class MemoryStore implements ContinuousCollectionStore {
  public checkpoint: ContinuousCollectionCheckpoint | null = null;
  public persistedRecords: readonly ResearchMarketDataRecord[] = [];
  public manifests: ContinuousCollectionManifest[] = [];

  public loadCheckpoint(): Promise<ContinuousCollectionCheckpoint | null> {
    return Promise.resolve(this.checkpoint);
  }

  public persist(input: {
    readonly records: readonly ResearchMarketDataRecord[];
    readonly checkpoint: ContinuousCollectionCheckpoint;
    readonly manifest: ContinuousCollectionManifest;
  }): Promise<void> {
    this.persistedRecords = input.records;
    this.checkpoint = input.checkpoint;
    this.manifests.push(input.manifest);
    return Promise.resolve();
  }

  public persistRejectedManifest(
    manifest: ContinuousCollectionManifest,
  ): Promise<void> {
    this.manifests.push(manifest);
    return Promise.resolve();
  }
}

const trade = (
  observedAt: number,
  tradeId: string,
  source: ResearchMarketDataRecord['source'] = 'OKX_WEBSOCKET',
): ResearchMarketDataRecord => ({
  kind: 'TRADE',
  instrumentId: 'BTC-USDT-SWAP',
  observedAt,
  receivedAt: observedAt + 5,
  source,
  tradeId,
  side: 'BUY',
  price: 50_000,
  contracts: 1,
});

describe('ContinuousDerivativesCollector', () => {
  it('recovers a timestamp gap before atomically advancing the checkpoint', async () => {
    const store = new MemoryStore();
    store.checkpoint = {
      sourceId: 'btc-trades',
      cursor: 'previous',
      lastObservedAt: 0,
      lastSequenceId: null,
      updatedAt: 0,
    };
    const source: ContinuousCollectionSource = {
      sourceId: 'btc-trades',
      instrumentId: 'BTC-USDT-SWAP',
      expectedIntervalMs: 1_000,
      load: () =>
        Promise.resolve({
          records: [trade(1_000, '1'), trade(3_000, '3')],
          nextCursor: 'next',
          sourceWatermark: 3_000,
        }),
      recover: () => Promise.resolve([trade(2_000, '2')]),
    };

    const manifest = await new ContinuousDerivativesCollector(store).runCycle({
      source,
      cycleStartedAt: 3_000,
      cycleCompletedAt: 3_100,
    });

    expect(manifest.status).toBe('PERSISTED');
    expect(manifest.recoveredRecordCount).toBe(1);
    expect(store.persistedRecords.map((record) => record.observedAt)).toEqual([
      1_000,
      2_000,
      3_000,
    ]);
    expect(store.checkpoint?.cursor).toBe('next');
    expect(store.checkpoint?.lastObservedAt).toBe(3_000);
  });

  it('recovers the trailing interval up to the source watermark', async () => {
    const store = new MemoryStore();
    const recoveryRequests: Array<{
      readonly fromObservedAt: number;
      readonly toObservedAt: number;
    }> = [];
    const source: ContinuousCollectionSource = {
      sourceId: 'btc-trades',
      instrumentId: 'BTC-USDT-SWAP',
      expectedIntervalMs: 1_000,
      load: () =>
        Promise.resolve({
          records: [trade(1_000, '1'), trade(2_000, '2')],
          nextCursor: 'next',
          sourceWatermark: 4_000,
        }),
      recover: ({ fromObservedAt, toObservedAt }) => {
        recoveryRequests.push({ fromObservedAt, toObservedAt });
        return Promise.resolve([trade(3_000, '3'), trade(4_000, '4')]);
      },
    };

    const manifest = await new ContinuousDerivativesCollector(store).runCycle({
      source,
      cycleStartedAt: 4_000,
      cycleCompletedAt: 4_100,
    });

    expect(manifest.status).toBe('PERSISTED');
    expect(recoveryRequests).toEqual([
      { fromObservedAt: 3_000, toObservedAt: 4_000 },
    ]);
    expect(store.checkpoint?.lastObservedAt).toBe(4_000);
  });

  it('rejects an unresolved trailing watermark gap', async () => {
    const store = new MemoryStore();
    const originalCheckpoint: ContinuousCollectionCheckpoint = {
      sourceId: 'btc-trades',
      cursor: 'safe',
      lastObservedAt: 1_000,
      lastSequenceId: null,
      updatedAt: 1_000,
    };
    store.checkpoint = originalCheckpoint;
    const source: ContinuousCollectionSource = {
      sourceId: 'btc-trades',
      instrumentId: 'BTC-USDT-SWAP',
      expectedIntervalMs: 1_000,
      load: () =>
        Promise.resolve({
          records: [trade(2_000, '2')],
          nextCursor: 'unsafe',
          sourceWatermark: 4_000,
        }),
      recover: () => Promise.resolve([]),
    };

    const manifest = await new ContinuousDerivativesCollector(store).runCycle({
      source,
      cycleStartedAt: 4_000,
      cycleCompletedAt: 4_100,
    });

    expect(manifest.status).toBe('REJECTED');
    expect(manifest.rejectionReasons).toContain('UNRESOLVED_TIMESTAMP_GAP');
    expect(store.checkpoint).toEqual(originalCheckpoint);
  });

  it('rejects synthetic records and leaves the checkpoint unchanged', async () => {
    const store = new MemoryStore();
    const originalCheckpoint: ContinuousCollectionCheckpoint = {
      sourceId: 'btc-trades',
      cursor: 'safe',
      lastObservedAt: 1_000,
      lastSequenceId: null,
      updatedAt: 1_000,
    };
    store.checkpoint = originalCheckpoint;
    const source: ContinuousCollectionSource = {
      sourceId: 'btc-trades',
      instrumentId: 'BTC-USDT-SWAP',
      expectedIntervalMs: null,
      load: () =>
        Promise.resolve({
          records: [trade(2_000, '2', 'SYNTHETIC_TEST')],
          nextCursor: 'unsafe',
          sourceWatermark: 2_000,
        }),
    };

    const manifest = await new ContinuousDerivativesCollector(store).runCycle({
      source,
      cycleStartedAt: 2_000,
      cycleCompletedAt: 2_100,
    });

    expect(manifest.status).toBe('REJECTED');
    expect(manifest.rejectionReasons).toContain('SYNTHETIC_DATA_REJECTED');
    expect(store.checkpoint).toEqual(originalCheckpoint);
    expect(store.persistedRecords).toEqual([]);
  });

  it('rejects receive timestamps that precede exchange time', async () => {
    const store = new MemoryStore();
    const invalid = {
      ...trade(5_000, '5'),
      receivedAt: 3_000,
    } as ResearchMarketDataRecord;
    const source: ContinuousCollectionSource = {
      sourceId: 'btc-trades',
      instrumentId: 'BTC-USDT-SWAP',
      expectedIntervalMs: null,
      load: () =>
        Promise.resolve({
          records: [invalid],
          nextCursor: null,
          sourceWatermark: 5_000,
        }),
    };

    const manifest = await new ContinuousDerivativesCollector(store).runCycle({
      source,
      cycleStartedAt: 5_000,
      cycleCompletedAt: 5_100,
    });

    expect(manifest.status).toBe('REJECTED');
    expect(manifest.rejectionReasons).toContain(
      'RECEIVE_BEFORE_EXCHANGE_TIMESTAMP',
    );
  });

  it('throws on conflicting duplicate identities', async () => {
    const store = new MemoryStore();
    const conflicting = {
      ...trade(1_000, 'same'),
      price: 51_000,
    } as ResearchMarketDataRecord;
    const source: ContinuousCollectionSource = {
      sourceId: 'btc-trades',
      instrumentId: 'BTC-USDT-SWAP',
      expectedIntervalMs: null,
      load: () =>
        Promise.resolve({
          records: [trade(1_000, 'same'), conflicting],
          nextCursor: null,
          sourceWatermark: 1_000,
        }),
    };

    await expect(
      new ContinuousDerivativesCollector(store).runCycle({
        source,
        cycleStartedAt: 1_000,
        cycleCompletedAt: 1_100,
      }),
    ).rejects.toThrow('Conflicting duplicate continuous record');
  });
});
