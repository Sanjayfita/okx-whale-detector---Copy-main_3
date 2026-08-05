import type { ReleaseCandidateDecision } from '../release/ReleaseCandidateGate';
import type { FeatureSelectionReport } from './FeatureSelection';
import type { ExecutionMonteCarloReport } from './ExecutionMonteCarloValidation';
import type { ResearchExperimentManifest } from './ResearchExperimentManifest';
import type { RobustnessValidationDecision } from './RobustnessValidation';
import type { StrategyCandidateGenerationReport } from './StrategyCandidateGenerator';
import type { StrategyComparisonReport } from './StrategyComparison';

export interface ResearchAuditPolicy {
  readonly minimumMonteCarloIterations: number;
  readonly minimumMonteCarloEpisodes: number;
  readonly maximumProbabilityOfRuin: number;
  readonly maximumDrawdownExceedanceProbability: number;
  readonly minimumPositiveReturnProbability: number;
  readonly minimumExpectedShortfallReturnFraction: number;
}

export const DEFAULT_RESEARCH_AUDIT_POLICY: ResearchAuditPolicy = {
  minimumMonteCarloIterations: 10_000,
  minimumMonteCarloEpisodes: 100,
  maximumProbabilityOfRuin: 0.01,
  maximumDrawdownExceedanceProbability: 0.1,
  minimumPositiveReturnProbability: 0.5,
  minimumExpectedShortfallReturnFraction: -0.2,
};

export interface ResearchAuditReport {
  readonly experimentId: string;
  readonly targetStrategyId: string;
  readonly generatedAt: number;
  readonly status: 'READY_FOR_RELEASE_REVIEW' | 'BLOCKED';
  readonly dataQuality: Readonly<{
    sourceCount: number;
    rejectedSourceCount: number;
    selectedRecordCount: number;
    excludedFutureObservationCount: number;
    excludedUnavailableAtDecisionCount: number;
    excludedOutsideLookbackCount: number;
  }>;
  readonly splitIntegrity: Readonly<{
    foldCount: number;
    discoveryObservationCount: number;
    holdoutObservationCount: number;
    overlappingEpisodeCount: number;
    holdoutPurgedObservationCount: number;
    holdoutEmbargoedObservationCount: number;
  }>;
  readonly candidateSearch: Readonly<{
    status: StrategyCandidateGenerationReport['status'];
    searchSpaceSize: number;
    effectiveHypothesisCount: number;
    constraintRejectedCount: number;
  }>;
  readonly featureEvidence: Readonly<{
    status: FeatureSelectionReport['status'];
    retainedResearchFeatureCount: number;
    retainedSafetyFeatureCount: number;
    correlationEvidenceComplete: boolean;
  }>;
  readonly strategyEvidence: Readonly<{
    hypothesisFamilySize: number;
    promotionStatus: string | null;
    evaluationUniverseComplete: boolean;
    pairedEpisodeCount: number;
    rawPValue: number | null;
    adjustedPValue: number | null;
    statisticallySignificant: boolean;
  }>;
  readonly robustness: Readonly<{
    status: RobustnessValidationDecision['status'];
    scenarioCount: number;
    positiveRegimeFraction: number;
    minimumObservedStressExpectancy: number | null;
    maximumObservedDrawdownPercent: number | null;
  }>;
  readonly executionTailRisk: Readonly<{
    iterations: number;
    independentEpisodeCount: number;
    expectedShortfallReturnFraction: number;
    probabilityOfRuin: number;
    probabilityOfPositiveReturn: number;
    probabilityDrawdownExceedsThreshold: number;
    maximumDrawdownThresholdFraction: number;
  }>;
  readonly releaseStatus: ReleaseCandidateDecision['status'];
  readonly blockingReasons: readonly string[];
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

const validatePolicy = (policy: ResearchAuditPolicy): void => {
  if (
    !Number.isSafeInteger(policy.minimumMonteCarloIterations) ||
    policy.minimumMonteCarloIterations <= 0 ||
    !Number.isSafeInteger(policy.minimumMonteCarloEpisodes) ||
    policy.minimumMonteCarloEpisodes <= 0
  ) {
    throw new Error('research audit integer thresholds must be positive');
  }
  for (const [name, value] of [
    ['maximumProbabilityOfRuin', policy.maximumProbabilityOfRuin],
    [
      'maximumDrawdownExceedanceProbability',
      policy.maximumDrawdownExceedanceProbability,
    ],
    ['minimumPositiveReturnProbability', policy.minimumPositiveReturnProbability],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${name} must be in [0, 1]`);
    }
  }
  if (!Number.isFinite(policy.minimumExpectedShortfallReturnFraction)) {
    throw new Error('minimumExpectedShortfallReturnFraction must be finite');
  }
};

export const buildResearchAuditReport = (input: {
  readonly targetStrategyId: string;
  readonly generatedAt: number;
  readonly manifest: ResearchExperimentManifest;
  readonly candidateGeneration: StrategyCandidateGenerationReport;
  readonly featureSelection: FeatureSelectionReport;
  readonly strategyComparison: StrategyComparisonReport;
  readonly robustnessValidation: RobustnessValidationDecision;
  readonly monteCarlo: ExecutionMonteCarloReport;
  readonly releaseDecision: ReleaseCandidateDecision;
  readonly policy?: Partial<ResearchAuditPolicy>;
}): ResearchAuditReport => {
  const policy: ResearchAuditPolicy = {
    ...DEFAULT_RESEARCH_AUDIT_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  if (input.targetStrategyId.trim().length === 0) {
    throw new Error('targetStrategyId must not be empty');
  }
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('generatedAt must be a non-negative safe integer');
  }
  const row = input.strategyComparison.rows.find(
    (candidate) => candidate.strategyId === input.targetStrategyId,
  );
  const paired = row?.pairedImprovement ?? null;
  const blockingReasons: string[] = [];
  if (input.manifest.status !== 'ACCEPTED_FOR_RESEARCH') {
    blockingReasons.push('EXPERIMENT_MANIFEST_REJECTED');
  }
  if (input.manifest.splitAudit.overlappingEpisodeCount !== 0) {
    blockingReasons.push('SPLIT_EPISODE_OVERLAP_DETECTED');
  }
  if (input.manifest.dataQuality.some((quality) => quality.status !== 'PASSED')) {
    blockingReasons.push('POINT_IN_TIME_DATA_QUALITY_REJECTED');
  }
  if (
    input.candidateGeneration.status !== 'GENERATED' ||
    input.candidateGeneration.effectiveHypothesisCount <= 0
  ) {
    blockingReasons.push('CANDIDATE_FAMILY_NOT_GENERATED');
  }
  if (input.featureSelection.status !== 'SELECTION_PASSED') {
    blockingReasons.push('FEATURE_SELECTION_NOT_PASSED');
  }
  if (!input.featureSelection.correlationEvidenceComplete) {
    blockingReasons.push('FEATURE_CORRELATION_EVIDENCE_INCOMPLETE');
  }
  if (row === undefined) {
    blockingReasons.push('TARGET_STRATEGY_MISSING_FROM_COMPARISON');
  } else if (row.promotionStatus !== 'ELIGIBLE_FOR_PAPER_COMPARISON') {
    blockingReasons.push(`STRATEGY_COMPARISON_${row.promotionStatus}`);
  }
  if (!(paired?.evaluationUniverseComplete ?? false)) {
    blockingReasons.push('SHARED_EVALUATION_UNIVERSE_INCOMPLETE');
  }
  if (!(paired?.statisticallySignificant ?? false)) {
    blockingReasons.push('MULTIPLICITY_ADJUSTED_SIGNIFICANCE_NOT_PASSED');
  }
  if (input.robustnessValidation.status !== 'ROBUSTNESS_PASSED') {
    blockingReasons.push('ROBUSTNESS_VALIDATION_NOT_PASSED');
  }
  if (input.monteCarlo.iterations < policy.minimumMonteCarloIterations) {
    blockingReasons.push('MONTE_CARLO_ITERATIONS_INSUFFICIENT');
  }
  if (
    input.monteCarlo.independentEpisodeCount <
    policy.minimumMonteCarloEpisodes
  ) {
    blockingReasons.push('MONTE_CARLO_EPISODES_INSUFFICIENT');
  }
  if (input.monteCarlo.probabilityOfRuin > policy.maximumProbabilityOfRuin) {
    blockingReasons.push('MONTE_CARLO_RUIN_PROBABILITY_TOO_HIGH');
  }
  if (
    input.monteCarlo.probabilityDrawdownExceedsThreshold >
    policy.maximumDrawdownExceedanceProbability
  ) {
    blockingReasons.push('MONTE_CARLO_DRAWDOWN_TAIL_TOO_HIGH');
  }
  if (
    input.monteCarlo.probabilityOfPositiveReturn <
    policy.minimumPositiveReturnProbability
  ) {
    blockingReasons.push('MONTE_CARLO_POSITIVE_RETURN_PROBABILITY_TOO_LOW');
  }
  if (
    input.monteCarlo.expectedShortfallReturnFraction <
    policy.minimumExpectedShortfallReturnFraction
  ) {
    blockingReasons.push('MONTE_CARLO_EXPECTED_SHORTFALL_TOO_LOW');
  }
  if (input.releaseDecision.status !== 'RELEASE_CANDIDATE') {
    blockingReasons.push('RELEASE_CANDIDATE_GATE_BLOCKED');
  }

  const dataQuality = input.manifest.dataQuality.reduce(
    (summary, quality) => ({
      sourceCount: summary.sourceCount + 1,
      rejectedSourceCount:
        summary.rejectedSourceCount + (quality.status === 'REJECTED' ? 1 : 0),
      selectedRecordCount: summary.selectedRecordCount + quality.selectedCount,
      excludedFutureObservationCount:
        summary.excludedFutureObservationCount +
        quality.excludedFutureObservationCount,
      excludedUnavailableAtDecisionCount:
        summary.excludedUnavailableAtDecisionCount +
        quality.excludedUnavailableAtDecisionCount,
      excludedOutsideLookbackCount:
        summary.excludedOutsideLookbackCount +
        quality.excludedOutsideLookbackCount,
    }),
    {
      sourceCount: 0,
      rejectedSourceCount: 0,
      selectedRecordCount: 0,
      excludedFutureObservationCount: 0,
      excludedUnavailableAtDecisionCount: 0,
      excludedOutsideLookbackCount: 0,
    },
  );
  const uniqueBlockingReasons = [...new Set(blockingReasons)];
  return {
    experimentId: input.manifest.experimentId,
    targetStrategyId: input.targetStrategyId,
    generatedAt: input.generatedAt,
    status:
      uniqueBlockingReasons.length === 0
        ? 'READY_FOR_RELEASE_REVIEW'
        : 'BLOCKED',
    dataQuality,
    splitIntegrity: input.manifest.splitAudit,
    candidateSearch: {
      status: input.candidateGeneration.status,
      searchSpaceSize: input.candidateGeneration.searchSpaceSize,
      effectiveHypothesisCount:
        input.candidateGeneration.effectiveHypothesisCount,
      constraintRejectedCount:
        input.candidateGeneration.constraintRejectedCount,
    },
    featureEvidence: {
      status: input.featureSelection.status,
      retainedResearchFeatureCount:
        input.featureSelection.retainedResearchFeatures.length,
      retainedSafetyFeatureCount:
        input.featureSelection.retainedSafetyFeatures.length,
      correlationEvidenceComplete:
        input.featureSelection.correlationEvidenceComplete,
    },
    strategyEvidence: {
      hypothesisFamilySize: input.strategyComparison.hypothesisFamilySize,
      promotionStatus: row?.promotionStatus ?? null,
      evaluationUniverseComplete: paired?.evaluationUniverseComplete ?? false,
      pairedEpisodeCount: paired?.pairedEpisodeCount ?? 0,
      rawPValue: paired?.rawPValue ?? null,
      adjustedPValue: paired?.adjustedPValue ?? null,
      statisticallySignificant: paired?.statisticallySignificant ?? false,
    },
    robustness: {
      status: input.robustnessValidation.status,
      scenarioCount: input.robustnessValidation.scenarioCount,
      positiveRegimeFraction:
        input.robustnessValidation.positiveRegimeFraction,
      minimumObservedStressExpectancy:
        input.robustnessValidation.minimumObservedStressExpectancy,
      maximumObservedDrawdownPercent:
        input.robustnessValidation.maximumObservedDrawdownPercent,
    },
    executionTailRisk: {
      iterations: input.monteCarlo.iterations,
      independentEpisodeCount: input.monteCarlo.independentEpisodeCount,
      expectedShortfallReturnFraction:
        input.monteCarlo.expectedShortfallReturnFraction,
      probabilityOfRuin: input.monteCarlo.probabilityOfRuin,
      probabilityOfPositiveReturn:
        input.monteCarlo.probabilityOfPositiveReturn,
      probabilityDrawdownExceedsThreshold:
        input.monteCarlo.probabilityDrawdownExceedsThreshold,
      maximumDrawdownThresholdFraction:
        input.monteCarlo.maximumDrawdownThresholdFraction,
    },
    releaseStatus: input.releaseDecision.status,
    blockingReasons: uniqueBlockingReasons,
    strategyPromotionAllowed: false,
    liveExecutionAllowed: false,
  };
};
