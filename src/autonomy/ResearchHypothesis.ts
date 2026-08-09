import type {
  CandidateParameterSpace,
  CandidateParameterValue,
} from '../research/StrategyCandidateGenerator';
import { fingerprintResearchValue } from '../research/ResearchFingerprint';

export type AutonomousHypothesisKind =
  | 'STRATEGY_VARIANT'
  | 'FEATURE_INTERACTION'
  | 'REGIME_CONDITION'
  | 'EXECUTION_FILTER';

export interface ResearchHypothesisTemplate {
  readonly templateId: string;
  readonly kind: AutonomousHypothesisKind;
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly researchQuestion: string;
  readonly rationale: string;
  readonly falsificationCriterion: string;
  readonly featureSets: readonly (readonly string[])[];
  readonly parameterSpace: CandidateParameterSpace;
  readonly requiredDataCapabilities: readonly string[];
  readonly complexityUnits: number;
}

export interface AutonomousHypothesisPolicy {
  readonly maximumTemplates: number;
  readonly maximumHypotheses: number;
  readonly maximumFeaturesPerHypothesis: number;
  readonly maximumParameterDimensions: number;
  readonly maximumSearchSpaceSize: number;
  readonly maximumComplexityUnits: number;
}

export const DEFAULT_AUTONOMOUS_HYPOTHESIS_POLICY: AutonomousHypothesisPolicy = {
  maximumTemplates: 100,
  maximumHypotheses: 2_000,
  maximumFeaturesPerHypothesis: 12,
  maximumParameterDimensions: 12,
  maximumSearchSpaceSize: 100_000,
  maximumComplexityUnits: 100,
};

export interface AutonomousResearchHypothesis {
  readonly hypothesisId: string;
  readonly hypothesisFingerprint: string;
  readonly templateId: string;
  readonly kind: AutonomousHypothesisKind;
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly researchQuestion: string;
  readonly rationale: string;
  readonly falsificationCriterion: string;
  readonly featureNames: readonly string[];
  readonly parameterSpace: CandidateParameterSpace;
  readonly requiredDataCapabilities: readonly string[];
  readonly searchSpaceSize: number;
  readonly complexityUnits: number;
  readonly status: 'READY_FOR_DISCOVERY' | 'BLOCKED';
  readonly blockingReasons: readonly string[];
  readonly discoveryOnly: true;
  readonly holdoutAccessed: false;
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

export interface AutonomousHypothesisGenerationReport {
  readonly datasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly templateCount: number;
  readonly generatedCount: number;
  readonly readyCount: number;
  readonly blockedCount: number;
  readonly duplicateCount: number;
  readonly hypotheses: readonly AutonomousResearchHypothesis[];
  readonly status: 'GENERATED' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
  readonly familyFingerprint: string;
  readonly holdoutAccessed: false;
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

const requireText = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return normalized;
};

const valueKey = (value: CandidateParameterValue): string =>
  `${typeof value}:${String(value)}`;

const normalizeParameterSpace = (
  parameterSpace: CandidateParameterSpace,
): CandidateParameterSpace =>
  Object.fromEntries(
    Object.entries(parameterSpace)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, values]) => {
        requireText(name, 'parameter name');
        const normalized = [...new Map(
          values.map((value) => {
            if (typeof value === 'number' && !Number.isFinite(value)) {
              throw new Error(`non-finite hypothesis parameter ${name}`);
            }
            if (typeof value === 'string') {
              requireText(value, `parameter value ${name}`);
            }
            return [valueKey(value), value] as const;
          }),
        ).values()].sort((left, right) => valueKey(left).localeCompare(valueKey(right)));
        return [name, normalized] as const;
      }),
  );

const calculateSearchSpaceSize = (
  parameterSpace: CandidateParameterSpace,
): number => {
  let size = 1;
  for (const values of Object.values(parameterSpace)) {
    size *= values.length;
    if (!Number.isSafeInteger(size)) return Number.MAX_SAFE_INTEGER;
  }
  return size;
};

const normalizeUnique = (values: readonly string[], name: string): readonly string[] =>
  [...new Set(values.map((value) => requireText(value, name)))].sort();

const validatePolicy = (policy: AutonomousHypothesisPolicy): void => {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
};

export const generateAutonomousHypotheses = (input: {
  readonly datasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly templates: readonly ResearchHypothesisTemplate[];
  readonly availableDataCapabilities: readonly string[];
  readonly previouslyTestedFingerprints?: readonly string[];
  readonly policy?: Partial<AutonomousHypothesisPolicy>;
}): AutonomousHypothesisGenerationReport => {
  const policy: AutonomousHypothesisPolicy = {
    ...DEFAULT_AUTONOMOUS_HYPOTHESIS_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  const datasetFingerprint = requireText(
    input.datasetFingerprint,
    'datasetFingerprint',
  );
  const codeCommit = requireText(input.codeCommit, 'codeCommit');
  const configurationHash = requireText(
    input.configurationHash,
    'configurationHash',
  );
  const availableCapabilities = new Set(
    normalizeUnique(input.availableDataCapabilities, 'data capability'),
  );
  const previouslyTested = new Set(input.previouslyTestedFingerprints ?? []);
  const rejectionReasons: string[] = [];
  if (input.templates.length === 0) {
    rejectionReasons.push('NO_HYPOTHESIS_TEMPLATES');
  }
  if (input.templates.length > policy.maximumTemplates) {
    rejectionReasons.push('TEMPLATE_LIMIT_EXCEEDED');
  }
  const potentialCount = input.templates.reduce(
    (sum, template) => sum + template.featureSets.length,
    0,
  );
  if (potentialCount > policy.maximumHypotheses) {
    rejectionReasons.push('HYPOTHESIS_LIMIT_EXCEEDED');
  }

  const generated: AutonomousResearchHypothesis[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  if (rejectionReasons.length === 0) {
    const sortedTemplates = input.templates.slice().sort((left, right) =>
      left.templateId.localeCompare(right.templateId),
    );
    for (const template of sortedTemplates) {
      const templateId = requireText(template.templateId, 'templateId');
      const strategyId = requireText(template.strategyId, 'strategyId');
      const researchQuestion = requireText(
        template.researchQuestion,
        'researchQuestion',
      );
      const rationale = requireText(template.rationale, 'rationale');
      const falsificationCriterion = requireText(
        template.falsificationCriterion,
        'falsificationCriterion',
      );
      if (
        !Number.isSafeInteger(template.strategyVersion) ||
        template.strategyVersion <= 0 ||
        !Number.isSafeInteger(template.complexityUnits) ||
        template.complexityUnits <= 0
      ) {
        throw new Error('hypothesis strategy version and complexity must be positive');
      }
      const parameterSpace = normalizeParameterSpace(template.parameterSpace);
      const requiredCapabilities = normalizeUnique(
        template.requiredDataCapabilities,
        'required data capability',
      );
      const searchSpaceSize = calculateSearchSpaceSize(parameterSpace);
      for (const rawFeatureSet of template.featureSets) {
        const featureNames = normalizeUnique(rawFeatureSet, 'feature name');
        const identity = {
          datasetFingerprint,
          codeCommit,
          configurationHash,
          templateId,
          kind: template.kind,
          strategyId,
          strategyVersion: template.strategyVersion,
          researchQuestion,
          falsificationCriterion,
          featureNames,
          parameterSpace,
          requiredCapabilities,
          complexityUnits: template.complexityUnits,
        };
        const hypothesisFingerprint = fingerprintResearchValue(identity);
        if (seen.has(hypothesisFingerprint)) {
          duplicateCount += 1;
          continue;
        }
        seen.add(hypothesisFingerprint);
        const blockingReasons: string[] = [];
        if (featureNames.length === 0) {
          blockingReasons.push('FEATURE_SET_EMPTY');
        }
        if (featureNames.length > policy.maximumFeaturesPerHypothesis) {
          blockingReasons.push('FEATURE_LIMIT_EXCEEDED');
        }
        if (
          Object.keys(parameterSpace).length > policy.maximumParameterDimensions
        ) {
          blockingReasons.push('PARAMETER_DIMENSION_LIMIT_EXCEEDED');
        }
        if (
          searchSpaceSize <= 0 ||
          searchSpaceSize > policy.maximumSearchSpaceSize
        ) {
          blockingReasons.push('SEARCH_SPACE_LIMIT_EXCEEDED');
        }
        if (template.complexityUnits > policy.maximumComplexityUnits) {
          blockingReasons.push('COMPLEXITY_LIMIT_EXCEEDED');
        }
        for (const capability of requiredCapabilities) {
          if (!availableCapabilities.has(capability)) {
            blockingReasons.push(`MISSING_DATA_CAPABILITY:${capability}`);
          }
        }
        if (previouslyTested.has(hypothesisFingerprint)) {
          blockingReasons.push('HYPOTHESIS_ALREADY_TESTED');
        }
        generated.push({
          hypothesisId: `hyp-${hypothesisFingerprint.slice(0, 20)}`,
          hypothesisFingerprint,
          templateId,
          kind: template.kind,
          strategyId,
          strategyVersion: template.strategyVersion,
          researchQuestion,
          rationale,
          falsificationCriterion,
          featureNames,
          parameterSpace,
          requiredDataCapabilities: requiredCapabilities,
          searchSpaceSize,
          complexityUnits: template.complexityUnits,
          status:
            blockingReasons.length === 0 ? 'READY_FOR_DISCOVERY' : 'BLOCKED',
          blockingReasons: [...new Set(blockingReasons)],
          discoveryOnly: true,
          holdoutAccessed: false,
          strategyPromotionAllowed: false,
          liveExecutionAllowed: false,
        });
      }
    }
  }
  generated.sort((left, right) =>
    left.hypothesisFingerprint.localeCompare(right.hypothesisFingerprint),
  );
  const familyFingerprint = fingerprintResearchValue({
    datasetFingerprint,
    codeCommit,
    configurationHash,
    availableCapabilities: [...availableCapabilities].sort(),
    hypotheses: generated.map((hypothesis) => hypothesis.hypothesisFingerprint),
  });
  return {
    datasetFingerprint,
    codeCommit,
    configurationHash,
    templateCount: input.templates.length,
    generatedCount: generated.length,
    readyCount: generated.filter((hypothesis) => hypothesis.status === 'READY_FOR_DISCOVERY')
      .length,
    blockedCount: generated.filter((hypothesis) => hypothesis.status === 'BLOCKED')
      .length,
    duplicateCount,
    hypotheses: generated,
    status: rejectionReasons.length === 0 ? 'GENERATED' : 'REJECTED',
    rejectionReasons,
    familyFingerprint,
    holdoutAccessed: false,
    strategyPromotionAllowed: false,
    liveExecutionAllowed: false,
  };
};
