import type { BacktestStatistics } from '../backtest/BacktestStatistics';
import type { FeatureSelectionReport } from '../research/FeatureSelection';
import type { RequiredMarketRegime, RobustnessValidationDecision } from '../research/RobustnessValidation';
import type { PairedImprovementEvidence } from '../research/StrategyComparison';
import type { StrategyValidationDecision } from '../research/StrategyValidation';

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface DatasetReleaseEvidence {
  readonly datasetId: string;
  readonly fingerprint: string;
  readonly sourceKind: 'REAL_MARKET' | 'SYNTHETIC' | 'MIXED';
  readonly immutable: boolean;
  readonly manifestVerified: boolean;
  readonly startAt: number;
  readonly endAt: number;
  readonly instrumentCount: number;
  readonly unresolvedGapCount: number;
  readonly integrityPassed: boolean;
  readonly leakageChecksPassed: boolean;
  readonly sequenceCompleteDepth: boolean;
  readonly hasTrades: boolean;
  readonly hasOpenInterest: boolean;
  readonly hasFunding: boolean;
  readonly hasLiquidations: boolean;
  readonly hasMarkAndIndex: boolean;
  readonly hasBestBidAndAsk: boolean;
  readonly hasContractMetadata: boolean;
  readonly coveredRegimes: readonly RequiredMarketRegime[];
}

export interface FrozenHoldoutEvidence {
  readonly partitionId: string;
  readonly datasetFingerprint: string;
  readonly sourceKind: 'REAL_MARKET' | 'SYNTHETIC' | 'MIXED';
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly parametersFrozenAt: number;
  readonly evaluatedAt: number;
  readonly evaluationCount: number;
  readonly statistics: BacktestStatistics;
}

export interface PaperTradingReleaseEvidence {
  readonly runId: string;
  readonly sourceKind: 'LIVE_MARKET' | 'HISTORICAL_REPLAY' | 'SYNTHETIC';
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly orderIntentCount: number;
  readonly dataGapCount: number;
  readonly duplicateFillCount: number;
  readonly reconciliationErrorRate: number;
  readonly statistics: BacktestStatistics;
}

export interface OperationalReleaseEvidence {
  readonly codeCommit: string;
  readonly unitTestsPassed: boolean;
  readonly integrationTestsPassed: boolean;
  readonly lintPassed: boolean;
  readonly typecheckPassed: boolean;
  readonly productionBuildPassed: boolean;
  readonly databaseMigrationsPassed: boolean;
  readonly githubActionsPassed: boolean;
  readonly liveOrderSubmissionEnabled: boolean;
}

export interface ReleaseCandidateEvidence {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly dataset: DatasetReleaseEvidence;
  readonly featureSelection: FeatureSelectionReport;
  readonly strategyValidation: StrategyValidationDecision;
  readonly robustnessValidation: RobustnessValidationDecision;
  readonly holdout: FrozenHoldoutEvidence | null;
  readonly paperTrading: PaperTradingReleaseEvidence | null;
  readonly baselineImprovement: PairedImprovementEvidence | null;
  readonly operational: OperationalReleaseEvidence;
}

export interface ReleaseCandidatePolicy {
  readonly minimumDatasetDays: number;
  readonly minimumInstrumentCount: number;
  readonly requiredRegimes: readonly RequiredMarketRegime[];
  readonly minimumRetainedResearchFeatures: number;
  readonly maximumRetainedResearchFeatures: number;
  readonly minimumHoldoutTrades: number;
  readonly minimumHoldoutProfitFactor: number;
  readonly minimumHoldoutAverageR: number;
  readonly minimumHoldoutSharpeRatio: number;
  readonly minimumHoldoutSortinoRatio: number;
  readonly maximumHoldoutDrawdownPercent: number;
  readonly minimumPaperDays: number;
  readonly minimumPaperTrades: number;
  readonly minimumPaperOrderIntents: number;
  readonly minimumPaperProfitFactor: number;
  readonly minimumPaperAverageR: number;
  readonly minimumPaperSharpeRatio: number;
  readonly maximumPaperDrawdownPercent: number;
  readonly maximumPaperReconciliationErrorRate: number;
  readonly minimumPairedBaselineEpisodes: number;
  readonly minimumBaselineImprovementProbability: number;
}

export const DEFAULT_RELEASE_CANDIDATE_POLICY: ReleaseCandidatePolicy = {
  minimumDatasetDays: 180,
  minimumInstrumentCount: 3,
  requiredRegimes: [
    'BULL_TREND',
    'BEAR_TREND',
    'SIDEWAYS',
    'HIGH_VOLATILITY',
    'LOW_VOLATILITY',
  ],
  minimumRetainedResearchFeatures: 1,
  maximumRetainedResearchFeatures: 8,
  minimumHoldoutTrades: 100,
  minimumHoldoutProfitFactor: 1.1,
  minimumHoldoutAverageR: 0.02,
  minimumHoldoutSharpeRatio: 0.5,
  minimumHoldoutSortinoRatio: 0.5,
  maximumHoldoutDrawdownPercent: 0.2,
  minimumPaperDays: 30,
  minimumPaperTrades: 100,
  minimumPaperOrderIntents: 100,
  minimumPaperProfitFactor: 1.05,
  minimumPaperAverageR: 0,
  minimumPaperSharpeRatio: 0,
  maximumPaperDrawdownPercent: 0.15,
  maximumPaperReconciliationErrorRate: 0.001,
  minimumPairedBaselineEpisodes: 100,
  minimumBaselineImprovementProbability: 0.95,
};

export interface ReleaseCandidateDecision {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly status: 'RELEASE_CANDIDATE' | 'BLOCKED';
  readonly readyForReview: boolean;
  readonly mergeAllowed: boolean;
  readonly tagAllowed: boolean;
  readonly suggestedTag: 'v1.0.0-rc1' | null;
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

const validateNonEmpty = (value: string, name: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
};

const validateTimestampRange = (
  startAt: number,
  endAt: number,
  name: string,
): void => {
  if (
    !Number.isSafeInteger(startAt) ||
    !Number.isSafeInteger(endAt) ||
    startAt < 0 ||
    endAt <= startAt
  ) {
    throw new Error(`${name} timestamps are invalid`);
  }
};

const validateStatistics = (
  statistics: BacktestStatistics,
  name: string,
): void => {
  if (!Number.isSafeInteger(statistics.tradeCount) || statistics.tradeCount < 0) {
    throw new Error(`${name} tradeCount is invalid`);
  }
  const finiteValues = [
    statistics.expectancy,
    statistics.maximumDrawdownPercent,
    statistics.netProfit,
  ];
  if (finiteValues.some((value) => !Number.isFinite(value))) {
    throw new Error(`${name} contains non-finite statistics`);
  }
  if (
    statistics.maximumDrawdownPercent < 0 ||
    statistics.maximumDrawdownPercent > 1
  ) {
    throw new Error(`${name} maximumDrawdownPercent is invalid`);
  }
};

const validatePolicy = (policy: ReleaseCandidatePolicy): void => {
  const positiveIntegers = [
    policy.minimumDatasetDays,
    policy.minimumInstrumentCount,
    policy.minimumRetainedResearchFeatures,
    policy.maximumRetainedResearchFeatures,
    policy.minimumHoldoutTrades,
    policy.minimumPaperDays,
    policy.minimumPaperTrades,
    policy.minimumPaperOrderIntents,
    policy.minimumPairedBaselineEpisodes,
  ];
  if (positiveIntegers.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('release candidate integer thresholds must be positive');
  }
  if (
    policy.maximumRetainedResearchFeatures <
    policy.minimumRetainedResearchFeatures
  ) {
    throw new Error('feature count policy is inconsistent');
  }
  if (policy.requiredRegimes.length === 0) {
    throw new Error('requiredRegimes must not be empty');
  }
  const finiteValues = [
    policy.minimumHoldoutProfitFactor,
    policy.minimumHoldoutAverageR,
    policy.minimumHoldoutSharpeRatio,
    policy.minimumHoldoutSortinoRatio,
    policy.maximumHoldoutDrawdownPercent,
    policy.minimumPaperProfitFactor,
    policy.minimumPaperAverageR,
    policy.minimumPaperSharpeRatio,
    policy.maximumPaperDrawdownPercent,
    policy.maximumPaperReconciliationErrorRate,
    policy.minimumBaselineImprovementProbability,
  ];
  if (finiteValues.some((value) => !Number.isFinite(value))) {
    throw new Error('release candidate numeric thresholds must be finite');
  }
  if (
    policy.minimumBaselineImprovementProbability <= 0.5 ||
    policy.minimumBaselineImprovementProbability > 1 ||
    policy.maximumHoldoutDrawdownPercent < 0 ||
    policy.maximumHoldoutDrawdownPercent > 1 ||
    policy.maximumPaperDrawdownPercent < 0 ||
    policy.maximumPaperDrawdownPercent > 1 ||
    policy.maximumPaperReconciliationErrorRate < 0
  ) {
    throw new Error('release candidate policy thresholds are invalid');
  }
};

const metricReasons = (input: {
  readonly prefix: 'HOLDOUT' | 'PAPER';
  readonly statistics: BacktestStatistics;
  readonly minimumTrades: number;
  readonly minimumProfitFactor: number;
  readonly minimumAverageR: number;
  readonly minimumSharpeRatio: number;
  readonly minimumSortinoRatio: number | null;
  readonly maximumDrawdownPercent: number;
}): readonly string[] => {
  const reasons: string[] = [];
  if (input.statistics.tradeCount < input.minimumTrades) {
    reasons.push(`${input.prefix}_INSUFFICIENT_TRADES`);
  }
  if (input.statistics.expectancy <= 0) {
    reasons.push(`${input.prefix}_EXPECTANCY_NOT_POSITIVE`);
  }
  if (
    input.statistics.profitFactor === null ||
    input.statistics.profitFactor < input.minimumProfitFactor
  ) {
    reasons.push(`${input.prefix}_PROFIT_FACTOR_FAILED`);
  }
  if (
    input.statistics.averageR === null ||
    input.statistics.averageR <= input.minimumAverageR
  ) {
    reasons.push(`${input.prefix}_AVERAGE_R_FAILED`);
  }
  if (
    input.statistics.sharpeRatio === null ||
    input.statistics.sharpeRatio < input.minimumSharpeRatio
  ) {
    reasons.push(`${input.prefix}_SHARPE_FAILED`);
  }
  if (
    input.minimumSortinoRatio !== null &&
    (input.statistics.sortinoRatio === null ||
      input.statistics.sortinoRatio < input.minimumSortinoRatio)
  ) {
    reasons.push(`${input.prefix}_SORTINO_FAILED`);
  }
  if (
    input.statistics.maximumDrawdownPercent > input.maximumDrawdownPercent
  ) {
    reasons.push(`${input.prefix}_DRAWDOWN_FAILED`);
  }
  return reasons;
};

export const evaluateReleaseCandidate = (input: {
  readonly evidence: ReleaseCandidateEvidence;
  readonly policy?: ReleaseCandidatePolicy;
}): ReleaseCandidateDecision => {
  const policy = input.policy ?? DEFAULT_RELEASE_CANDIDATE_POLICY;
  validatePolicy(policy);
  const evidence = input.evidence;
  validateNonEmpty(evidence.strategyId, 'strategyId');
  validateNonEmpty(evidence.strategyVersion, 'strategyVersion');
  validateNonEmpty(evidence.codeCommit, 'codeCommit');
  validateNonEmpty(evidence.configurationHash, 'configurationHash');
  validateNonEmpty(evidence.dataset.datasetId, 'datasetId');
  validateNonEmpty(evidence.dataset.fingerprint, 'dataset fingerprint');
  validateTimestampRange(
    evidence.dataset.startAt,
    evidence.dataset.endAt,
    'dataset',
  );

  const reasons: string[] = [];
  const datasetDays =
    (evidence.dataset.endAt - evidence.dataset.startAt) / DAY_MS;
  if (evidence.dataset.sourceKind !== 'REAL_MARKET') {
    reasons.push('DATASET_NOT_REAL_MARKET');
  }
  if (!evidence.dataset.immutable) {
    reasons.push('DATASET_NOT_IMMUTABLE');
  }
  if (!evidence.dataset.manifestVerified) {
    reasons.push('DATASET_MANIFEST_NOT_VERIFIED');
  }
  if (datasetDays < policy.minimumDatasetDays) {
    reasons.push('DATASET_DURATION_INSUFFICIENT');
  }
  if (evidence.dataset.instrumentCount < policy.minimumInstrumentCount) {
    reasons.push('DATASET_INSTRUMENT_COVERAGE_INSUFFICIENT');
  }
  if (evidence.dataset.unresolvedGapCount !== 0) {
    reasons.push('DATASET_HAS_UNRESOLVED_GAPS');
  }
  if (!evidence.dataset.integrityPassed) {
    reasons.push('DATASET_INTEGRITY_FAILED');
  }
  if (!evidence.dataset.leakageChecksPassed) {
    reasons.push('DATASET_LEAKAGE_CHECK_FAILED');
  }
  const requiredStreams: readonly [boolean, string][] = [
    [evidence.dataset.sequenceCompleteDepth, 'SEQUENCE_COMPLETE_DEPTH_MISSING'],
    [evidence.dataset.hasTrades, 'TRADES_MISSING'],
    [evidence.dataset.hasOpenInterest, 'OPEN_INTEREST_MISSING'],
    [evidence.dataset.hasFunding, 'FUNDING_MISSING'],
    [evidence.dataset.hasLiquidations, 'LIQUIDATIONS_MISSING'],
    [evidence.dataset.hasMarkAndIndex, 'MARK_OR_INDEX_MISSING'],
    [evidence.dataset.hasBestBidAndAsk, 'BEST_BID_ASK_MISSING'],
    [evidence.dataset.hasContractMetadata, 'CONTRACT_METADATA_MISSING'],
  ];
  for (const [available, reason] of requiredStreams) {
    if (!available) {
      reasons.push(reason);
    }
  }
  const coveredRegimes = new Set(evidence.dataset.coveredRegimes);
  for (const regime of policy.requiredRegimes) {
    if (!coveredRegimes.has(regime)) {
      reasons.push(`DATASET_REGIME_MISSING:${regime}`);
    }
  }

  if (evidence.featureSelection.status !== 'SELECTION_PASSED') {
    reasons.push('FEATURE_SELECTION_NOT_PASSED');
  }
  if (
    evidence.featureSelection.retainedResearchFeatures.length <
    policy.minimumRetainedResearchFeatures
  ) {
    reasons.push('NO_JUSTIFIED_RESEARCH_FEATURES');
  }
  if (
    evidence.featureSelection.retainedResearchFeatures.length >
    policy.maximumRetainedResearchFeatures
  ) {
    reasons.push('RESEARCH_FEATURE_COMPLEXITY_TOO_HIGH');
  }
  if (
    evidence.strategyValidation.candidateId !== evidence.strategyId ||
    evidence.strategyValidation.status !== 'VALIDATED_FOR_PAPER_RESEARCH'
  ) {
    reasons.push('PURGED_WALK_FORWARD_OR_HOLDOUT_VALIDATION_NOT_PASSED');
  }
  if (
    evidence.robustnessValidation.strategyId !== evidence.strategyId ||
    evidence.robustnessValidation.status !== 'ROBUSTNESS_PASSED'
  ) {
    reasons.push('ROBUSTNESS_VALIDATION_NOT_PASSED');
  }
  if (
    evidence.robustnessValidation.datasetFingerprint !==
    evidence.dataset.fingerprint
  ) {
    reasons.push('ROBUSTNESS_DATASET_FINGERPRINT_MISMATCH');
  }

  if (evidence.holdout === null) {
    reasons.push('UNTOUCHED_HOLDOUT_REQUIRED');
  } else {
    const holdout = evidence.holdout;
    validateNonEmpty(holdout.partitionId, 'holdout partitionId');
    validateNonEmpty(holdout.datasetFingerprint, 'holdout datasetFingerprint');
    validateStatistics(holdout.statistics, 'holdout');
    if (holdout.sourceKind !== 'REAL_MARKET') {
      reasons.push('HOLDOUT_NOT_REAL_MARKET');
    }
    if (holdout.datasetFingerprint === evidence.dataset.fingerprint) {
      reasons.push('HOLDOUT_NOT_FINGERPRINT_ISOLATED');
    }
    if (
      holdout.codeCommit !== evidence.codeCommit ||
      holdout.configurationHash !== evidence.configurationHash
    ) {
      reasons.push('HOLDOUT_NOT_RUN_WITH_FROZEN_CANDIDATE');
    }
    if (
      !Number.isSafeInteger(holdout.parametersFrozenAt) ||
      !Number.isSafeInteger(holdout.evaluatedAt) ||
      holdout.parametersFrozenAt < 0 ||
      holdout.evaluatedAt <= holdout.parametersFrozenAt
    ) {
      reasons.push('HOLDOUT_FREEZE_CHRONOLOGY_INVALID');
    }
    if (holdout.evaluationCount !== 1) {
      reasons.push('HOLDOUT_MUST_BE_EVALUATED_EXACTLY_ONCE');
    }
    reasons.push(
      ...metricReasons({
        prefix: 'HOLDOUT',
        statistics: holdout.statistics,
        minimumTrades: policy.minimumHoldoutTrades,
        minimumProfitFactor: policy.minimumHoldoutProfitFactor,
        minimumAverageR: policy.minimumHoldoutAverageR,
        minimumSharpeRatio: policy.minimumHoldoutSharpeRatio,
        minimumSortinoRatio: policy.minimumHoldoutSortinoRatio,
        maximumDrawdownPercent: policy.maximumHoldoutDrawdownPercent,
      }),
    );
  }

  if (evidence.paperTrading === null) {
    reasons.push('EXTENDED_PAPER_TRADING_REQUIRED');
  } else {
    const paper = evidence.paperTrading;
    validateNonEmpty(paper.runId, 'paper runId');
    validateTimestampRange(paper.startedAt, paper.endedAt, 'paper trading');
    validateStatistics(paper.statistics, 'paper trading');
    const paperDays = (paper.endedAt - paper.startedAt) / DAY_MS;
    if (paper.sourceKind !== 'LIVE_MARKET') {
      reasons.push('PAPER_TRADING_NOT_LIVE_MARKET');
    }
    if (
      paper.codeCommit !== evidence.codeCommit ||
      paper.configurationHash !== evidence.configurationHash
    ) {
      reasons.push('PAPER_TRADING_NOT_RUN_WITH_FROZEN_CANDIDATE');
    }
    if (paperDays < policy.minimumPaperDays) {
      reasons.push('PAPER_TRADING_DURATION_INSUFFICIENT');
    }
    if (
      !Number.isSafeInteger(paper.orderIntentCount) ||
      paper.orderIntentCount < policy.minimumPaperOrderIntents
    ) {
      reasons.push('PAPER_ORDER_INTENTS_INSUFFICIENT');
    }
    if (paper.dataGapCount !== 0) {
      reasons.push('PAPER_TRADING_HAS_DATA_GAPS');
    }
    if (paper.duplicateFillCount !== 0) {
      reasons.push('PAPER_TRADING_HAS_DUPLICATE_FILLS');
    }
    if (
      !Number.isFinite(paper.reconciliationErrorRate) ||
      paper.reconciliationErrorRate < 0 ||
      paper.reconciliationErrorRate >
        policy.maximumPaperReconciliationErrorRate
    ) {
      reasons.push('PAPER_RECONCILIATION_FAILED');
    }
    reasons.push(
      ...metricReasons({
        prefix: 'PAPER',
        statistics: paper.statistics,
        minimumTrades: policy.minimumPaperTrades,
        minimumProfitFactor: policy.minimumPaperProfitFactor,
        minimumAverageR: policy.minimumPaperAverageR,
        minimumSharpeRatio: policy.minimumPaperSharpeRatio,
        minimumSortinoRatio: null,
        maximumDrawdownPercent: policy.maximumPaperDrawdownPercent,
      }),
    );
  }

  if (evidence.baselineImprovement === null) {
    reasons.push('PAIRED_BASELINE_COMPARISON_REQUIRED');
  } else {
    const improvement = evidence.baselineImprovement;
    if (
      improvement.pairedEpisodeCount < policy.minimumPairedBaselineEpisodes
    ) {
      reasons.push('PAIRED_BASELINE_EPISODES_INSUFFICIENT');
    }
    if (
      !improvement.statisticallySignificant ||
      improvement.confidenceLower === null ||
      improvement.confidenceLower <= 0
    ) {
      reasons.push('BASELINE_IMPROVEMENT_NOT_STATISTICALLY_SIGNIFICANT');
    }
    if (
      improvement.probabilityOfImprovement === null ||
      improvement.probabilityOfImprovement <
        policy.minimumBaselineImprovementProbability
    ) {
      reasons.push('BASELINE_IMPROVEMENT_PROBABILITY_TOO_LOW');
    }
  }

  const operational = evidence.operational;
  if (operational.codeCommit !== evidence.codeCommit) {
    reasons.push('CI_COMMIT_MISMATCH');
  }
  const operationalChecks: readonly [boolean, string][] = [
    [operational.unitTestsPassed, 'UNIT_TESTS_FAILED'],
    [operational.integrationTestsPassed, 'INTEGRATION_TESTS_FAILED'],
    [operational.lintPassed, 'LINT_FAILED'],
    [operational.typecheckPassed, 'TYPECHECK_FAILED'],
    [operational.productionBuildPassed, 'PRODUCTION_BUILD_FAILED'],
    [operational.databaseMigrationsPassed, 'DATABASE_MIGRATIONS_FAILED'],
    [operational.githubActionsPassed, 'GITHUB_ACTIONS_FAILED'],
  ];
  for (const [passed, reason] of operationalChecks) {
    if (!passed) {
      reasons.push(reason);
    }
  }
  if (operational.liveOrderSubmissionEnabled) {
    reasons.push('LIVE_ORDER_SUBMISSION_MUST_REMAIN_DISABLED_FOR_RC');
  }

  const rejectionReasons = [...new Set(reasons)];
  const isReleaseCandidate = rejectionReasons.length === 0;
  return {
    strategyId: evidence.strategyId,
    strategyVersion: evidence.strategyVersion,
    status: isReleaseCandidate ? 'RELEASE_CANDIDATE' : 'BLOCKED',
    readyForReview: isReleaseCandidate,
    mergeAllowed: isReleaseCandidate,
    tagAllowed: isReleaseCandidate,
    suggestedTag: isReleaseCandidate ? 'v1.0.0-rc1' : null,
    rejectionReasons,
    liveExecutionAllowed: false,
  };
};
