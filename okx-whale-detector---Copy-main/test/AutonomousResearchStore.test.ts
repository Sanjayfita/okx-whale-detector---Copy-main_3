import { describe, expect, it } from 'vitest';

import { discoverAdaptiveFeatures } from '../src/autonomy/AdaptiveFeatureDiscovery';
import { buildAutonomousResearchCycle } from '../src/autonomy/AutonomousResearchLaboratory';
import { planDistributedBacktests } from '../src/autonomy/DistributedBacktest';
import { generateAutonomousHypotheses } from '../src/autonomy/ResearchHypothesis';
import { generateStrategyCandidates } from '../src/research/StrategyCandidateGenerator';
import { PostgresAutonomousResearchStore } from '../src/storage/AutonomousResearchStore';
import type {
  SqlConnection,
  SqlParameter,
  SqlPool,
  SqlQueryResult,
} from '../src/storage/PostgresResearchStore';

class RecordingConnection implements SqlConnection {
  public readonly calls: Array<{
    readonly text: string;
    readonly parameters: readonly SqlParameter[];
  }> = [];
  public released = false;

  public async query<Row = Readonly<Record<string, unknown>>>(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, parameters });
    return { rows: [], rowCount: 1 };
  }

  public release(): void {
    this.released = true;
  }
}

class RecordingPool implements SqlPool {
  public readonly connection = new RecordingConnection();
  public readonly directCalls: Array<{
    readonly text: string;
    readonly parameters: readonly SqlParameter[];
  }> = [];

  public async connect(): Promise<SqlConnection> {
    return this.connection;
  }

  public async query<Row = Readonly<Record<string, unknown>>>(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.directCalls.push({ text, parameters });
    return { rows: [], rowCount: 1 };
  }

  public async end(): Promise<void> {}
}

const bundle = () => {
  const datasetFingerprint = 'dataset';
  const codeCommit = 'commit';
  const configurationHash = 'config';
  const hypotheses = generateAutonomousHypotheses({
    datasetFingerprint,
    codeCommit,
    configurationHash,
    availableDataCapabilities: ['CANDLES'],
    templates: [
      {
        templateId: 'trend',
        kind: 'STRATEGY_VARIANT',
        strategyId: 'trend-following',
        strategyVersion: 1,
        researchQuestion: 'question',
        rationale: 'rationale',
        falsificationCriterion: 'criterion',
        featureSets: [['trendEfficiency']],
        parameterSpace: { threshold: [0.3] },
        requiredDataCapabilities: ['CANDLES'],
        complexityUnits: 1,
      },
    ],
  });
  const features = discoverAdaptiveFeatures({
    datasetFingerprint,
    codeCommit,
    configurationHash,
    availableDataCapabilities: ['CANDLES'],
    baseFeatures: [
      {
        featureName: 'trendEfficiency',
        role: 'ALPHA',
        requiredDataCapabilities: ['CANDLES'],
        maximumSourceLookbackMs: 60_000,
        targetDerived: false,
      },
    ],
    recipes: [
      {
        recipeId: 'identity',
        operation: 'IDENTITY',
        arity: 1,
        windowsMs: [],
        complexityUnits: 1,
      },
    ],
  });
  const candidates = generateStrategyCandidates({
    strategyId: 'trend-following',
    strategyVersion: 1,
    hypothesisFamilyId: 'trend-family',
    datasetFingerprint,
    codeCommit,
    configurationHash,
    parameterSpace: { threshold: [0.3] },
    discoveryScope: 'PURGED_DISCOVERY',
    holdoutAccessed: false,
  });
  const backtestPlan = planDistributedBacktests({
    datasetFingerprint,
    codeCommit,
    configurationHash,
    candidates: candidates.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      candidateFingerprint: candidate.candidateFingerprint,
    })),
    scenarios: [
      { scenarioId: 'baseline', assumptionsFingerprint: 'assumptions' },
    ],
    observations: [
      {
        observationId: 'observation',
        episodeId: 'episode',
        instrumentId: 'BTC-USDT-SWAP',
        foldId: 'fold-1',
        observedAt: 1,
      },
    ],
    discoveryOnly: true,
    holdoutAccessed: false,
    policy: { shardCount: 1 },
  });
  const cycle = buildAutonomousResearchCycle({
    cycleId: 'cycle-1',
    datasetFingerprint,
    codeCommit,
    configurationHash,
    createdAt: 10,
    hypothesisReport: hypotheses,
    featureReport: features,
    candidateReports: [candidates],
    backtestPlan,
  });
  return { cycle, hypotheses, features, backtestPlan };
};

describe('PostgresAutonomousResearchStore', () => {
  it('persists a complete cycle bundle in one transaction', async () => {
    const pool = new RecordingPool();
    const store = new PostgresAutonomousResearchStore(pool);
    await store.persistCycleBundle(bundle());

    expect(pool.connection.calls[0]?.text).toBe('BEGIN');
    expect(pool.connection.calls.at(-1)?.text).toBe('COMMIT');
    expect(
      pool.connection.calls.some((call) =>
        call.text.includes('autonomous_research_cycles'),
      ),
    ).toBe(true);
    expect(
      pool.connection.calls.some((call) =>
        call.text.includes('autonomous_research_hypotheses'),
      ),
    ).toBe(true);
    expect(
      pool.connection.calls.some((call) =>
        call.text.includes('adaptive_feature_candidates'),
      ),
    ).toBe(true);
    expect(
      pool.connection.calls.some((call) =>
        call.text.includes('distributed_backtest_work_units'),
      ),
    ).toBe(true);
    expect(pool.connection.released).toBe(true);
  });

  it('rejects mismatched evidence before opening a transaction', async () => {
    const pool = new RecordingPool();
    const store = new PostgresAutonomousResearchStore(pool);
    const evidence = bundle();
    await expect(
      store.persistCycleBundle({
        ...evidence,
        cycle: {
          ...evidence.cycle,
          hypothesisFamilyFingerprint: 'wrong',
        },
      }),
    ).rejects.toThrow('fingerprints do not match');
    expect(pool.connection.calls).toEqual([]);
  });

  it('persists task state and backtest results through parameterized writes', async () => {
    const pool = new RecordingPool();
    const store = new PostgresAutonomousResearchStore(pool);
    await store.persistTaskSnapshot({
      taskId: 'task-1',
      cycleId: 'cycle-1',
      taskType: 'BACKTEST_SHARD',
      dependencyTaskIds: [],
      priority: 1,
      createdAt: 1,
      maximumAttempts: 3,
      leaseDurationMs: 100,
      resourceUnits: 1,
      payloadFingerprint: 'payload',
      status: 'COMPLETED',
      attemptCount: 1,
      leasedBy: null,
      leaseExpiresAt: null,
      resultFingerprint: 'result',
      failureReason: null,
      updatedAt: 2,
    });
    await store.persistBacktestResult({
      workUnitId: 'work-1',
      workUnitFingerprint: 'work-fingerprint',
      resultFingerprint: 'result-fingerprint',
      workerId: 'worker',
      startedAt: 1,
      completedAt: 2,
      observationCount: 1,
      independentEpisodeCount: 1,
      tradeCount: 1,
      netPnl: 1,
      grossProfit: 1,
      grossLoss: 0,
      maximumDrawdownFraction: 0,
      status: 'COMPLETED',
      failureReason: null,
      liveExecutionAllowed: false,
    });

    expect(pool.directCalls).toHaveLength(2);
    expect(pool.directCalls[0]?.text).toContain('UPDATE');
    expect(pool.directCalls[1]?.text).toContain(
      'distributed_backtest_results',
    );
  });
});
