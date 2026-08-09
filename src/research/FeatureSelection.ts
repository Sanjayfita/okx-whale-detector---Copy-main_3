import type { FeatureAblationDecision } from './FeatureAblation';

export type FeatureRole =
  | 'ALPHA'
  | 'REGIME'
  | 'RISK_FILTER'
  | 'EXECUTION_FILTER';

export interface FeatureImportanceObservation {
  readonly fold: number;
  readonly importance: number;
  readonly permutationScope?: 'GLOBAL' | 'WITHIN_BLOCK';
}

export interface FeatureSelectionCandidate {
  readonly featureName: string;
  readonly role: FeatureRole;
  readonly documentedPurpose: string;
  readonly requiredForSafety: boolean;
  readonly importanceByFold: readonly FeatureImportanceObservation[];
  readonly ablation: FeatureAblationDecision | null;
}

export interface FeatureCorrelationEvidence {
  readonly leftFeature: string;
  readonly rightFeature: string;
  readonly absoluteCorrelation: number;
}

export interface FeatureSelectionPolicy {
  readonly minimumImportanceFoldCount: number;
  readonly minimumPositiveImportanceFraction: number;
  readonly minimumMedianImportance: number;
  readonly maximumImportanceCoefficientOfVariation: number;
  readonly maximumAbsoluteCorrelation: number;
  readonly maximumRetainedResearchFeatures: number;
  readonly requireBlockAwareImportance: boolean;
  readonly requireCompleteCorrelationEvidence: boolean;
  readonly maximumFamilywiseAblationPValue: number;
}

export const DEFAULT_FEATURE_SELECTION_POLICY: FeatureSelectionPolicy = {
  minimumImportanceFoldCount: 3,
  minimumPositiveImportanceFraction: 0.67,
  minimumMedianImportance: 0,
  maximumImportanceCoefficientOfVariation: 2,
  maximumAbsoluteCorrelation: 0.9,
  maximumRetainedResearchFeatures: 8,
  requireBlockAwareImportance: true,
  requireCompleteCorrelationEvidence: true,
  maximumFamilywiseAblationPValue: 0.05,
};

export type FeatureSelectionRejectionReason =
  | 'INSUFFICIENT_IMPORTANCE_FOLDS'
  | 'IMPORTANCE_NOT_POSITIVE_ACROSS_FOLDS'
  | 'MEDIAN_IMPORTANCE_NOT_POSITIVE'
  | 'IMPORTANCE_UNSTABLE'
  | 'BLOCK_AWARE_IMPORTANCE_REQUIRED'
  | 'PAIRED_ABLATION_REQUIRED'
  | 'PAIRED_ABLATION_REJECTED'
  | 'FAMILYWISE_ABLATION_NOT_SIGNIFICANT'
  | 'INCOMPLETE_CORRELATION_EVIDENCE'
  | 'SAFETY_ROLE_REQUIRED_FOR_SAFETY_FEATURE'
  | 'COMPLEXITY_BUDGET_EXCEEDED'
  | `REDUNDANT_WITH:${string}`;

export interface FeatureSelectionDecision {
  readonly featureName: string;
  readonly role: FeatureRole;
  readonly status: 'RETAINED' | 'REJECTED';
  readonly documentedPurpose: string;
  readonly medianImportance: number | null;
  readonly positiveImportanceFraction: number | null;
  readonly importanceCoefficientOfVariation: number | null;
  readonly selectionScore: number | null;
  readonly rationale: readonly string[];
  readonly rejectionReasons: readonly FeatureSelectionRejectionReason[];
}

export interface FeatureSelectionReport {
  readonly status: 'SELECTION_PASSED' | 'REJECTED';
  readonly selectedFeatures: readonly string[];
  readonly retainedResearchFeatures: readonly string[];
  readonly retainedSafetyFeatures: readonly string[];
  readonly decisions: readonly FeatureSelectionDecision[];
  readonly rejectionReasons: readonly string[];
  readonly correlationEvidenceComplete: boolean;
  readonly liveExecutionAllowed: false;
}

interface MutableFeatureEvaluation {
  readonly candidate: FeatureSelectionCandidate;
  readonly medianImportance: number | null;
  readonly positiveImportanceFraction: number | null;
  readonly importanceCoefficientOfVariation: number | null;
  readonly selectionScore: number | null;
  readonly rationale: string[];
  readonly rejectionReasons: FeatureSelectionRejectionReason[];
  retained: boolean;
}

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) {
    return null;
  }
  return sorted.length % 2 === 1
    ? upper
    : ((sorted[middle - 1] ?? upper) + upper) / 2;
};

const sampleStandardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  return Math.sqrt(
    Math.max(
      0,
      values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
        (values.length - 1),
    ),
  );
};

const validatePolicy = (policy: FeatureSelectionPolicy): void => {
  if (
    !Number.isSafeInteger(policy.minimumImportanceFoldCount) ||
    policy.minimumImportanceFoldCount <= 0 ||
    !Number.isSafeInteger(policy.maximumRetainedResearchFeatures) ||
    policy.maximumRetainedResearchFeatures <= 0
  ) {
    throw new Error('feature selection integer policy is invalid');
  }
  if (
    policy.minimumPositiveImportanceFraction <= 0.5 ||
    policy.minimumPositiveImportanceFraction > 1 ||
    !Number.isFinite(policy.minimumMedianImportance) ||
    policy.maximumImportanceCoefficientOfVariation < 0 ||
    !Number.isFinite(policy.maximumImportanceCoefficientOfVariation) ||
    policy.maximumAbsoluteCorrelation <= 0 ||
    policy.maximumAbsoluteCorrelation > 1 ||
    policy.maximumFamilywiseAblationPValue <= 0 ||
    policy.maximumFamilywiseAblationPValue >= 1
  ) {
    throw new Error('feature selection threshold policy is invalid');
  }
};

const correlationKey = (left: string, right: string): string =>
  left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;

const isSafetyRole = (role: FeatureRole): boolean =>
  role === 'RISK_FILTER' || role === 'EXECUTION_FILTER';

const evaluateCandidate = (input: {
  readonly candidate: FeatureSelectionCandidate;
  readonly policy: FeatureSelectionPolicy;
}): MutableFeatureEvaluation => {
  const { candidate, policy } = input;
  if (candidate.featureName.trim().length === 0) {
    throw new Error('featureName must not be empty');
  }
  if (candidate.documentedPurpose.trim().length === 0) {
    throw new Error(`documentedPurpose is required for ${candidate.featureName}`);
  }
  const rationale: string[] = [];
  const rejectionReasons: FeatureSelectionRejectionReason[] = [];
  if (candidate.requiredForSafety) {
    if (!isSafetyRole(candidate.role)) {
      rejectionReasons.push('SAFETY_ROLE_REQUIRED_FOR_SAFETY_FEATURE');
    } else {
      rationale.push('REQUIRED_FOR_REALISTIC_EXECUTION_OR_RISK_CONTROL');
    }
    return {
      candidate,
      medianImportance: null,
      positiveImportanceFraction: null,
      importanceCoefficientOfVariation: null,
      selectionScore: null,
      rationale,
      rejectionReasons,
      retained: rejectionReasons.length === 0,
    };
  }

  const foldIds = new Set<number>();
  for (const observation of candidate.importanceByFold) {
    if (!Number.isSafeInteger(observation.fold) || observation.fold < 0) {
      throw new Error(`invalid fold for ${candidate.featureName}`);
    }
    if (foldIds.has(observation.fold)) {
      throw new Error(`duplicate importance fold ${observation.fold} for ${candidate.featureName}`);
    }
    foldIds.add(observation.fold);
    if (!Number.isFinite(observation.importance)) {
      throw new Error(`non-finite importance for ${candidate.featureName}`);
    }
  }
  const importances = candidate.importanceByFold.map(
    (observation) => observation.importance,
  );
  const medianImportance = median(importances);
  const positiveImportanceFraction =
    importances.length === 0
      ? 0
      : importances.filter((importance) => importance > 0).length /
        importances.length;
  const averageImportance = mean(importances);
  const coefficient =
    importances.length === 0 || averageImportance === 0
      ? Number.POSITIVE_INFINITY
      : sampleStandardDeviation(importances) / Math.abs(averageImportance);

  if (importances.length < policy.minimumImportanceFoldCount) {
    rejectionReasons.push('INSUFFICIENT_IMPORTANCE_FOLDS');
  }
  if (positiveImportanceFraction < policy.minimumPositiveImportanceFraction) {
    rejectionReasons.push('IMPORTANCE_NOT_POSITIVE_ACROSS_FOLDS');
  }
  if (
    medianImportance === null ||
    medianImportance <= policy.minimumMedianImportance
  ) {
    rejectionReasons.push('MEDIAN_IMPORTANCE_NOT_POSITIVE');
  }
  if (!Number.isFinite(coefficient) || coefficient > policy.maximumImportanceCoefficientOfVariation) {
    rejectionReasons.push('IMPORTANCE_UNSTABLE');
  }
  if (
    policy.requireBlockAwareImportance &&
    candidate.importanceByFold.some(
      (observation) => observation.permutationScope !== 'WITHIN_BLOCK',
    )
  ) {
    rejectionReasons.push('BLOCK_AWARE_IMPORTANCE_REQUIRED');
  }
  if (candidate.ablation === null) {
    rejectionReasons.push('PAIRED_ABLATION_REQUIRED');
  } else {
    if (
      candidate.ablation.status !==
      'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE'
    ) {
      rejectionReasons.push('PAIRED_ABLATION_REJECTED');
    }
    if (
      candidate.ablation.adjustedPValue === null ||
      candidate.ablation.adjustedPValue >
        policy.maximumFamilywiseAblationPValue
    ) {
      rejectionReasons.push('FAMILYWISE_ABLATION_NOT_SIGNIFICANT');
    }
  }
  const selectionScore =
    medianImportance === null || !Number.isFinite(coefficient)
      ? null
      : (medianImportance * positiveImportanceFraction) / (1 + coefficient);
  if (rejectionReasons.length === 0) {
    rationale.push('BLOCK_AWARE_IMPORTANCE_AND_FAMILYWISE_ABLATION_SUPPORTED');
  }
  return {
    candidate,
    medianImportance,
    positiveImportanceFraction,
    importanceCoefficientOfVariation: Number.isFinite(coefficient)
      ? coefficient
      : null,
    selectionScore,
    rationale,
    rejectionReasons,
    retained: false,
  };
};

export const selectFeatures = (input: {
  readonly candidates: readonly FeatureSelectionCandidate[];
  readonly correlations: readonly FeatureCorrelationEvidence[];
  readonly policy?: Partial<FeatureSelectionPolicy>;
}): FeatureSelectionReport => {
  const policy: FeatureSelectionPolicy = {
    ...DEFAULT_FEATURE_SELECTION_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  if (input.candidates.length === 0) {
    throw new Error('feature selection requires candidates');
  }
  const candidateNames = new Set<string>();
  const evaluations = input.candidates.map((candidate) => {
    if (candidateNames.has(candidate.featureName)) {
      throw new Error(`duplicate featureName ${candidate.featureName}`);
    }
    candidateNames.add(candidate.featureName);
    return evaluateCandidate({ candidate, policy });
  });

  const correlations = new Map<string, number>();
  for (const evidence of input.correlations) {
    if (
      !candidateNames.has(evidence.leftFeature) ||
      !candidateNames.has(evidence.rightFeature) ||
      evidence.leftFeature === evidence.rightFeature
    ) {
      throw new Error('correlation references invalid features');
    }
    if (
      !Number.isFinite(evidence.absoluteCorrelation) ||
      evidence.absoluteCorrelation < 0 ||
      evidence.absoluteCorrelation > 1
    ) {
      throw new Error('absoluteCorrelation must be in [0, 1]');
    }
    const key = correlationKey(evidence.leftFeature, evidence.rightFeature);
    const previous = correlations.get(key);
    if (
      previous !== undefined &&
      Math.abs(previous - evidence.absoluteCorrelation) > 1e-12
    ) {
      throw new Error(`conflicting correlation evidence for ${key}`);
    }
    correlations.set(key, evidence.absoluteCorrelation);
  }

  const otherwiseEligible = evaluations.filter(
    (evaluation) =>
      !evaluation.candidate.requiredForSafety &&
      evaluation.rejectionReasons.length === 0,
  );
  const globalRejectionReasons: string[] = [];
  if (policy.requireCompleteCorrelationEvidence) {
    for (let leftIndex = 0; leftIndex < otherwiseEligible.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < otherwiseEligible.length;
        rightIndex += 1
      ) {
        const left = otherwiseEligible[leftIndex];
        const right = otherwiseEligible[rightIndex];
        if (left === undefined || right === undefined) {
          continue;
        }
        const key = correlationKey(
          left.candidate.featureName,
          right.candidate.featureName,
        );
        if (!correlations.has(key)) {
          left.rejectionReasons.push('INCOMPLETE_CORRELATION_EVIDENCE');
          right.rejectionReasons.push('INCOMPLETE_CORRELATION_EVIDENCE');
          globalRejectionReasons.push(
            `MISSING_CORRELATION_EVIDENCE:${left.candidate.featureName}:${right.candidate.featureName}`,
          );
        }
      }
    }
  }

  const retainedResearch: MutableFeatureEvaluation[] = [];
  const eligibleResearch = evaluations
    .filter(
      (evaluation) =>
        !evaluation.candidate.requiredForSafety &&
        evaluation.rejectionReasons.length === 0,
    )
    .sort(
      (left, right) =>
        (right.selectionScore ?? Number.NEGATIVE_INFINITY) -
          (left.selectionScore ?? Number.NEGATIVE_INFINITY) ||
        left.candidate.featureName.localeCompare(right.candidate.featureName),
    );
  for (const evaluation of eligibleResearch) {
    if (retainedResearch.length >= policy.maximumRetainedResearchFeatures) {
      evaluation.rejectionReasons.push('COMPLEXITY_BUDGET_EXCEEDED');
      continue;
    }
    const redundantWith = retainedResearch.find((retained) =>
      (correlations.get(
        correlationKey(
          evaluation.candidate.featureName,
          retained.candidate.featureName,
        ),
      ) ?? 0) >= policy.maximumAbsoluteCorrelation,
    );
    if (redundantWith !== undefined) {
      evaluation.rejectionReasons.push(
        `REDUNDANT_WITH:${redundantWith.candidate.featureName}`,
      );
      continue;
    }
    evaluation.retained = true;
    retainedResearch.push(evaluation);
  }

  const decisions = evaluations.map((evaluation): FeatureSelectionDecision => ({
    featureName: evaluation.candidate.featureName,
    role: evaluation.candidate.role,
    status: evaluation.retained ? 'RETAINED' : 'REJECTED',
    documentedPurpose: evaluation.candidate.documentedPurpose,
    medianImportance: evaluation.medianImportance,
    positiveImportanceFraction: evaluation.positiveImportanceFraction,
    importanceCoefficientOfVariation:
      evaluation.importanceCoefficientOfVariation,
    selectionScore: evaluation.selectionScore,
    rationale: evaluation.rationale,
    rejectionReasons: [...new Set(evaluation.rejectionReasons)],
  }));
  const retainedSafetyFeatures = decisions
    .filter(
      (decision) =>
        decision.status === 'RETAINED' && isSafetyRole(decision.role),
    )
    .map((decision) => decision.featureName)
    .sort();
  const retainedResearchFeatures = decisions
    .filter(
      (decision) =>
        decision.status === 'RETAINED' && !isSafetyRole(decision.role),
    )
    .map((decision) => decision.featureName)
    .sort();
  if (retainedResearchFeatures.length === 0) {
    globalRejectionReasons.push('NO_RESEARCH_FEATURE_RETAINED');
  }
  const rejectionReasons = [...new Set(globalRejectionReasons)];
  return {
    status: rejectionReasons.length === 0 ? 'SELECTION_PASSED' : 'REJECTED',
    selectedFeatures: [
      ...retainedResearchFeatures,
      ...retainedSafetyFeatures,
    ].sort(),
    retainedResearchFeatures,
    retainedSafetyFeatures,
    decisions,
    rejectionReasons,
    correlationEvidenceComplete: !rejectionReasons.some((reason) =>
      reason.startsWith('MISSING_CORRELATION_EVIDENCE:'),
    ),
    liveExecutionAllowed: false,
  };
};
