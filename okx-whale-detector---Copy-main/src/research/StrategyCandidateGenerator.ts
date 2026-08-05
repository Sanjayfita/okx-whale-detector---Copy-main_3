import { createHash } from 'node:crypto';

export type CandidateParameterValue = number | string | boolean;
export type CandidateParameterSpace = Readonly<
  Record<string, readonly CandidateParameterValue[]>
>;

export type CandidateConstraintOperator =
  | 'EQUAL'
  | 'NOT_EQUAL'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL';

export interface CandidateConstraint {
  readonly leftParameter: string;
  readonly operator: CandidateConstraintOperator;
  readonly rightParameter?: string;
  readonly rightValue?: CandidateParameterValue;
}

export interface StrategyCandidateGeneratorPolicy {
  readonly maximumParameterCount: number;
  readonly maximumValuesPerParameter: number;
  readonly maximumSearchSpaceSize: number;
  readonly maximumCandidates: number;
}

export const DEFAULT_STRATEGY_CANDIDATE_GENERATOR_POLICY: StrategyCandidateGeneratorPolicy = {
  maximumParameterCount: 12,
  maximumValuesPerParameter: 25,
  maximumSearchSpaceSize: 100_000,
  maximumCandidates: 10_000,
};

export interface GeneratedStrategyCandidate {
  readonly candidateId: string;
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly hypothesisFamilyId: string;
  readonly parameters: Readonly<Record<string, CandidateParameterValue>>;
  readonly candidateFingerprint: string;
  readonly discoveryScope: 'PURGED_DISCOVERY';
  readonly holdoutAccessed: false;
  readonly liveExecutionAllowed: false;
}

export interface StrategyCandidateGenerationReport {
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly hypothesisFamilyId: string;
  readonly searchSpaceSize: number;
  readonly constraintRejectedCount: number;
  readonly effectiveHypothesisCount: number;
  readonly candidates: readonly GeneratedStrategyCandidate[];
  readonly familyFingerprint: string;
  readonly status: 'GENERATED' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
  readonly holdoutAccessed: false;
  readonly liveExecutionAllowed: false;
}

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const fingerprint = (value: unknown): string =>
  createHash('sha256').update(stableStringify(value)).digest('hex');

const valueKey = (value: CandidateParameterValue): string =>
  `${typeof value}:${String(value)}`;

const validatePolicy = (policy: StrategyCandidateGeneratorPolicy): void => {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
};

const compare = (
  left: CandidateParameterValue,
  operator: CandidateConstraintOperator,
  right: CandidateParameterValue,
): boolean => {
  switch (operator) {
    case 'EQUAL':
      return left === right;
    case 'NOT_EQUAL':
      return left !== right;
    case 'LESS_THAN':
    case 'LESS_THAN_OR_EQUAL':
    case 'GREATER_THAN':
    case 'GREATER_THAN_OR_EQUAL': {
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new Error(`${operator} constraints require numeric parameters`);
      }
      if (operator === 'LESS_THAN') return left < right;
      if (operator === 'LESS_THAN_OR_EQUAL') return left <= right;
      if (operator === 'GREATER_THAN') return left > right;
      return left >= right;
    }
  }
};

const satisfiesConstraints = (input: {
  readonly parameters: Readonly<Record<string, CandidateParameterValue>>;
  readonly constraints: readonly CandidateConstraint[];
}): boolean =>
  input.constraints.every((constraint) => {
    const left = input.parameters[constraint.leftParameter];
    if (left === undefined) {
      throw new Error(
        `constraint references unknown parameter ${constraint.leftParameter}`,
      );
    }
    const hasRightParameter = constraint.rightParameter !== undefined;
    const hasRightValue = constraint.rightValue !== undefined;
    if (hasRightParameter === hasRightValue) {
      throw new Error(
        'constraint must specify exactly one of rightParameter or rightValue',
      );
    }
    const right = hasRightParameter
      ? input.parameters[constraint.rightParameter ?? '']
      : constraint.rightValue;
    if (right === undefined) {
      throw new Error('constraint right-hand value is unavailable');
    }
    return compare(left, constraint.operator, right);
  });

const enumerate = (
  entries: readonly (readonly [
    string,
    readonly CandidateParameterValue[],
  ])[],
): readonly Readonly<Record<string, CandidateParameterValue>>[] => {
  let candidates: Readonly<Record<string, CandidateParameterValue>>[] = [{}];
  for (const [parameterName, values] of entries) {
    candidates = candidates.flatMap((candidate) =>
      values.map((value) => ({ ...candidate, [parameterName]: value })),
    );
  }
  return candidates;
};

export const generateStrategyCandidates = (input: {
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly hypothesisFamilyId: string;
  readonly datasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly parameterSpace: CandidateParameterSpace;
  readonly constraints?: readonly CandidateConstraint[];
  readonly discoveryScope: 'PURGED_DISCOVERY';
  readonly holdoutAccessed: false;
  readonly policy?: Partial<StrategyCandidateGeneratorPolicy>;
}): StrategyCandidateGenerationReport => {
  const policy: StrategyCandidateGeneratorPolicy = {
    ...DEFAULT_STRATEGY_CANDIDATE_GENERATOR_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  for (const [name, value] of [
    ['strategyId', input.strategyId],
    ['hypothesisFamilyId', input.hypothesisFamilyId],
    ['datasetFingerprint', input.datasetFingerprint],
    ['codeCommit', input.codeCommit],
    ['configurationHash', input.configurationHash],
  ] as const) {
    if (value.trim().length === 0) {
      throw new Error(`${name} must not be empty`);
    }
  }
  if (!Number.isSafeInteger(input.strategyVersion) || input.strategyVersion <= 0) {
    throw new Error('strategyVersion must be a positive safe integer');
  }
  if (input.discoveryScope !== 'PURGED_DISCOVERY' || input.holdoutAccessed !== false) {
    throw new Error('candidate generation is permitted only on purged discovery data');
  }

  const entries = Object.entries(input.parameterSpace).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const rejectionReasons: string[] = [];
  if (entries.length === 0) {
    rejectionReasons.push('EMPTY_PARAMETER_SPACE');
  }
  if (entries.length > policy.maximumParameterCount) {
    rejectionReasons.push('PARAMETER_COUNT_LIMIT_EXCEEDED');
  }
  let searchSpaceSize = 1;
  for (const [parameterName, rawValues] of entries) {
    if (parameterName.trim().length === 0) {
      throw new Error('parameter names must not be empty');
    }
    const values = [...new Map(
      rawValues.map((value) => [valueKey(value), value] as const),
    ).values()];
    if (values.length === 0) {
      rejectionReasons.push(`EMPTY_PARAMETER_DIMENSION:${parameterName}`);
    }
    if (values.length > policy.maximumValuesPerParameter) {
      rejectionReasons.push(`PARAMETER_VALUE_LIMIT_EXCEEDED:${parameterName}`);
    }
    for (const value of values) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(`non-finite candidate value for ${parameterName}`);
      }
      if (typeof value === 'string' && value.trim().length === 0) {
        throw new Error(`empty candidate value for ${parameterName}`);
      }
    }
    searchSpaceSize *= values.length;
    if (!Number.isSafeInteger(searchSpaceSize)) {
      rejectionReasons.push('SEARCH_SPACE_SIZE_NOT_SAFE_INTEGER');
      break;
    }
  }
  if (searchSpaceSize > policy.maximumSearchSpaceSize) {
    rejectionReasons.push('SEARCH_SPACE_LIMIT_EXCEEDED');
  }
  const familyIdentity = {
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    hypothesisFamilyId: input.hypothesisFamilyId,
    datasetFingerprint: input.datasetFingerprint,
    codeCommit: input.codeCommit,
    configurationHash: input.configurationHash,
    parameterSpace: input.parameterSpace,
    constraints: input.constraints ?? [],
  };
  const familyFingerprint = fingerprint(familyIdentity);
  if (rejectionReasons.length > 0) {
    return {
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      hypothesisFamilyId: input.hypothesisFamilyId,
      searchSpaceSize,
      constraintRejectedCount: 0,
      effectiveHypothesisCount: 0,
      candidates: [],
      familyFingerprint,
      status: 'REJECTED',
      rejectionReasons: [...new Set(rejectionReasons)],
      holdoutAccessed: false,
      liveExecutionAllowed: false,
    };
  }

  const normalizedEntries = entries.map(([name, rawValues]) => [
    name,
    [...new Map(
      rawValues.map((value) => [valueKey(value), value] as const),
    ).values()].sort((left, right) => valueKey(left).localeCompare(valueKey(right))),
  ] as const);
  const enumerated = enumerate(normalizedEntries);
  const constraints = input.constraints ?? [];
  const accepted = enumerated.filter((parameters) =>
    satisfiesConstraints({ parameters, constraints }),
  );
  if (accepted.length > policy.maximumCandidates) {
    return {
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      hypothesisFamilyId: input.hypothesisFamilyId,
      searchSpaceSize,
      constraintRejectedCount: enumerated.length - accepted.length,
      effectiveHypothesisCount: accepted.length,
      candidates: [],
      familyFingerprint,
      status: 'REJECTED',
      rejectionReasons: ['CANDIDATE_COUNT_LIMIT_EXCEEDED'],
      holdoutAccessed: false,
      liveExecutionAllowed: false,
    };
  }
  const candidates = accepted.map((parameters, index) => {
    const candidateFingerprint = fingerprint({ familyFingerprint, parameters });
    return {
      candidateId: `${input.strategyId}@${input.strategyVersion}:${String(index + 1).padStart(6, '0')}:${candidateFingerprint.slice(0, 12)}`,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      hypothesisFamilyId: input.hypothesisFamilyId,
      parameters,
      candidateFingerprint,
      discoveryScope: 'PURGED_DISCOVERY' as const,
      holdoutAccessed: false as const,
      liveExecutionAllowed: false as const,
    };
  });
  return {
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    hypothesisFamilyId: input.hypothesisFamilyId,
    searchSpaceSize,
    constraintRejectedCount: enumerated.length - candidates.length,
    effectiveHypothesisCount: candidates.length,
    candidates,
    familyFingerprint,
    status: candidates.length === 0 ? 'REJECTED' : 'GENERATED',
    rejectionReasons: candidates.length === 0 ? ['NO_VALID_CANDIDATES'] : [],
    holdoutAccessed: false,
    liveExecutionAllowed: false,
  };
};
