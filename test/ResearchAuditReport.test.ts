import { describe, expect, it } from 'vitest';

import type { BacktestStatistics } from '../src/backtest/BacktestStatistics';
import type { ResearchExperimentManifest } from '../src/research/ResearchExperimentManifest';
import {
  buildResearchAuditReport,
} from '../src/research/ResearchAuditReport';

const statistics: BacktestStatistics = {
  tradeCount: 150,
  winningTrades: 90,
  losingTrades: 60,
  breakevenTrades: 0,
  winRate: 0.6,
  grossProfit: 180,
  grossLoss: 120,
  netProfit: 60,
  profitFactor: 1.5,
  expectancy: 0.4,
  averageR: 0.05,
  sharpeRatio: 1,
  sortinoRatio: 1.2,
  maximumDrawdown: 100,
  maximumDrawdownPercent: 0.1,
  recoveryFactor: 0.6,
  averageHoldingTimeMs: 60_000,
  totalFees: 20,
  totalFundingPnl: -5,
  equityCurve: [],
};

const quality = (sourceName: string) => ({
  sourceName,
  inputCount: 100,
  selectedCount: 90,
  excludedFutureObservationCount: 0,
  excludedUnavailableAtDecisionCount: 5,
  excludedOutsideLookbackCount: 5,
  latestObservedAt: 900,
  latestReceivedAt: 901,
  ageMs: 99,
  status: 'PASSED' as const,
  rejectionReasons: [],
});

const manifest = (): ResearchExperimentManifest => ({
  experimentId: 'experiment-1',
  scope: 'FROZEN_HOLDOUT',
  hypothesisFamilyId: 'family-1',
  strategyIds: ['candidate'],
  featureNames: ['cvd'],
  discoveryDatasetFingerprint: 'discovery',
  holdoutDatasetFingerprint: 'holdout',
  codeCommit: 'commit',
  configurationHash: 'config',
  candidateFamilyFingerprint: 'family-fingerprint',
  candidateCount: 2,
  hypothesisCount: 2,
  splitAudit: {
    foldCount: 4,
    discoveryObservationCount: 1_000,
    holdoutObservationCount: 200,
    overlappingEpisodeCount: 0,
    holdoutPurgedObservationCount: 10,
    holdoutEmbargoedObservationCount: 5,
  },
  dataQuality: [quality('books'), quality('trades')],
  frozenAt: 1_000,
  startedAt: 1_100,
  completedAt: 2_000,
  holdoutAccessCount: 1,
  significanceMethod: 'PAIRED_BOOTSTRAP_AND_RANDOMIZATION',
  multiplicityMethod: 'HOLM_BONFERRONI',
  status: 'ACCEPTED_FOR_RESEARCH',
  rejectionReasons: [],
  manifestFingerprint: 'manifest-fingerprint',
  strategyPromotionAllowed: false,
  liveExecutionAllowed: false,
});

const distribution = {
  minimum: -0.1,
  p05: -0.05,
  p50: 0.1,
  p95: 0.2,
  maximum: 0.3,
  mean: 0.1,
};

const validInput = () => ({
  targetStrategyId: 'candidate',
  generatedAt: 3_000,
  manifest: manifest(),
  candidateGeneration: {
    strategyId: 'candidate',
    strategyVersion: 1,
    hypothesisFamilyId: 'family-1',
    searchSpaceSize: 4,
    constraintRejectedCount: 2,
    effectiveHypothesisCount: 2,
    candidates: [],
    familyFingerprint: 'family-fingerprint',
    status: 'GENERATED' as const,
    rejectionReasons: [],
    holdoutAccessed: false as const,
    liveExecutionAllowed: false as const,
  },
  featureSelection: {
    status: 'SELECTION_PASSED' as const,
    selectedFeatures: ['cvd'],
    retainedResearchFeatures: ['cvd'],
    retainedSafetyFeatures: [],
    decisions: [],
    rejectionReasons: [],
    correlationEvidenceComplete: true,
    liveExecutionAllowed: false as const,
  },
  strategyComparison: {
    baselineStrategyId: 'baseline',
    hypothesisFamilySize: 2,
    multiplicityMethod: 'HOLM_BONFERRONI' as const,
    rows: [
      {
        rank: 1,
        strategyId: 'candidate',
        label: 'Candidate',
        statistics,
        regimePerformance: [],
        positiveRegimeFraction: 1,
        robustScore: 1,
        pairedImprovement: {
          baselineStrategyId: 'baseline',
          evaluationUniverseComplete: true,
          evaluationEpisodeCount: 150,
          baselineTradeEpisodeCount: 140,
          candidateTradeEpisodeCount: 120,
          pairedEpisodeCount: 150,
          meanPnlImprovement: 0.2,
          confidenceLower: 0.05,
          confidenceUpper: 0.35,
          probabilityOfImprovement: 0.99,
          standardizedEffect: 0.4,
          rawPValue: 0.005,
          adjustedPValue: 0.01,
          multiplicityMethod: 'HOLM_BONFERRONI' as const,
          statisticallySignificant: true,
          rejectionReasons: [],
        },
        promotionStatus: 'ELIGIBLE_FOR_PAPER_COMPARISON' as const,
        liveExecutionAllowed: false as const,
      },
    ],
    liveExecutionAllowed: false as const,
  },
  robustnessValidation: {
    strategyId: 'candidate',
    status: 'ROBUSTNESS_PASSED' as const,
    datasetFingerprint: 'discovery',
    scenarioCount: 25,
    positiveRegimeFraction: 1,
    totalBaselineTrades: 250,
    minimumObservedStressExpectancy: 0.1,
    maximumObservedDrawdownPercent: 0.18,
    rejectionReasons: [],
    liveExecutionAllowed: false as const,
  },
  monteCarlo: {
    iterations: 10_000,
    tradeCount: 150,
    independentEpisodeCount: 120,
    endingEquity: distribution,
    netReturnFraction: distribution,
    maximumDrawdownFraction: distribution,
    expectedReturnConfidenceInterval: {
      lower: -0.05,
      upper: 0.2,
      level: 0.95,
    },
    expectedShortfallReturnFraction: -0.1,
    tailConfidenceLevel: 0.95,
    probabilityOfRuin: 0.005,
    probabilityOfPositiveReturn: 0.7,
    probabilityDrawdownExceedsThreshold: 0.05,
    maximumDrawdownThresholdFraction: 0.2,
    averageMissedFills: 5,
    averageFavorableMissedFills: 4,
    averageUnfavorableMissedFills: 1,
    averagePartialFills: 10,
    averageFillFraction: 0.8,
    averageSystemicCostMultiplier: 1.5,
    liveExecutionAllowed: false as const,
  },
  releaseDecision: {
    strategyId: 'candidate',
    strategyVersion: '1',
    status: 'RELEASE_CANDIDATE' as const,
    readyForReview: true,
    mergeAllowed: true,
    tagAllowed: true,
    suggestedTag: 'v1.0.0-rc1' as const,
    rejectionReasons: [],
    liveExecutionAllowed: false as const,
  },
});

describe('buildResearchAuditReport', () => {
  it('surfaces a complete evidence chain without authorizing promotion', () => {
    const report = buildResearchAuditReport(validInput());

    expect(report.status).toBe('READY_FOR_RELEASE_REVIEW');
    expect(report.dataQuality.excludedUnavailableAtDecisionCount).toBe(10);
    expect(report.strategyEvidence.adjustedPValue).toBe(0.01);
    expect(report.executionTailRisk.expectedShortfallReturnFraction).toBe(-0.1);
    expect(report.blockingReasons).toEqual([]);
    expect(report.strategyPromotionAllowed).toBe(false);
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('consolidates structural, statistical, and tail-risk blockers', () => {
    const input = validInput();
    const report = buildResearchAuditReport({
      ...input,
      featureSelection: {
        ...input.featureSelection,
        status: 'REJECTED',
        correlationEvidenceComplete: false,
      },
      monteCarlo: {
        ...input.monteCarlo,
        iterations: 100,
        probabilityOfRuin: 0.2,
      },
      releaseDecision: {
        ...input.releaseDecision,
        status: 'BLOCKED',
        readyForReview: false,
        mergeAllowed: false,
        tagAllowed: false,
        suggestedTag: null,
      },
    });

    expect(report.status).toBe('BLOCKED');
    expect(report.blockingReasons).toEqual(
      expect.arrayContaining([
        'FEATURE_SELECTION_NOT_PASSED',
        'FEATURE_CORRELATION_EVIDENCE_INCOMPLETE',
        'MONTE_CARLO_ITERATIONS_INSUFFICIENT',
        'MONTE_CARLO_RUIN_PROBABILITY_TOO_HIGH',
        'RELEASE_CANDIDATE_GATE_BLOCKED',
      ]),
    );
  });
});
