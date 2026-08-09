import { describe, expect, it } from 'vitest';

import type {
  SqlConnection,
  SqlParameter,
  SqlPool,
  SqlQueryResult,
} from '../src/storage/PostgresResearchStore';
import { PostgresPhase4EvidenceStore } from '../src/storage/Phase4EvidenceStore';

interface RecordedQuery {
  readonly text: string;
  readonly parameters: readonly SqlParameter[];
}

class RecordingConnection implements SqlConnection {
  public readonly queries: RecordedQuery[] = [];
  public released = false;

  public query<Row = Readonly<Record<string, unknown>>>(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.queries.push({ text, parameters });
    return Promise.resolve({ rows: [], rowCount: 1 });
  }

  public release(): void {
    this.released = true;
  }
}

class RecordingPool implements SqlPool {
  public readonly directQueries: RecordedQuery[] = [];
  public readonly connection = new RecordingConnection();
  public ended = false;

  public query<Row = Readonly<Record<string, unknown>>>(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.directQueries.push({ text, parameters });
    return Promise.resolve({ rows: [], rowCount: 1 });
  }

  public connect(): Promise<SqlConnection> {
    return Promise.resolve(this.connection);
  }

  public end(): Promise<void> {
    this.ended = true;
    return Promise.resolve();
  }
}

describe('PostgresPhase4EvidenceStore', () => {
  it('persists feature selection and per-feature decisions atomically', async () => {
    const pool = new RecordingPool();
    const store = new PostgresPhase4EvidenceStore(pool);

    await store.saveFeatureSelection({
      runId: '00000000-0000-0000-0000-000000000001',
      strategyKey: 'derivatives-flow-v1',
      datasetId: 'dataset',
      datasetFingerprint: 'fingerprint',
      codeCommit: 'commit',
      configurationHash: 'config',
      policy: {
        minimumImportanceFoldCount: 3,
        minimumPositiveImportanceFraction: 0.67,
        minimumMedianImportance: 0,
        maximumImportanceCoefficientOfVariation: 2,
        maximumAbsoluteCorrelation: 0.9,
        maximumRetainedResearchFeatures: 8,
      },
      report: {
        status: 'SELECTION_PASSED',
        selectedFeatures: ['cvd'],
        retainedResearchFeatures: ['cvd'],
        retainedSafetyFeatures: [],
        decisions: [
          {
            featureName: 'cvd',
            role: 'ALPHA',
            status: 'RETAINED',
            documentedPurpose: 'Executed-flow confirmation',
            medianImportance: 0.2,
            positiveImportanceFraction: 1,
            importanceCoefficientOfVariation: 0.2,
            selectionScore: 0.16,
            rationale: ['STABLE_IMPORTANCE_AND_PAIRED_ABLATION_SUPPORTED'],
            rejectionReasons: [],
          },
        ],
        rejectionReasons: [],
        liveExecutionAllowed: false,
      },
    });

    expect(pool.connection.queries.map((query) => query.text)).toEqual([
      'BEGIN',
      expect.stringContaining('research.feature_selection_runs'),
      expect.stringContaining('research.feature_selection_results'),
      'COMMIT',
    ]);
    expect(pool.connection.released).toBe(true);
  });

  it('persists paper release evidence with parameterized SQL', async () => {
    const pool = new RecordingPool();
    const store = new PostgresPhase4EvidenceStore(pool);

    await store.savePaperTradingReleaseRun({
      paperRunId: '00000000-0000-0000-0000-000000000002',
      strategyKey: 'derivatives-flow-v1',
      evidence: {
        runId: 'paper-run',
        sourceKind: 'LIVE_MARKET',
        codeCommit: 'commit',
        configurationHash: 'config',
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_086_400_000,
        orderIntentCount: 100,
        dataGapCount: 0,
        duplicateFillCount: 0,
        reconciliationErrorRate: 0,
        statistics: {
          tradeCount: 100,
          winningTrades: 60,
          losingTrades: 40,
          breakevenTrades: 0,
          winRate: 0.6,
          grossProfit: 150,
          grossLoss: 100,
          netProfit: 50,
          profitFactor: 1.5,
          expectancy: 0.5,
          averageR: 0.05,
          sharpeRatio: 1,
          sortinoRatio: 1.2,
          maximumDrawdown: 50,
          maximumDrawdownPercent: 0.1,
          recoveryFactor: 1,
          averageHoldingTimeMs: 60_000,
          totalFees: 10,
          totalFundingPnl: -2,
          equityCurve: [],
        },
      },
    });

    expect(pool.directQueries).toHaveLength(1);
    expect(pool.directQueries[0]?.text).toContain(
      'research.paper_trading_release_runs',
    );
    expect(pool.directQueries[0]?.text).toContain('$13::jsonb');
    expect(pool.directQueries[0]?.parameters).toHaveLength(13);
  });
});
