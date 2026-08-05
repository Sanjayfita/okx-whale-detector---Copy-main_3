import { fingerprintResearchValue } from '../research/ResearchFingerprint';

export type AdaptiveFeatureOperation =
  | 'IDENTITY'
  | 'LAG'
  | 'CHANGE'
  | 'Z_SCORE'
  | 'RATIO'
  | 'INTERACTION';

export interface AdaptiveBaseFeature {
  readonly featureName: string;
  readonly role: 'ALPHA' | 'REGIME' | 'RISK_FILTER' | 'EXECUTION_FILTER';
  readonly requiredDataCapabilities: readonly string[];
  readonly maximumSourceLookbackMs: number;
  readonly targetDerived: boolean;
}

export interface AdaptiveFeatureRecipe {
  readonly recipeId: string;
  readonly operation: AdaptiveFeatureOperation;
  readonly arity: 1 | 2;
  readonly windowsMs: readonly number[];
  readonly complexityUnits: number;
}

export interface PriorFeatureExperiment {
  readonly featureFingerprint: string;
  readonly status: 'REJECTED' | 'INCONCLUSIVE' | 'RETAINED';
  readonly completedAt: number;
}

export interface AdaptiveFeatureDiscoveryPolicy {
  readonly maximumBaseFeatures: number;
  readonly maximumRecipes: number;
  readonly maximumCandidates: number;
  readonly maximumLookbackMs: number;
  readonly maximumComplexityUnits: number;
  readonly allowRetestRejected: boolean;
}

export const DEFAULT_ADAPTIVE_FEATURE_DISCOVERY_POLICY: AdaptiveFeatureDiscoveryPolicy = {
  maximumBaseFeatures: 250,
  maximumRecipes: 50,
  maximumCandidates: 10_000,
  maximumLookbackMs: 30 * 24 * 60 * 60_000,
  maximumComplexityUnits: 20,
  allowRetestRejected: false,
};

export interface AdaptiveFeatureCandidate {
  readonly featureId: string;
  readonly featureFingerprint: string;
  readonly recipeId: string;
  readonly operation: AdaptiveFeatureOperation;
  readonly inputFeatureNames: readonly string[];
  readonly role: AdaptiveBaseFeature['role'];
  readonly windowMs: number | null;
  readonly totalLookbackMs: number;
  readonly complexityUnits: number;
  readonly requiredDataCapabilities: readonly string[];
  readonly lineage: readonly string[];
  readonly status: 'READY_FOR_ABLATION' | 'BLOCKED';
  readonly blockingReasons: readonly string[];
  readonly discoveryOnly: true;
  readonly holdoutAccessed: false;
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

export interface AdaptiveFeatureDiscoveryReport {
  readonly datasetFingerprint: string;
  readonly baseFeatureCount: number;
  readonly recipeCount: number;
  readonly generatedCount: number;
  readonly readyCount: number;
  readonly blockedCount: number;
  readonly duplicateCount: number;
  readonly candidates: readonly AdaptiveFeatureCandidate[];
  readonly familyFingerprint: string;
  readonly status: 'GENERATED' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
  readonly holdoutAccessed: false;
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

const requireText = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
};

const normalizeStrings = (values: readonly string[], name: string): readonly string[] =>
  [...new Set(values.map((value) => requireText(value, name)))].sort();

const validatePolicy = (policy: AdaptiveFeatureDiscoveryPolicy): void => {
  for (const [name, value] of Object.entries(policy)) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
};

const validateBaseFeature = (feature: AdaptiveBaseFeature): AdaptiveBaseFeature => {
  const featureName = requireText(feature.featureName, 'featureName');
  if (
    !Number.isSafeInteger(feature.maximumSourceLookbackMs) ||
    feature.maximumSourceLookbackMs < 0
  ) {
    throw new Error(`invalid source lookback for ${featureName}`);
  }
  return {
    ...feature,
    featureName,
    requiredDataCapabilities: normalizeStrings(
      feature.requiredDataCapabilities,
      'data capability',
    ),
  };
};

const validateRecipe = (recipe: AdaptiveFeatureRecipe): AdaptiveFeatureRecipe => {
  const recipeId = requireText(recipe.recipeId, 'recipeId');
  if (!Number.isSafeInteger(recipe.complexityUnits) || recipe.complexityUnits <= 0) {
    throw new Error(`invalid complexity for ${recipeId}`);
  }
  const windowsMs = [...new Set(recipe.windowsMs)].sort((left, right) => left - right);
  for (const windowMs of windowsMs) {
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
      throw new Error(`invalid window for ${recipeId}`);
    }
  }
  if (recipe.operation === 'IDENTITY' && windowsMs.length > 0) {
    throw new Error('IDENTITY recipes must not define windows');
  }
  if (recipe.operation !== 'IDENTITY' && windowsMs.length === 0) {
    throw new Error(`${recipe.operation} recipes require windows`);
  }
  if (
    (recipe.operation === 'RATIO' || recipe.operation === 'INTERACTION') !==
    (recipe.arity === 2)
  ) {
    throw new Error(`recipe arity does not match ${recipe.operation}`);
  }
  return { ...recipe, recipeId, windowsMs };
};

const roleForInputs = (
  inputs: readonly AdaptiveBaseFeature[],
): AdaptiveBaseFeature['role'] => {
  if (inputs.some((feature) => feature.role === 'EXECUTION_FILTER')) {
    return 'EXECUTION_FILTER';
  }
  if (inputs.some((feature) => feature.role === 'RISK_FILTER')) {
    return 'RISK_FILTER';
  }
  if (inputs.some((feature) => feature.role === 'REGIME')) return 'REGIME';
  return 'ALPHA';
};

export const discoverAdaptiveFeatures = (input: {
  readonly datasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly baseFeatures: readonly AdaptiveBaseFeature[];
  readonly recipes: readonly AdaptiveFeatureRecipe[];
  readonly availableDataCapabilities: readonly string[];
  readonly priorExperiments?: readonly PriorFeatureExperiment[];
  readonly policy?: Partial<AdaptiveFeatureDiscoveryPolicy>;
}): AdaptiveFeatureDiscoveryReport => {
  const policy: AdaptiveFeatureDiscoveryPolicy = {
    ...DEFAULT_ADAPTIVE_FEATURE_DISCOVERY_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  const datasetFingerprint = requireText(input.datasetFingerprint, 'datasetFingerprint');
  const codeCommit = requireText(input.codeCommit, 'codeCommit');
  const configurationHash = requireText(input.configurationHash, 'configurationHash');
  const rejectionReasons: string[] = [];
  if (input.baseFeatures.length === 0) rejectionReasons.push('NO_BASE_FEATURES');
  if (input.recipes.length === 0) rejectionReasons.push('NO_FEATURE_RECIPES');
  if (input.baseFeatures.length > policy.maximumBaseFeatures) {
    rejectionReasons.push('BASE_FEATURE_LIMIT_EXCEEDED');
  }
  if (input.recipes.length > policy.maximumRecipes) {
    rejectionReasons.push('RECIPE_LIMIT_EXCEEDED');
  }
  const baseFeatures = input.baseFeatures
    .map(validateBaseFeature)
    .sort((left, right) => left.featureName.localeCompare(right.featureName));
  if (new Set(baseFeatures.map((feature) => feature.featureName)).size !== baseFeatures.length) {
    throw new Error('base feature names must be unique');
  }
  const recipes = input.recipes
    .map(validateRecipe)
    .sort((left, right) => left.recipeId.localeCompare(right.recipeId));
  if (new Set(recipes.map((recipe) => recipe.recipeId)).size !== recipes.length) {
    throw new Error('feature recipe IDs must be unique');
  }
  const availableCapabilities = new Set(
    normalizeStrings(input.availableDataCapabilities, 'data capability'),
  );
  const priorByFingerprint = new Map(
    (input.priorExperiments ?? []).map((experiment) => [
      experiment.featureFingerprint,
      experiment,
    ] as const),
  );

  const candidates: AdaptiveFeatureCandidate[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  if (rejectionReasons.length === 0) {
    for (const recipe of recipes) {
      const windows: readonly (number | null)[] =
        recipe.operation === 'IDENTITY' ? [null] : recipe.windowsMs;
      const inputGroups: readonly (readonly AdaptiveBaseFeature[])[] =
        recipe.arity === 1
          ? baseFeatures.map((feature) => [feature])
          : baseFeatures.flatMap((left, leftIndex) =>
              baseFeatures
                .slice(leftIndex + 1)
                .map((right) => [left, right] as const),
            );
      for (const featureInputs of inputGroups) {
        if (featureInputs.some((feature) => feature.targetDerived)) continue;
        for (const windowMs of windows) {
          const inputFeatureNames = featureInputs.map((feature) => feature.featureName).sort();
          const requiredDataCapabilities = normalizeStrings(
            featureInputs.flatMap((feature) => feature.requiredDataCapabilities),
            'data capability',
          );
          const totalLookbackMs =
            Math.max(...featureInputs.map((feature) => feature.maximumSourceLookbackMs)) +
            (windowMs ?? 0);
          const identity = {
            datasetFingerprint,
            codeCommit,
            configurationHash,
            recipeId: recipe.recipeId,
            operation: recipe.operation,
            inputFeatureNames,
            windowMs,
            requiredDataCapabilities,
            totalLookbackMs,
            complexityUnits: recipe.complexityUnits,
          };
          const featureFingerprint = fingerprintResearchValue(identity);
          if (seen.has(featureFingerprint)) {
            duplicateCount += 1;
            continue;
          }
          seen.add(featureFingerprint);
          const blockingReasons: string[] = [];
          if (totalLookbackMs > policy.maximumLookbackMs) {
            blockingReasons.push('LOOKBACK_LIMIT_EXCEEDED');
          }
          if (recipe.complexityUnits > policy.maximumComplexityUnits) {
            blockingReasons.push('COMPLEXITY_LIMIT_EXCEEDED');
          }
          for (const capability of requiredDataCapabilities) {
            if (!availableCapabilities.has(capability)) {
              blockingReasons.push(`MISSING_DATA_CAPABILITY:${capability}`);
            }
          }
          const prior = priorByFingerprint.get(featureFingerprint);
          if (
            prior !== undefined &&
            (prior.status !== 'REJECTED' || !policy.allowRetestRejected)
          ) {
            blockingReasons.push(`FEATURE_ALREADY_TESTED:${prior.status}`);
          }
          candidates.push({
            featureId: `feature-${featureFingerprint.slice(0, 20)}`,
            featureFingerprint,
            recipeId: recipe.recipeId,
            operation: recipe.operation,
            inputFeatureNames,
            role: roleForInputs(featureInputs),
            windowMs,
            totalLookbackMs,
            complexityUnits: recipe.complexityUnits,
            requiredDataCapabilities,
            lineage: inputFeatureNames,
            status: blockingReasons.length === 0 ? 'READY_FOR_ABLATION' : 'BLOCKED',
            blockingReasons: [...new Set(blockingReasons)],
            discoveryOnly: true,
            holdoutAccessed: false,
            strategyPromotionAllowed: false,
            liveExecutionAllowed: false,
          });
        }
      }
    }
  }
  candidates.sort((left, right) =>
    left.featureFingerprint.localeCompare(right.featureFingerprint),
  );
  if (candidates.length > policy.maximumCandidates) {
    rejectionReasons.push('FEATURE_CANDIDATE_LIMIT_EXCEEDED');
  }
  const visibleCandidates = rejectionReasons.length === 0 ? candidates : [];
  return {
    datasetFingerprint,
    baseFeatureCount: baseFeatures.length,
    recipeCount: recipes.length,
    generatedCount: visibleCandidates.length,
    readyCount: visibleCandidates.filter((candidate) => candidate.status === 'READY_FOR_ABLATION')
      .length,
    blockedCount: visibleCandidates.filter((candidate) => candidate.status === 'BLOCKED')
      .length,
    duplicateCount,
    candidates: visibleCandidates,
    familyFingerprint: fingerprintResearchValue({
      datasetFingerprint,
      codeCommit,
      configurationHash,
      candidateFingerprints: visibleCandidates.map(
        (candidate) => candidate.featureFingerprint,
      ),
    }),
    status: rejectionReasons.length === 0 ? 'GENERATED' : 'REJECTED',
    rejectionReasons,
    holdoutAccessed: false,
    strategyPromotionAllowed: false,
    liveExecutionAllowed: false,
  };
};
