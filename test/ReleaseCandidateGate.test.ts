import { describe, expect, it } from 'vitest';

import type { BacktestStatistics } from '../src/backtest/BacktestStatistics';
import {
  evaluateReleaseCandidate,
  type ReleaseCandidateEvidence,
} from '../src/release/ReleaseCandidateGate';

const DAY_MS = 24 * 60 * 60 * 1_000;

const statistics = (
  overrides: Partial<BacktestStatistics> = {},
): BacktestStatistics => ({
  tradeCount: 120,
  winningTrades: 70,
  losingTrades: 50,
  breakevenTrades: 0,
  winRate: 70 / 120,
  grossProfit: 180,
  grossLoss: 120,
  netProfit: 60,
  profitFactor: 1.5,
  expectancy: 0.5,
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
  ...overrides,
});

const validEvidence = (): ReleaseCandidateEvidence => ({
  strategyId: 'derivatives-flow-v1',
  strategyVersion: '1.0.0-rc1',
  codeCommit: '0123456789abcdef',
  configurationHash: 'config-hash',
  dataset: {
    datasetId: 'discovery-dataset',
    fingerprint: 'discovery-fingerprint',
    sourceKind: 'REAL_MARKET',
    immutable: true,
    manifestVerified: true,
    startAt: 1_700_000_000_000,
    endAt: 1_700_000_000_000 + 200 * DAY_MS,
    instrumentCount: 5,
    unresolvedGapCount: 0,
    integrityPassed: true,
    leakageChecksPassed: true,
    sequenceCompleteDepth: true,
    hasTrades: true,
    hasOpenInterest: true,
    hasFunding: true,
    hasLiquidations: true,
    hasMarkAndIndex: true,
    hasBestBidAndAsk: true,
    hasContractMetadata: true,
    coveredRegimes: [
      'BULL_TREND',
      'BEAR_TREND',
      'SIDEWAYS',
      'HIGH_VOLATILITY',
      'LOW_VOLATILITY',
    ],
  },
  featureSelection: {
    status: 'SELECTION_PASSED',
    selectedFeatures: ['cvd', 'spread_bps'],
    retainedResearchFeatures: ['cvd'],
    retainedSafetyFeatures: ['spread_bps'],
    decisions: [],
    rejectionReasons: [],
    liveExecutionAllowed: false,
  },
  strategyValidation: {
    candidateId: 'derivatives-flow-v1',
    status: 'VALIDATED_FOR_PAPER_RESEARCH',
    rejectionReasons: [],
    positiveFoldFraction: 0.8,
    medianTestExpectancy: 0.4,
    medianTestProfitFactor: 1.3,
    medianTestSharpeRatio: 0.8,
    maximumObservedTestDrawdownPercent: 0.15,
    liveExecutionAllowed: false,
  },
  robustnessValidation: {
    strategyId: 'derivatives-flow-v1',
    status: 'ROBUSTNESS_PASSED',
    datasetFingerprint: 'discovery-fingerprint',
    scenarioCount: 25,
    positiveRegimeFraction: 1,
    totalBaselineTrades: 250,
    minimumObservedStressExpectancy: 0.1,
    maximumObservedDrawdownPercent: 0.18,
    rejectionReasons: [],
    liveExecutionAllowed: false,
  },
  holdout: {
    partitionId: 'untouched-holdout',
    datasetFingerprint: 'holdout-fingerprint',
    sourceKind: 'REAL_MARKET',
    codeCommit: '0123456789abcdef',
    configurationHash: 'config-hash',
    parametersFrozenAt: 1_720_000_000_000,
    evaluatedAt: 1_720_000_100_000,
    evaluationCount: 1,
    statistics: statistics(),
  },
  paperTrading: {
    runId: 'paper-run',
    sourceKind: 'LIVE_MARKET',
    codeCommit: '0123456789abcdef',
    configurationHash: 'config-hash',
    startedAt: 1_730_000_000_000,
    endedAt: 1_730_000_000_000 + 31 * DAY_MS,
    orderIntentCount: 150,
    dataGapCount: 0,
    duplicateFillCount: 0,
    reconciliationErrorRate: 0.0005,
    statistics: statistics({
      profitFactor: 1.2,
      expectancy: 0.2,
      averageR: 0.03,
      sharpeRatio: 0.5,
      sortinoRatio: 0.7,
      maximumDrawdownPercent: 0.1,
    }),
  },
  baselineImprovement: {
    baselineStrategyId: 'original-whale-baseline',
    pairedEpisodeCount: 150,
    meanPnlImprovement: 0.25,
    confidenceLower: 0.05,
    confidenceUpper: 0.45,
    probabilityOfImprovement: 0.99,
    statisticallySignificant: true,
  },
  operational: {
    codeCommit: '0123456789abcdef',
    unitTestsPassed: true,
    integrationTestsPassed: true,
    lintPassed: true,
    typecheckPassed: true,
    productionBuildPassed: true,
    databaseMigrationsPassed: true,
    githubActionsPassed: true,
    liveOrderSubmissionEnabled: false,
  },
});

describe('evaluateReleaseCandidate', () => {
  it('permits an RC only when every independent evidence gate passes', () => {
    const decision = evaluateReleaseCandidate({
      evidence: validEvidence(),
    });

    expect(decision.status).toBe('RELEASE_CANDIDATE');
    expect(decision.readyForReview).toBe(true);
    expect(decision.mergeAllowed).toBe(true);
    expect(decision.tagAllowed).toBe(true);
    expect(decision.suggestedTag).toBe('v1.0.0-rc1');
    expect(decision.rejectionReasons).toEqual([]);
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('blocks synthetic data and absent holdout and paper evidence', () => {
    const evidence = validEvidence();
    const decision = evaluateReleaseCandidate({
      evidence: {
        ...evidence,
        dataset: {
          ...evidence.dataset,
          sourceKind: 'SYNTHETIC',
        },
        holdout: null,
        paperTrading: null,
      },
    });

    expect(decision.status).toBe('BLOCKED');
    expect(decision.mergeAllowed).toBe(false);
    expect(decision.tagAllowed).toBe(false);
    expect(decision.rejectionReasons).toContain('DATASET_NOT_REAL_MARKET');
    expect(decision.rejectionReasons).toContain('UNTOUCHED_HOLDOUT_REQUIRED');
    expect(decision.rejectionReasons).toContain(
      'EXTENDED_PAPER_TRADING_REQUIRED',
    );
  });

  it('blocks repeated access to the untouched holdout', () => {
    const evidence = validEvidence();
    if (evidence.holdout === null) {
      throw new Error('test fixture requires a holdout');
    }
    const decision = evaluateReleaseCandidate({
      evidence: {
        ...evidence,
        holdout: {
          ...evidence.holdout,
          evaluationCount: 2,
        },
      },
    });

    expect(decision.status).toBe('BLOCKED');
    expect(decision.rejectionReasons).toContain(
      'HOLDOUT_MUST_BE_EVALUATED_EXACTLY_ONCE',
    );
  });

  it('blocks an RC when live order submission has already been enabled', () => {
    const evidence = validEvidence();
    const decision = evaluateReleaseCandidate({
      evidence: {
        ...evidence,
        operational: {
          ...evidence.operational,
          liveOrderSubmissionEnabled: true,
        },
      },
    });

    expect(decision.status).toBe('BLOCKED');
    expect(decision.rejectionReasons).toContain(
      'LIVE_ORDER_SUBMISSION_MUST_REMAIN_DISABLED_FOR_RC',
    );
    expect(decision.liveExecutionAllowed).toBe(false);
  });
});
