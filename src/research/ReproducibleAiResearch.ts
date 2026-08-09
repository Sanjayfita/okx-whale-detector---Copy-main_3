import { createHash } from 'node:crypto';

import type { FeatureAblationDecision } from './FeatureAblation';

export type AiResearchRole =
  | 'FEATURE_RANKING'
  | 'REGIME_CLASSIFICATION'
  | 'PARAMETER_PRIOR'
  | 'TRADE_QUALITY_SCORING'
  | 'PATTERN_CLUSTERING';

export interface AiResearchFoldResult {
  readonly fold: number;
  readonly featureScores: Readonly<Record<string, number>>;
}

export interface AiResearchRun {
  readonly runId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly role: AiResearchRole;
  readonly datasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly seed: number;
  readonly deterministic: boolean;
  readonly directSignalOutput: boolean;
  readonly folds: readonly AiResearchFoldResult[];
  readonly ablations: Readonly<Record<string, FeatureAblationDecision>>;
}

export interface AiFeatureResearchDecision {
  readonly featureName: string;
  readonly medianScore: number;
  readonly positiveFoldFraction: number;
  readonly medianRank: number;
  readonly rankStandardDeviation: number;
  readonly status:
    | 'ABLATION_SUPPORTED'
    | 'AI_PRIOR_ONLY'
    | 'REJECTED';
  readonly reasons: readonly string[];
}

export interface AiResearchReport {
  readonly runId: string;
  readonly status: 'ACCEPTED_FOR_RESEARCH' | 'REJECTED';
  readonly artifactFingerprint: string;
  readonly decisions: readonly AiFeatureResearchDecision[];
  readonly rejectionReasons: readonly string[];
  readonly directTradingSignalAllowed: false;
  readonly liveExecutionAllowed: false;
}

export interface AiResearchPolicy {
  readonly minimumFoldCount: number;
  readonly minimumPositiveFoldFraction: number;
  readonly maximumRankStandardDeviation: number;
}

export const DEFAULT_AI_RESEARCH_POLICY: AiResearchPolicy = {
  minimumFoldCount: 3,
  minimumPositiveFoldFraction: 0.67,
  maximumRankStandardDeviation: 2,
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) {
    return current;
  }
  return ((sorted[middle - 1] ?? current) + current) / 2;
};

const standardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) {
    return 0;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

const artifactFingerprint = (run: AiResearchRun): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(run)))
    .digest('hex');

const validateRun = (
  run: AiResearchRun,
  policy: AiResearchPolicy,
): readonly string[] => {
  const reasons: string[] = [];
  if (run.runId.trim().length === 0) {
    reasons.push('RUN_ID_REQUIRED');
  }
  if (run.modelId.trim().length === 0 || run.modelVersion.trim().length === 0) {
    reasons.push('MODEL_IDENTITY_REQUIRED');
  }
  if (
    run.datasetFingerprint.trim().length === 0 ||
    run.codeCommit.trim().length === 0 ||
    run.configurationHash.trim().length === 0
  ) {
    reasons.push('REPRODUCIBILITY_METADATA_REQUIRED');
  }
  if (!Number.isSafeInteger(run.seed)) {
    reasons.push('SAFE_INTEGER_SEED_REQUIRED');
  }
  if (!run.deterministic) {
    reasons.push('NON_DETERMINISTIC_RUN');
  }
  if (run.directSignalOutput) {
    reasons.push('DIRECT_AI_TRADING_SIGNAL_FORBIDDEN');
  }
  if (run.folds.length < policy.minimumFoldCount) {
    reasons.push('INSUFFICIENT_VALIDATION_FOLDS');
  }
  const foldIds = new Set<number>();
  for (const fold of run.folds) {
    if (!Number.isSafeInteger(fold.fold) || fold.fold < 0 || foldIds.has(fold.fold)) {
      reasons.push('INVALID_OR_DUPLICATE_FOLD');
    }
    foldIds.add(fold.fold);
    for (const [featureName, score] of Object.entries(fold.featureScores)) {
      if (featureName.trim().length === 0 || !Number.isFinite(score)) {
        reasons.push('INVALID_FEATURE_SCORE');
      }
    }
  }
  return [...new Set(reasons)];
};

export const evaluateAiAssistedResearch = (input: {
  readonly run: AiResearchRun;
  readonly policy?: AiResearchPolicy;
}): AiResearchReport => {
  const policy = input.policy ?? DEFAULT_AI_RESEARCH_POLICY;
  const rejectionReasons = validateRun(input.run, policy);
  const fingerprint = artifactFingerprint(input.run);
  if (rejectionReasons.length > 0) {
    return {
      runId: input.run.runId,
      status: 'REJECTED',
      artifactFingerprint: fingerprint,
      decisions: [],
      rejectionReasons,
      directTradingSignalAllowed: false,
      liveExecutionAllowed: false,
    };
  }

  const features = [...new Set(
    input.run.folds.flatMap((fold) => Object.keys(fold.featureScores)),
  )].sort();
  const foldRanks = input.run.folds.map((fold) =>
    Object.entries(fold.featureScores)
      .sort(
        ([leftName, leftScore], [rightName, rightScore]) =>
          rightScore - leftScore || leftName.localeCompare(rightName),
      )
      .map(([featureName], index) => [featureName, index + 1] as const),
  );

  const decisions = features
    .map((featureName): AiFeatureResearchDecision => {
      const scores = input.run.folds.map(
        (fold) => fold.featureScores[featureName] ?? 0,
      );
      const ranks = foldRanks.map(
        (ranked) =>
          ranked.find(([name]) => name === featureName)?.[1] ?? features.length,
      );
      const medianScore = median(scores);
      const positiveFoldFraction =
        scores.filter((score) => score > 0).length / scores.length;
      const medianRank = median(ranks);
      const rankStandardDeviation = standardDeviation(ranks);
      const reasons: string[] = [];
      if (medianScore <= 0) {
        reasons.push('NON_POSITIVE_MEDIAN_SCORE');
      }
      if (positiveFoldFraction < policy.minimumPositiveFoldFraction) {
        reasons.push('UNSTABLE_SCORE_SIGN');
      }
      if (rankStandardDeviation > policy.maximumRankStandardDeviation) {
        reasons.push('UNSTABLE_FOLD_RANK');
      }
      const ablation = input.run.ablations[featureName];
      if (ablation === undefined) {
        reasons.push('PAIRED_ABLATION_REQUIRED_FOR_PROMOTION');
      } else if (ablation.status !== 'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE') {
        reasons.push('PAIRED_ABLATION_REJECTED');
      }

      const researchEvidenceFailed = reasons.some(
        (reason) =>
          reason === 'NON_POSITIVE_MEDIAN_SCORE' ||
          reason === 'UNSTABLE_SCORE_SIGN' ||
          reason === 'UNSTABLE_FOLD_RANK',
      );
      return {
        featureName,
        medianScore,
        positiveFoldFraction,
        medianRank,
        rankStandardDeviation,
        status: researchEvidenceFailed
          ? 'REJECTED'
          : reasons.length === 0
            ? 'ABLATION_SUPPORTED'
            : 'AI_PRIOR_ONLY',
        reasons,
      };
    })
    .sort(
      (left, right) =>
        left.medianRank - right.medianRank ||
        right.medianScore - left.medianScore ||
        left.featureName.localeCompare(right.featureName),
    );

  return {
    runId: input.run.runId,
    status: 'ACCEPTED_FOR_RESEARCH',
    artifactFingerprint: fingerprint,
    decisions,
    rejectionReasons: [],
    directTradingSignalAllowed: false,
    liveExecutionAllowed: false,
  };
};
