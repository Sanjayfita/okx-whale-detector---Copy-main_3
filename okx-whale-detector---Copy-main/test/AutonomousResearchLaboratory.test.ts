import { describe, expect, it } from 'vitest';

import { discoverAdaptiveFeatures } from '../src/autonomy/AdaptiveFeatureDiscovery';
import { buildAutonomousResearchCycle } from '../src/autonomy/AutonomousResearchLaboratory';
import {
  buildContinuousResearchReport,
  renderContinuousResearchReportMarkdown,
} from '../src/autonomy/ContinuousResearchReport';
import { planDistributedBacktests } from '../src/autonomy/DistributedBacktest';
import { ExperimentScheduler } from '../src/autonomy/ExperimentScheduler';
import { generateAutonomousHypotheses } from '../src/autonomy/ResearchHypothesis';
import { generateStrategyCandidates } from '../src/research/StrategyCandidateGenerator';

const fixtures = () => {
  const datasetFingerprint = 'dataset';
  const codeCommit = 'commit';
  const configurationHash = 'config';
  const hypothesisReport = generateAutonomousHypotheses({
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
        researchQuestion: 'Can trend efficiency condition continuation?',
        rationale: 'The strategy premise should be measured explicitly.',
        falsificationCriterion: 'Reject a non-positive corrected lower confidence bound.',
        featureSets: [['trendEfficiency']],
        parameterSpace: { threshold: [0.3, 0.4] },
        requiredDataCapabilities: ['CANDLES'],
        complexityUnits: 2,
      },
    ],
  });
  const featureReport = discoverAdaptiveFeatures({
    datasetFingerprint,
    codeCommit,
    configurationHash,
    availableDataCapabilities: ['CANDLES'],
    baseFeatures: [
      {
        featureName: 'trendEfficiency',
        role: 'ALPHA',
        requiredDataCapabilities: ['CANDLES'],
        maximumSourceLookbackMs: 300_000,
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
  const candidateReport = generateStrategyCandidates({
    strategyId: 'trend-following',
    strategyVersion: 1,
    hypothesisFamilyId: 'trend-family',
    datasetFingerprint,
    codeCommit,
    configurationHash,
    parameterSpace: { threshold: [0.3, 0.4] },
    discoveryScope: 'PURGED_DISCOVERY',
    holdoutAccessed: false,
  });
  const backtestPlan = planDistributedBacktests({
    datasetFingerprint,
    codeCommit,
    configurationHash,
    candidates: candidateReport.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      candidateFingerprint: candidate.candidateFingerprint,
    })),
    scenarios: [
      { scenarioId: 'baseline', assumptionsFingerprint: 'baseline-assumptions' },
    ],
    observations: [
      {
        observationId: 'observation-1',
        episodeId: 'episode-1',
        instrumentId: 'BTC-USDT-SWAP',
        foldId: 'fold-1',
        observedAt: 1,
      },
    ],
    discoveryOnly: true,
    holdoutAccessed: false,
    policy: { shardCount: 1 },
  });
  return {
    datasetFingerprint,
    codeCommit,
    configurationHash,
    hypothesisReport,
    featureReport,
    candidateReport,
    backtestPlan,
  };
};

describe('autonomous research laboratory', () => {
  it('builds a deterministic schedulable DAG without promotion authority', () => {
    const fixture = fixtures();
    const input = {
      cycleId: 'cycle-1',
      datasetFingerprint: fixture.datasetFingerprint,
      codeCommit: fixture.codeCommit,
      configurationHash: fixture.configurationHash,
      createdAt: 100,
      hypothesisReport: fixture.hypothesisReport,
      featureReport: fixture.featureReport,
      candidateReports: [fixture.candidateReport],
      backtestPlan: fixture.backtestPlan,
    };
    const first = buildAutonomousResearchCycle(input);
    const second = buildAutonomousResearchCycle(input);

    expect(first).toEqual(second);
    expect(first.status).toBe('READY_TO_SCHEDULE');
    expect(first.taskSpecs.length).toBeGreaterThan(first.backtestWorkUnitCount);
    expect(first.strategyPromotionAllowed).toBe(false);
    expect(first.liveExecutionAllowed).toBe(false);
    expect(() => new ExperimentScheduler(first.taskSpecs)).not.toThrow();
  });

  it('blocks dataset fingerprint mismatches', () => {
    const fixture = fixtures();
    const cycle = buildAutonomousResearchCycle({
      cycleId: 'cycle-1',
      datasetFingerprint: 'different-dataset',
      codeCommit: fixture.codeCommit,
      configurationHash: fixture.configurationHash,
      createdAt: 100,
      hypothesisReport: fixture.hypothesisReport,
      featureReport: fixture.featureReport,
      candidateReports: [fixture.candidateReport],
      backtestPlan: fixture.backtestPlan,
    });

    expect(cycle.status).toBe('BLOCKED');
    expect(cycle.taskSpecs).toEqual([]);
    expect(cycle.blockingReasons).toContain(
      'HYPOTHESIS_DATASET_FINGERPRINT_MISMATCH',
    );
  });

  it('reports evidence acquisition gaps and deterministic next actions', () => {
    const fixture = fixtures();
    const cycle = buildAutonomousResearchCycle({
      cycleId: 'cycle-1',
      datasetFingerprint: fixture.datasetFingerprint,
      codeCommit: fixture.codeCommit,
      configurationHash: fixture.configurationHash,
      createdAt: 100,
      hypothesisReport: fixture.hypothesisReport,
      featureReport: fixture.featureReport,
      candidateReports: [fixture.candidateReport],
      backtestPlan: fixture.backtestPlan,
    });
    const scheduler = new ExperimentScheduler(cycle.taskSpecs).snapshot(100);
    const report = buildContinuousResearchReport({
      cycle,
      scheduler,
      generatedAt: 101,
      inventory: {
        realMarketData: true,
        immutableDataset: true,
        integrityPassed: true,
        leakageChecksPassed: true,
        collectionDays: 30,
        instrumentCount: 2,
        observedRegimes: ['BULL_TREND'],
        requiredRegimes: ['BULL_TREND', 'BEAR_TREND'],
        availableDataCapabilities: ['CANDLES'],
        requiredDataCapabilities: ['CANDLES', 'LIQUIDATIONS'],
        unresolvedGapCount: 0,
      },
    });

    expect(report.researchState).toBe('ACQUIRING_EVIDENCE');
    expect(report.blockers).toContain('COLLECTION_DURATION_BELOW_180_DAYS');
    expect(report.nextActions).toContain('ACQUIRE_MISSING_DATA_CAPABILITIES');
    expect(report.profitabilityClaimed).toBe(false);
    expect(renderContinuousResearchReportMarkdown(report)).toContain(
      'No profitability claim',
    );
  });
});
