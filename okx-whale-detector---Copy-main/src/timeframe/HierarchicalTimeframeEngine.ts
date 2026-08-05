export type TimeframeRole =
  | 'MACRO_TREND'
  | 'DIRECTIONAL_BIAS'
  | 'CONTEXT'
  | 'SETUP'
  | 'ENTRY'
  | 'PRECISION';

export type TimeframeDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface TimeframeDefinition {
  readonly id: string;
  readonly intervalMs: number;
  readonly role: TimeframeRole;
  readonly weight: number;
  readonly required: boolean;
}

export interface TimeframeState {
  readonly timeframeId: string;
  readonly observedAt: number;
  readonly direction: TimeframeDirection;
  readonly confidence: number;
  readonly confirmed: boolean;
  readonly context: readonly string[];
}

export interface HierarchicalTimeframePolicy {
  readonly definitions: readonly TimeframeDefinition[];
  readonly maximumAgeMultiples: number;
  readonly minimumHigherTimeframeConfidence: number;
  readonly minimumEntryConfidence: number;
  readonly requirePrecisionAlignment: boolean;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_HIERARCHICAL_TIMEFRAME_POLICY: HierarchicalTimeframePolicy = {
  definitions: [
    { id: '1D', intervalMs: DAY_MS, role: 'MACRO_TREND', weight: 3, required: true },
    { id: '4H', intervalMs: 4 * HOUR_MS, role: 'DIRECTIONAL_BIAS', weight: 2.5, required: true },
    { id: '1H', intervalMs: HOUR_MS, role: 'CONTEXT', weight: 2, required: true },
    { id: '15M', intervalMs: 15 * 60_000, role: 'SETUP', weight: 1.5, required: true },
    { id: '5M', intervalMs: 5 * 60_000, role: 'ENTRY', weight: 1, required: true },
    { id: '1M', intervalMs: 60_000, role: 'PRECISION', weight: 0.5, required: false },
  ],
  maximumAgeMultiples: 2,
  minimumHigherTimeframeConfidence: 0.55,
  minimumEntryConfidence: 0.6,
  requirePrecisionAlignment: false,
};

export interface HierarchicalTimeframeDecision {
  readonly observedAt: number;
  readonly macroBias: TimeframeDirection;
  readonly setupDirection: TimeframeDirection;
  readonly entryDirection: TimeframeDirection;
  readonly alignmentScore: number;
  readonly entryAllowed: boolean;
  readonly precisionConfirmed: boolean;
  readonly activeContexts: readonly string[];
  readonly rejectionReasons: readonly string[];
  readonly explanations: readonly string[];
  readonly liveExecutionAllowed: false;
}

const directionValue = (direction: TimeframeDirection): number =>
  direction === 'BULLISH' ? 1 : direction === 'BEARISH' ? -1 : 0;

const validatePolicy = (policy: HierarchicalTimeframePolicy): void => {
  if (policy.definitions.length === 0) {
    throw new Error('timeframe definitions must not be empty');
  }
  const ids = new Set<string>();
  const roles = new Set<TimeframeRole>();
  for (const definition of policy.definitions) {
    if (
      definition.id.trim().length === 0 ||
      !Number.isSafeInteger(definition.intervalMs) ||
      definition.intervalMs <= 0 ||
      !Number.isFinite(definition.weight) ||
      definition.weight <= 0
    ) {
      throw new Error('invalid timeframe definition');
    }
    if (ids.has(definition.id) || roles.has(definition.role)) {
      throw new Error('timeframe ids and roles must be unique');
    }
    ids.add(definition.id);
    roles.add(definition.role);
  }
  if (
    !Number.isFinite(policy.maximumAgeMultiples) ||
    policy.maximumAgeMultiples <= 0
  ) {
    throw new Error('maximumAgeMultiples must be positive');
  }
};

const byRole = (
  states: ReadonlyMap<string, TimeframeState>,
  definitions: readonly TimeframeDefinition[],
  role: TimeframeRole,
): TimeframeState | undefined => {
  const definition = definitions.find((candidate) => candidate.role === role);
  return definition === undefined ? undefined : states.get(definition.id);
};

export const evaluateTimeframeHierarchy = (input: {
  readonly asOf: number;
  readonly states: readonly TimeframeState[];
  readonly policy?: HierarchicalTimeframePolicy;
}): HierarchicalTimeframeDecision => {
  const policy = input.policy ?? DEFAULT_HIERARCHICAL_TIMEFRAME_POLICY;
  validatePolicy(policy);
  if (!Number.isSafeInteger(input.asOf) || input.asOf < 0) {
    throw new Error('asOf must be a non-negative safe integer');
  }

  const states = new Map<string, TimeframeState>();
  for (const state of input.states) {
    if (states.has(state.timeframeId)) {
      throw new Error(`duplicate timeframe state ${state.timeframeId}`);
    }
    if (
      !Number.isSafeInteger(state.observedAt) ||
      state.observedAt < 0 ||
      !Number.isFinite(state.confidence) ||
      state.confidence < 0 ||
      state.confidence > 1
    ) {
      throw new Error(`invalid timeframe state ${state.timeframeId}`);
    }
    states.set(state.timeframeId, state);
  }

  const rejectionReasons: string[] = [];
  const explanations: string[] = [];
  for (const definition of policy.definitions) {
    const state = states.get(definition.id);
    if (state === undefined) {
      if (definition.required) {
        rejectionReasons.push(`MISSING_REQUIRED_TIMEFRAME:${definition.id}`);
      }
      continue;
    }
    if (!state.confirmed) {
      rejectionReasons.push(`UNCONFIRMED_TIMEFRAME:${definition.id}`);
    }
    if (
      input.asOf - state.observedAt >
      definition.intervalMs * policy.maximumAgeMultiples
    ) {
      rejectionReasons.push(`STALE_TIMEFRAME:${definition.id}`);
    }
  }

  const higherRoles: readonly TimeframeRole[] = [
    'MACRO_TREND',
    'DIRECTIONAL_BIAS',
    'CONTEXT',
  ];
  let weightedDirection = 0;
  let totalWeight = 0;
  for (const role of higherRoles) {
    const definition = policy.definitions.find((candidate) => candidate.role === role);
    const state = definition === undefined ? undefined : states.get(definition.id);
    if (definition === undefined || state === undefined) {
      continue;
    }
    const effectiveWeight = definition.weight * state.confidence;
    weightedDirection += directionValue(state.direction) * effectiveWeight;
    totalWeight += effectiveWeight;
    explanations.push(
      `${definition.id} ${role} contributed ${state.direction} at confidence ${state.confidence.toFixed(3)}`,
    );
  }
  const normalizedHigherDirection =
    totalWeight === 0 ? 0 : weightedDirection / totalWeight;
  const macroBias: TimeframeDirection =
    normalizedHigherDirection >= policy.minimumHigherTimeframeConfidence
      ? 'BULLISH'
      : normalizedHigherDirection <= -policy.minimumHigherTimeframeConfidence
        ? 'BEARISH'
        : 'NEUTRAL';
  if (macroBias === 'NEUTRAL') {
    rejectionReasons.push('HIGHER_TIMEFRAME_BIAS_UNRESOLVED');
  }

  const setup = byRole(states, policy.definitions, 'SETUP');
  const entry = byRole(states, policy.definitions, 'ENTRY');
  const precision = byRole(states, policy.definitions, 'PRECISION');
  const setupDirection = setup?.direction ?? 'NEUTRAL';
  const entryDirection = entry?.direction ?? 'NEUTRAL';
  const setupAligned = setupDirection === macroBias && macroBias !== 'NEUTRAL';
  const entryAligned =
    entryDirection === macroBias &&
    macroBias !== 'NEUTRAL' &&
    (entry?.confidence ?? 0) >= policy.minimumEntryConfidence;
  const precisionConfirmed =
    precision === undefined
      ? !policy.requirePrecisionAlignment
      : precision.confirmed && precision.direction === macroBias;

  if (!setupAligned) {
    rejectionReasons.push('SETUP_NOT_ALIGNED_WITH_HIGHER_TIMEFRAMES');
  }
  if (!entryAligned) {
    rejectionReasons.push('ENTRY_NOT_ALIGNED_OR_CONFIDENT');
  }
  if (!precisionConfirmed) {
    rejectionReasons.push('PRECISION_TIMEFRAME_NOT_ALIGNED');
  }

  const alignedWeight = policy.definitions.reduce((sum, definition) => {
    const state = states.get(definition.id);
    return state !== undefined && state.direction === macroBias
      ? sum + definition.weight * state.confidence
      : sum;
  }, 0);
  const availableWeight = policy.definitions.reduce((sum, definition) => {
    const state = states.get(definition.id);
    return state === undefined ? sum : sum + definition.weight * state.confidence;
  }, 0);
  const alignmentScore =
    macroBias === 'NEUTRAL' || availableWeight === 0
      ? 0
      : alignedWeight / availableWeight;

  explanations.push(
    `Resolved macro bias ${macroBias} with normalized higher-timeframe direction ${normalizedHigherDirection.toFixed(3)}`,
  );
  explanations.push(
    `Setup ${setupDirection}, entry ${entryDirection}, precision ${precision?.direction ?? 'NOT_CONFIGURED'}, alignment score ${alignmentScore.toFixed(3)}`,
  );

  return {
    observedAt: input.asOf,
    macroBias,
    setupDirection,
    entryDirection,
    alignmentScore,
    entryAllowed: rejectionReasons.length === 0,
    precisionConfirmed,
    activeContexts: input.states.flatMap((state) => state.context),
    rejectionReasons: [...new Set(rejectionReasons)],
    explanations,
    liveExecutionAllowed: false,
  };
};
