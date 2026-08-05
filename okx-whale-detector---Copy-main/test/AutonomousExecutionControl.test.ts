import { describe, expect, it } from 'vitest';

import { rankAutonomousResearchCandidates } from '../src/autonomy/AutonomousResearchRanking';
import {
  aggregateDistributedBacktests,
  createBacktestWorkUnitResult,
  planDistributedBacktests,
  type BacktestWorkUnitResult,
} from '../src/autonomy/DistributedBacktest';
import {
  ExperimentScheduler,
  type ExperimentTaskSpec,
} from '../src/autonomy/ExperimentScheduler';

describe('ExperimentScheduler', () => {
  const tasks = (): readonly ExperimentTaskSpec[] => [
    {
      taskId: 'generate',
      cycleId: 'cycle-1',
      taskType: 'HYPOTHESIS_GENERATION',
      dependencyTaskIds: [],
      priority: 10,
      createdAt: 1,
      maximumAttempts: 2,
      leaseDurationMs: 100,
      resourceUnits: 1,
      payloadFingerprint: 'payload-generate',
    },
    {
      taskId: 'backtest',
      cycleId: 'cycle-1',
      taskType: 'BACKTEST_SHARD',
      dependencyTaskIds: ['generate'],
      priority: 5,
      createdAt: 2,
      maximumAttempts: 2,
      leaseDurationMs: 100,
      resourceUnits: 2,
      payloadFingerprint: 'payload-backtest',
    },
  ];

  it('enforces dependencies, leases, resources, and idempotent completion', () => {
    const scheduler = new ExperimentScheduler(tasks());
    const first = scheduler.claim({
      workerId: 'worker-1',
      now: 10,
      availableResourceUnits: 1,
    });
    expect(first?.taskId).toBe('generate');
    expect(
      scheduler.claim({ workerId: 'worker-2', now: 11, availableResourceUnits: 5 }),
    ).toBeNull();
    scheduler.complete({
      taskId: 'generate',
      workerId: 'worker-1',
      now: 20,
      resultFingerprint: 'result-generate',
    });
    const replay = scheduler.complete({
      taskId: 'generate',
      workerId: 'worker-1',
      now: 21,
      resultFingerprint: 'result-generate',
    });
    expect(replay.status).toBe('COMPLETED');
    expect(
      scheduler.claim({ workerId: 'worker-2', now: 22, availableResourceUnits: 1 }),
    ).toBeNull();
    expect(
      scheduler.claim({ workerId: 'worker-2', now: 22, availableResourceUnits: 2 })
        ?.taskId,
    ).toBe('backtest');
  });

  it('retries expired leases and blocks dependents after terminal failure', () => {
    const scheduler = new ExperimentScheduler(tasks());
    scheduler.claim({ workerId: 'worker-1', now: 10, availableResourceUnits: 1 });
    const retry = scheduler.claim({
      workerId: 'worker-2',
      now: 111,
      availableResourceUnits: 1,
    });
    expect(retry?.attemptCount).toBe(2);
    scheduler.fail({
      taskId: 'generate',
      workerId: 'worker-2',
      now: 120,
      reason: 'deterministic failure',
      retryable: true,
    });
    const snapshot = scheduler.snapshot(121);
    expect(snapshot.counts.FAILED).toBe(1);
    expect(snapshot.counts.BLOCKED).toBe(1);
    expect(snapshot.liveExecutionAllowed).toBe(false);
  });

  it('rejects cyclic task graphs', () => {
    expect(
      () =>
        new ExperimentScheduler([
          { ...tasks()[0]!, dependencyTaskIds: ['backtest'] },
          tasks()[1]!,
        ]),
    ).toThrow('dependency cycle');
  });
});

describe('distributed backtest protocol', () => {
  const plan = () =>
    planDistributedBacktests({
      datasetFingerprint: 'dataset',
      codeCommit: 'commit',
      configurationHash: 'config',
      candidates: [
        { candidateId: 'candidate-1', candidateFingerprint: 'candidate-fp-1' },
      ],
      scenarios: [
        { scenarioId: 'baseline', assumptionsFingerprint: 'assumptions-1' },
      ],
      observations: [
        {
          observationId: 'observation-1',
          episodeId: 'episode-1',
          instrumentId: 'BTC-USDT-SWAP',
          foldId: 'fold-1',
          observedAt: 1,
        },
        {
          observationId: 'observation-2',
          episodeId: 'episode-2',
          instrumentId: 'BTC-USDT-SWAP',
          foldId: 'fold-1',
          observedAt: 2,
        },
      ],
      discoveryOnly: true,
      holdoutAccessed: false,
      policy: { shardCount: 2 },
    });

  const resultFor = (
    workUnit: ReturnType<typeof plan>['workUnits'][number],
  ): BacktestWorkUnitResult =>
    createBacktestWorkUnitResult({
      workUnitId: workUnit.workUnitId,
      workUnitFingerprint: workUnit.workUnitFingerprint,
      workerId: 'worker',
      startedAt: 10,
      completedAt: 20,
      observationCount: workUnit.observationIds.length,
      independentEpisodeCount: workUnit.episodeIds.length,
      tradeCount: workUnit.observationIds.length,
      netPnl: 2,
      grossProfit: 3,
      grossLoss: 1,
      maximumDrawdownFraction: 0.05,
      status: 'COMPLETED',
      failureReason: null,
      liveExecutionAllowed: false,
    });

  it('creates deterministic shards and aggregates only complete result sets', () => {
    const first = plan();
    const second = plan();
    expect(first).toEqual(second);
    expect(first.status).toBe('PLANNED');
    expect(first.workUnitCount).toBeGreaterThan(0);
    const report = aggregateDistributedBacktests({
      plan: first,
      results: first.workUnits.map(resultFor),
    });
    expect(report.status).toBe('COMPLETE');
    expect(report.candidateScenarioResults[0]?.profitFactor).toBe(3);
    expect(report.strategyPromotionAllowed).toBe(false);
  });

  it('fails closed on missing and duplicate work-unit results', () => {
    const backtestPlan = plan();
    const firstResult = resultFor(backtestPlan.workUnits[0]!);
    const report = aggregateDistributedBacktests({
      plan: backtestPlan,
      results: [firstResult, firstResult],
    });
    expect(report.status).toBe('REJECTED');
    expect(report.rejectionReasons).toContain('DUPLICATE_RESULTS');
  });

  it('rejects tampered result metrics and coverage', () => {
    const backtestPlan = plan();
    const valid = resultFor(backtestPlan.workUnits[0]!);
    const tampered = { ...valid, netPnl: valid.netPnl + 1 };
    const fingerprintReport = aggregateDistributedBacktests({
      plan: backtestPlan,
      results: [tampered],
    });
    expect(fingerprintReport.status).toBe('REJECTED');
    expect(fingerprintReport.rejectionReasons).toContain(
      'RESULT_FINGERPRINT_MISMATCH',
    );

    const invalidCoverage = createBacktestWorkUnitResult({
      ...valid,
      observationCount: valid.observationCount + 1,
    });
    const coverageReport = aggregateDistributedBacktests({
      plan: backtestPlan,
      results: [invalidCoverage],
    });
    expect(coverageReport.status).toBe('REJECTED');
    expect(coverageReport.rejectionReasons).toContain('RESULT_COVERAGE_MISMATCH');
  });

  it('rejects one independent episode spanning folds or instruments', () => {
    const report = planDistributedBacktests({
      datasetFingerprint: 'dataset',
      codeCommit: 'commit',
      configurationHash: 'config',
      candidates: [
        { candidateId: 'candidate-1', candidateFingerprint: 'candidate-fp-1' },
      ],
      scenarios: [
        { scenarioId: 'baseline', assumptionsFingerprint: 'assumptions-1' },
      ],
      observations: [
        {
          observationId: 'observation-1',
          episodeId: 'shared-episode',
          instrumentId: 'BTC-USDT-SWAP',
          foldId: 'fold-1',
          observedAt: 1,
        },
        {
          observationId: 'observation-2',
          episodeId: 'shared-episode',
          instrumentId: 'BTC-USDT-SWAP',
          foldId: 'fold-2',
          observedAt: 2,
        },
      ],
      discoveryOnly: true,
      holdoutAccessed: false,
    });

    expect(report.status).toBe('REJECTED');
    expect(report.workUnits).toEqual([]);
    expect(report.rejectionReasons).toContain(
      'EPISODE_SPANS_FOLD_OR_INSTRUMENT',
    );
  });
});

describe('rankAutonomousResearchCandidates', () => {
  it('ranks complete discovery evidence without authorizing promotion', () => {
    const base = {
      experimentCompleted: true,
      dataQualityPassed: true,
      splitIntegrityPassed: true,
      robustnessPassed: true,
      scenarioCount: 5,
      completedScenarioCount: 5,
      independentEpisodeCount: 200,
      tradeCount: 250,
      profitFactor: 1.3,
      maximumDrawdownFraction: 0.1,
      expectedShortfallReturnFraction: -0.05,
      probabilityOfRuin: 0,
      hypothesisFamilySize: 20,
      complexityUnits: 5,
    };
    const report = rankAutonomousResearchCandidates({
      candidates: [
        {
          ...base,
          candidateId: 'replicate',
          candidateFingerprint: 'fp-replicate',
          expectancyConfidenceLower: 0.02,
          adjustedPValue: 0.01,
        },
        {
          ...base,
          candidateId: 'explore',
          candidateFingerprint: 'fp-explore',
          expectancyConfidenceLower: -0.01,
          adjustedPValue: 0.2,
        },
        {
          ...base,
          candidateId: 'blocked',
          candidateFingerprint: 'fp-blocked',
          expectancyConfidenceLower: 0.03,
          adjustedPValue: 0.01,
          independentEpisodeCount: 10,
        },
      ],
    });

    expect(report.rankedCount).toBe(2);
    expect(report.replicationPriorityCount).toBe(1);
    expect(report.rows[0]?.candidateId).toBe('replicate');
    expect(
      report.rows.find((row) => row.candidateId === 'blocked')?.evidenceStatus,
    ).toBe('BLOCKED');
    expect(report.strategyPromotionAllowed).toBe(false);
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('rejects impossible probability and drawdown evidence', () => {
    expect(() =>
      rankAutonomousResearchCandidates({
        candidates: [
          {
            candidateId: 'invalid',
            candidateFingerprint: 'invalid-fingerprint',
            experimentCompleted: true,
            dataQualityPassed: true,
            splitIntegrityPassed: true,
            robustnessPassed: true,
            scenarioCount: 1,
            completedScenarioCount: 1,
            independentEpisodeCount: 100,
            tradeCount: 100,
            expectancyConfidenceLower: 0.01,
            adjustedPValue: 1.1,
            profitFactor: 1.2,
            maximumDrawdownFraction: 0.1,
            expectedShortfallReturnFraction: -0.1,
            probabilityOfRuin: 0,
            hypothesisFamilySize: 1,
            complexityUnits: 1,
          },
        ],
      }),
    ).toThrow('adjustedPValue');
  });
});
