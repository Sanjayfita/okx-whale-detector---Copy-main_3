import assert from 'node:assert/strict';

import { discoverAdaptiveFeatures } from '../autonomy/AdaptiveFeatureDiscovery';
import { buildAutonomousResearchCycle } from '../autonomy/AutonomousResearchLaboratory';
import {
  buildContinuousResearchReport,
  renderContinuousResearchReportMarkdown,
  type ContinuousResearchReport,
} from '../autonomy/ContinuousResearchReport';
import { planDistributedBacktests } from '../autonomy/DistributedBacktest';
import { ExperimentScheduler } from '../autonomy/ExperimentScheduler';
import { generateAutonomousHypotheses } from '../autonomy/ResearchHypothesis';
import { generateStrategyCandidates } from '../research/StrategyCandidateGenerator';

export const runAutonomousResearchSimulation = (): ContinuousResearchReport => {
  const datasetFingerprint = 'simulation-discovery-dataset';
  const codeCommit = 'simulation-commit';
  const configurationHash = 'simulation-configuration';
  const hypotheses = generateAutonomousHypotheses({
    datasetFingerprint,
    codeCommit,
    configurationHash,
    availableDataCapabilities: ['CANDLES', 'TRADES', 'BOOKS'],
    templates: [
      {
        templateId: 'trend-efficiency-ablation',
        kind: 'REGIME_CONDITION',
        strategyId: 'trend-following-v1',
        strategyVersion: 1,
        researchQuestion:
          'Does trend efficiency improve out-of-sample continuation expectancy?',
        rationale:
          'Trend-following should be falsified outside regimes where directional movement is efficient.',
        falsificationCriterion:
          'Reject when familywise-corrected ablation or paired strategy comparison has a non-positive lower confidence bound.',
        featureSets: [['trendEfficiency', 'realizedVolatility']],
        parameterSpace: {
          minimumTrendEfficiency: [0.3, 0.4],
          maximumVolatilityPercentile: [0.8, 0.9],
        },
        requiredDataCapabilities: ['CANDLES', 'TRADES'],
        complexityUnits: 4,
      },
    ],
  });
  const features = discoverAdaptiveFeatures({
    datasetFingerprint,
    codeCommit,
    configurationHash,
    availableDataCapabilities: ['CANDLES', 'TRADES', 'BOOKS'],
    baseFeatures: [
      {
        featureName: 'trendEfficiency',
        role: 'ALPHA',
        requiredDataCapabilities: ['CANDLES'],
        maximumSourceLookbackMs: 60 * 60_000,
        targetDerived: false,
      },
      {
        featureName: 'aggressiveDelta',
        role: 'ALPHA',
        requiredDataCapabilities: ['TRADES'],
        maximumSourceLookbackMs: 5 * 60_000,
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
      {
        recipeId: 'interaction-15m',
        operation: 'INTERACTION',
        arity: 2,
        windowsMs: [15 * 60_000],
        complexityUnits: 3,
      },
    ],
  });
  const candidates = generateStrategyCandidates({
    strategyId: 'trend-following-v1',
    strategyVersion: 1,
    hypothesisFamilyId: 'trend-efficiency-ablation',
    datasetFingerprint,
    codeCommit,
    configurationHash,
    parameterSpace: {
      minimumTrendEfficiency: [0.3, 0.4],
      maximumVolatilityPercentile: [0.8, 0.9],
    },
    discoveryScope: 'PURGED_DISCOVERY',
    holdoutAccessed: false,
  });
  const observations = Array.from({ length: 8 }, (_, index) => ({
    observationId: `observation-${String(index + 1).padStart(2, '0')}`,
    episodeId: `episode-${String(index + 1).padStart(2, '0')}`,
    instrumentId: index % 2 === 0 ? 'BTC-USDT-SWAP' : 'ETH-USDT-SWAP',
    foldId: index < 4 ? 'fold-1' : 'fold-2',
    observedAt: index + 1,
  }));
  const backtestPlan = planDistributedBacktests({
    datasetFingerprint,
    codeCommit,
    configurationHash,
    candidates: candidates.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      candidateFingerprint: candidate.candidateFingerprint,
    })),
    scenarios: [
      { scenarioId: 'baseline', assumptionsFingerprint: 'baseline-costs' },
      { scenarioId: 'combined-adverse', assumptionsFingerprint: 'adverse-costs' },
    ],
    observations,
    discoveryOnly: true,
    holdoutAccessed: false,
    policy: { shardCount: 2 },
  });
  const cycle = buildAutonomousResearchCycle({
    cycleId: 'phase6-simulation',
    datasetFingerprint,
    codeCommit,
    configurationHash,
    createdAt: 1_000,
    hypothesisReport: hypotheses,
    featureReport: features,
    candidateReports: [candidates],
    backtestPlan,
  });
  assert.equal(cycle.status, 'READY_TO_SCHEDULE');
  const scheduler = new ExperimentScheduler(cycle.taskSpecs);
  let now = 1_001;
  while (true) {
    const task = scheduler.claim({
      workerId: 'simulation-worker',
      now,
      availableResourceUnits: 100,
    });
    if (task === null) break;
    scheduler.complete({
      taskId: task.taskId,
      workerId: 'simulation-worker',
      now: now + 1,
      resultFingerprint: `simulated-${task.payloadFingerprint}`,
    });
    now += 2;
  }
  const schedulerSnapshot = scheduler.snapshot(now);
  assert.equal(schedulerSnapshot.counts.COMPLETED, cycle.taskSpecs.length);
  const report = buildContinuousResearchReport({
    cycle,
    scheduler: schedulerSnapshot,
    generatedAt: now,
    inventory: {
      realMarketData: true,
      immutableDataset: true,
      integrityPassed: true,
      leakageChecksPassed: true,
      collectionDays: 30,
      instrumentCount: 2,
      observedRegimes: ['BULL_TREND', 'HIGH_VOLATILITY'],
      requiredRegimes: [
        'BULL_TREND',
        'BEAR_TREND',
        'SIDEWAYS',
        'HIGH_VOLATILITY',
        'LOW_VOLATILITY',
      ],
      availableDataCapabilities: ['CANDLES', 'TRADES', 'BOOKS'],
      requiredDataCapabilities: [
        'CANDLES',
        'TRADES',
        'BOOKS',
        'OPEN_INTEREST',
        'FUNDING',
        'LIQUIDATIONS',
      ],
      unresolvedGapCount: 0,
    },
  });
  assert.equal(report.researchState, 'ACQUIRING_EVIDENCE');
  assert.equal(report.profitabilityClaimed, false);
  assert.equal(report.strategyPromotionAllowed, false);
  assert.equal(report.liveExecutionAllowed, false);
  return report;
};

if (require.main === module) {
  try {
    const report = runAutonomousResearchSimulation();
    console.log(renderContinuousResearchReportMarkdown(report));
  } catch (error) {
    console.error(
      `Autonomous research simulation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
