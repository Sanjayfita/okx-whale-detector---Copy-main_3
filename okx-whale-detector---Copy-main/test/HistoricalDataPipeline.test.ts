import { describe, expect, it } from 'vitest';

import {
  HistoricalDataPipeline,
  type HistoricalStreamCollector,
} from '../src/data/HistoricalDataPipeline';
import type { ResearchMarketDataRecord } from '../src/data/ResearchMarketData';
import type {
  ResearchStore,
  ResearchStoreTransaction,
  StoredBacktest,
  StoredFeatureValue,
  StoredOptimizationExperiment,
  StoredOptimizationTrial,
  StoredSignal,
} from '../src/storage/ResearchStore';

const start = 1_700_000_000_000;

class MemoryStore implements ResearchStore {
  public records: ResearchMarketDataRecord[] = [];
  public transactions = 0;

  public async appendMarketData(
    records: readonly ResearchMarketDataRecord[],
  ): Promise<void> {
    this.records.push(...records);
  }

  public async appendFeatures(
    _features: readonly StoredFeatureValue[],
  ): Promise<void> {}

  public async appendSignals(_signals: readonly StoredSignal[]): Promise<void> {}

  public async saveBacktest(_backtest: StoredBacktest): Promise<void> {}

  public async saveOptimizationExperiment(
    _experiment: StoredOptimizationExperiment,
  ): Promise<void> {}

  public async saveOptimizationTrials(
    _trials: readonly StoredOptimizationTrial[],
  ): Promise<void> {}

  public async withTransaction<T>(
    operation: (transaction: ResearchStoreTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactions += 1;
    return operation(this);
  }

  public async close(): Promise<void> {}
}

const candle = (observedAt: number): ResearchMarketDataRecord => ({
  kind: 'CANDLE',
  instrumentId: 'BTC-USDT-SWAP',
  observedAt,
  receivedAt: observedAt + 1,
  source: 'SYNTHETIC_TEST',
  intervalMs: 60_000,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  contractVolume: 1,
  baseVolume: null,
  quoteVolume: null,
  confirmed: true,
});

describe('HistoricalDataPipeline', () => {
  it('paginates, recovers gaps, validates, and persists atomically', async () => {
    const store = new MemoryStore();
    const cursors: Array<string | null> = [];
    const collector: HistoricalStreamCollector = {
      stream: 'CANDLES',
      expectedIntervalMs: 60_000,
      async loadPage(cursor) {
        cursors.push(cursor);
        return cursor === null
          ? {
              records: [candle(start), candle(start + 60_000)],
              nextCursor: 'page-2',
            }
          : {
              records: [candle(start + 180_000)],
              nextCursor: null,
            };
      },
      async recoverGap(gap) {
        expect(gap.missingFrom).toBe(start + 120_000);
        return [candle(start + 120_000)];
      },
    };
    const pipeline = new HistoricalDataPipeline(store);

    const manifest = await pipeline.collect({
      datasetId: 'dataset-1',
      instrumentId: 'BTC-USDT-SWAP',
      rangeStart: start,
      rangeEnd: start + 180_000,
      createdAt: start + 200_000,
      collectors: [collector],
    });

    expect(cursors).toEqual([null, 'page-2']);
    expect(manifest.status).toBe('PERSISTED');
    expect(manifest.recordCount).toBe(4);
    expect(manifest.streamReports[0]).toMatchObject({
      pageCount: 2,
      recoveredRecordCount: 1,
      remainingGaps: [],
    });
    expect(store.transactions).toBe(1);
    expect(store.records).toHaveLength(4);
    expect(manifest.liveExecutionAllowed).toBe(false);
  });

  it('rejects unresolved gaps without writing partial data', async () => {
    const store = new MemoryStore();
    const pipeline = new HistoricalDataPipeline(store, {
      maximumPagesPerStream: 10,
      maximumRecoveryPasses: 1,
      gapToleranceMs: 0,
      integrity: {
        requireConfirmedCandles: true,
        rejectRecordsOutsideRange: true,
      },
    });

    const manifest = await pipeline.collect({
      datasetId: 'dataset-gap',
      instrumentId: 'BTC-USDT-SWAP',
      rangeStart: start,
      rangeEnd: start + 180_000,
      createdAt: start + 200_000,
      collectors: [
        {
          stream: 'CANDLES',
          expectedIntervalMs: 60_000,
          async loadPage() {
            return {
              records: [candle(start), candle(start + 180_000)],
              nextCursor: null,
            };
          },
          async recoverGap() {
            return [];
          },
        },
      ],
    });

    expect(manifest.status).toBe('REJECTED');
    expect(manifest.rejectionReasons).toContain('CANDLES_GAPS_REMAIN');
    expect(store.records).toEqual([]);
    expect(store.transactions).toBe(0);
  });

  it('rejects repeated pagination cursors', async () => {
    const store = new MemoryStore();
    const pipeline = new HistoricalDataPipeline(store);

    await expect(
      pipeline.collect({
        datasetId: 'dataset-repeat',
        instrumentId: 'BTC-USDT-SWAP',
        rangeStart: start,
        rangeEnd: start + 60_000,
        createdAt: start + 100_000,
        collectors: [
          {
            stream: 'TRADES',
            expectedIntervalMs: null,
            async loadPage() {
              return { records: [], nextCursor: 'same' };
            },
          },
        ],
      }),
    ).rejects.toThrow('TRADES pagination cursor repeated');
  });
});
