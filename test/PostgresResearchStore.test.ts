import { describe, expect, it } from 'vitest';

import type {
  SqlConnection,
  SqlParameter,
  SqlPool,
  SqlQueryResult,
} from '../src/storage/PostgresResearchStore';
import { PostgresResearchStore } from '../src/storage/PostgresResearchStore';

interface CapturedQuery {
  readonly text: string;
  readonly parameters: readonly SqlParameter[];
}

class FakeConnection implements SqlConnection {
  public readonly queries: CapturedQuery[] = [];
  public released = false;

  public async query<Row = Readonly<Record<string, unknown>>>(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.queries.push({ text, parameters });
    return { rows: [] as readonly Row[], rowCount: 0 };
  }

  public release(): void {
    this.released = true;
  }
}

class FakePool implements SqlPool {
  public readonly connection = new FakeConnection();
  public readonly directQueries: CapturedQuery[] = [];
  public ended = false;

  public async query<Row = Readonly<Record<string, unknown>>>(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.directQueries.push({ text, parameters });
    return { rows: [] as readonly Row[], rowCount: 0 };
  }

  public async connect(): Promise<SqlConnection> {
    return this.connection;
  }

  public async end(): Promise<void> {
    this.ended = true;
  }
}

const observedAt = 1_700_000_000_000;

describe('PostgresResearchStore', () => {
  it('persists contract metadata before dependent market data', async () => {
    const pool = new FakePool();
    const store = new PostgresResearchStore(pool);

    await store.appendMarketData([
      {
        kind: 'TRADE',
        instrumentId: 'BTC-USDT-SWAP',
        observedAt,
        receivedAt: observedAt + 1,
        source: 'SYNTHETIC_TEST',
        tradeId: '1',
        side: 'BUY',
        price: 100,
        contracts: 2,
      },
      {
        kind: 'CONTRACT_METADATA',
        instrumentId: 'BTC-USDT-SWAP',
        observedAt,
        receivedAt: observedAt,
        source: 'SYNTHETIC_TEST',
        instrumentType: 'SWAP',
        baseCurrency: 'BTC',
        quoteCurrency: 'USDT',
        settlementCurrency: 'USDT',
        contractValue: 0.01,
        contractValueCurrency: 'BTC',
        tickSize: 0.1,
        lotSize: 1,
        minimumContracts: 1,
        maximumLeverage: 100,
        listingTime: null,
        expiryTime: null,
      },
    ]);

    expect(pool.directQueries).toHaveLength(2);
    expect(pool.directQueries[0]?.text).toContain('research.instruments');
    expect(pool.directQueries[1]?.text).toContain('research.market_trades');
  });

  it('commits successful transactions and releases the connection', async () => {
    const pool = new FakePool();
    const store = new PostgresResearchStore(pool);

    const value = await store.withTransaction(async (transaction) => {
      await transaction.appendFeatures([
        {
          featureSetId: '00000000-0000-0000-0000-000000000001',
          instrumentId: 'BTC-USDT-SWAP',
          observedAt,
          featureName: 'cvd',
          featureValue: 0.4,
          sourceMaxObservedAt: observedAt,
          calculationVersion: 1,
        },
      ]);
      return 'done';
    });

    expect(value).toBe('done');
    expect(pool.connection.queries.map((query) => query.text.trim())).toEqual([
      'BEGIN',
      expect.stringContaining('research.features'),
      'COMMIT',
    ]);
    expect(pool.connection.released).toBe(true);
  });

  it('rolls back failed transactions', async () => {
    const pool = new FakePool();
    const store = new PostgresResearchStore(pool);

    await expect(
      store.withTransaction(async () => {
        throw new Error('failed operation');
      }),
    ).rejects.toThrow('failed operation');

    expect(pool.connection.queries.map((query) => query.text.trim())).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(pool.connection.released).toBe(true);
  });

  it('serializes optimization trials without enabling execution', async () => {
    const pool = new FakePool();
    const store = new PostgresResearchStore(pool);

    await store.saveOptimizationTrials([
      {
        experimentId: '00000000-0000-0000-0000-000000000002',
        trialIndex: 0,
        parameters: { threshold: 0.7 },
        foldMetrics: [{ expectancy: 1.2 }],
        objectiveValue: 0.8,
        overfitReasons: [],
        status: 'COMPLETED',
      },
    ]);

    expect(pool.directQueries[0]?.text).toContain(
      'research.hyperparameter_trials',
    );
    expect(pool.directQueries[0]?.parameters).toContain(
      JSON.stringify({ threshold: 0.7 }),
    );
  });
});
