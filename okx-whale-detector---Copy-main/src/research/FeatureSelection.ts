import type { FeatureAblationDecision } from './FeatureAblation';

export type FeatureRole =
  | 'ALPHA'
  | 'REGIME'
  | 'RISK_FILTER'
  | 'EXECUTION_FILTER';

export interface FeatureImportanceObservation {
  readonly fold: number;
  readonly importance: number;
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
}

export const DEFAULT_FEATURE_SELECTION_POLICY: FeatureSelectionPolicy = {
  minimumImportanceFoldCount: 3,
  minimumPositiveImportanceFraction: 0.67,
  minimumMedianImportance: 0,
  maximumImportanceCoefficientOfVariation: 2,
  maximumAbsoluteCorrelation: 0.9,
  maximumRetainedResearchFeatures: 8,
};

export type FeatureSelectionRejectionReason =
  | 'INSUFFICIENT_IMPORTANCE_FOLDS'
  | 'IMPORTANCE_NOT_POSITIVE_ACROSS_FOLDS'
  | 'MEDIAN_IMPORTANCE_NOT_POSITIVE'
  | 'IMPORTANCE_UNSTABLE'
  | 'PAIRED_ABLATION_REQUIRED'
  | 'PAIRED_ABLATION_REJECTED'
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
  if (sorted.length % 2 === 1) {
    return upper;
  }
  const lower = sorted[middle - 1];
  return lower === undefined ? null : (lower + upper) / 2;
};

const sampleStandardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
};

const validatePolicy = (policy: FeatureSelectionPolicy): void => {
  if (
    !Number.isSafeInteger(policy.minimumImportanceFoldCount) ||
    policy.minimumImportanceFoldCount <= 0
  ) {
    throw new Error('minimumImportanceFoldCount must be a positive integer');
  }
  if (
    !Number.isFinite(policy.minimumPositiveImportanceFraction) ||
    policy.minimumPositiveImportanceFraction <= 0.5 ||
    policy.minimumPositiveImportanceFraction > 1
  ) {
    throw new Error('minimumPositiveImportanceFraction must be in (0.5, 1]');
  }
  if (!Number.isFinite(policy.minimumMedianImportance)) {
    throw new Error('minimumMedianImportance must be finite');
  }
  if (
    !Number.isFinite(policy.maximumImportanceCoefficientOfVariation) ||
    policy.maximumImportanceCoefficientOfVariation < 0
  ) {
    throw new Error(
      'maximumImportanceCoefficientOfVariation must be finite and non-negative',
    );
  }
  if (
    !Number.isFinite(policy.maximumAbsoluteCorrelation) ||
    policy.maximumAbsoluteCorrelation <= 0 ||
    policy.maximumAbsoluteCorrelation > 1
  ) {
    throw new Error('maximumAbsoluteCorrelation must be in (0, 1]');
  }
  if (
    !Number.isSafeInteger(policy.maximumRetainedResearchFeatures) ||
    policy.maximumRetainedResearchFeatures <= 0
  ) {
    throw new Error(
      'maximumRetainedResearchFeatures must be a positive integer',
    );
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

  const foldIds = new Set<number>();
  for (const observation of candidate.importanceByFold) {
    if (!Number.isSafeInteger(observation.fold) || observation.fold < 0) {
      throw new Error(`invalid fold for ${candidate.featureName}`);
    }
    if (foldIds.has(observation.fold)) {
      throw new Error(
        `duplicate importance fold ${observation.fold} for ${candidate.featureName}`,
      );
    }
    foldIds.add(observation.fold);
    if (!Number.isFinite(observation.importance)) {
      throw new Error(`non-finite importance for ${candidate.featureName}`);
    }
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
  const importanceCoefficientOfVariation =
    importances.length === 0 || averageImportance === 0
      ? Number.POSITIVE_INFINITY
      : sampleStandardDeviation(importances) / Math.abs(averageImportance);

  if (importances.length < policy.minimumImportanceFoldCount) {
    rejectionReasons.push('INSUFFICIENT_IMPORTANCE_FOLDS');
  }
  if (
    positiveImportanceFraction < policy.minimumPositiveImportanceFraction
  ) {
    rejectionReasons.push('IMPORTANCE_NOT_POSITIVE_ACROSS_FOLDS');
  }
  if (
    medianImportance === null ||
    medianImportance <= policy.minimumMedianImportance
  ) {
    rejectionReasons.push('MEDIAN_IMPORTANCE_NOT_POSITIVE');
  }
  if (
    !Number.isFinite(importanceCoefficientOfVariation) ||
    importanceCoefficientOfVariation >
      policy.maximumImportanceCoefficientOfVariation
  ) {
    rejectionReasons.push('IMPORTANCE_UNSTABLE');
  }
  if (candidate.ablation === null) {
    rejectionReasons.push('PAIRED_ABLATION_REQUIRED');
  } else if (
    candidate.ablation.status !== 'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE'
  ) {
    rejectionReasons.push('PAIRED_ABLATION_REJECTED');
  }

  const selectionScore =
    medianImportance === null ||
    !Number.isFinite(importanceCoefficientOfVariation)
      ? null
      : (medianImportance * positiveImportanceFraction) /
        (1 + importanceCoefficientOfVariation);
  if (rejectionReasons.length === 0) {
    rationale.push('STABLE_IMPORTANCE_AND_PAIRED_ABLATION_SUPPORTED');
  }

  return {
    candidate,
    medianImportance,
    positiveImportanceFraction,
    importanceCoefficientOfVariation:
      Number.isFinite(importanceCoefficientOfVariation)
        ? importanceCoefficientOfVariation
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
  readonly policy?: FeatureSelectionPolicy;
}): FeatureSelectionReport => {
  const policy = input.policy ?? DEFAULT_FEATURE_SELECTION_POLICY;
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
      !candidateNames.has(evidence.rightFeature)
    ) {
      throw new Error('correlation references an unknown feature');
    }
    if (evidence.leftFeature === evidence.rightFeature) {
      throw new Error('correlation must reference two different features');
    }
    if (
      !Number.isFinite(evidence.absoluteCorrelation) ||
      evidence.absoluteCorrelation < 0 ||
      evidence.absoluteCorrelation > 1
    ) {
      throw new Error('absoluteCorrelation must be in [0, 1]');
    }
    const key = correlationKey(evidence.leftFeature, evidence.rightFeature);
    correlations.set(
      key,
      Math.max(correlations.get(key) ?? 0, evidence.absoluteCorrelation),
    );
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
    if (
      retainedResearch.length >= policy.maximumRetainedResearchFeatures
    ) {
      evaluation.rejectionReasons.push('COMPLEXITY_BUDGET_EXCEEDED');
      continue;
    }
    const redundantWith = retainedResearch.find((retained) => {
      const correlation =
        correlations.get(
          correlationKey(
            evaluation.candidate.featureName,
            retained.candidate.featureName,
          ),
        ) ?? 0;
      return correlation >= policy.maximumAbsoluteCorrelation;
    });
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
    rejectionReasons: evaluation.rejectionReasons,
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
  const rejectionReasons =
    retainedResearchFeatures.length === 0
      ? ['NO_RESEARCH_FEATURE_RETAINED']
      : [];

  return {
    status:
      rejectionReasons.length === 0 ? 'SELECTION_PASSED' : 'REJECTED',
    selectedFeatures: [
      ...retainedResearchFeatures,
      ...retainedSafetyFeatures,
    ].sort(),
    retainedResearchFeatures,
    retainedSafetyFeatures,
    decisions,
    rejectionReasons,
    liveExecutionAllowed: false,
  };
};
