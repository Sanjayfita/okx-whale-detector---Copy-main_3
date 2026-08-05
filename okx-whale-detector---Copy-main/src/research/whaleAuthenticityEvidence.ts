export const WHALE_AUTHENTICITY_EVENT_SCHEMA_VERSION = 1 as const;
export const WHALE_AUTHENTICITY_OUTCOME_SCHEMA_VERSION = 1 as const;

export type WhaleAuthenticityOutcomeClassification =
  | 'LIKELY_EXECUTED'
  | 'POSSIBLE_CANCELLATION'
  | 'UNCONFIRMED_DISAPPEARANCE';

export interface WhaleAuthenticityEventObservation {
  readonly schemaVersion: typeof WHALE_AUTHENTICITY_EVENT_SCHEMA_VERSION;
  readonly evaluationId: string;
  readonly alertId: string;
  readonly instrumentId: string;
  readonly wallId: string;
  readonly detectedAt: number;
  readonly availabilityTimestamp: number;
  readonly side: 'BID' | 'ASK';
  readonly whalePrice: number;
  readonly referencePrice: number;
  readonly whaleNotionalQuote: number;
  readonly wallPersistenceMs: number;
  readonly refillCount: number;
  readonly lifecycleUpdateCount: number;
  readonly increaseCount: number;
  readonly decreaseCount: number;
  readonly initialNotionalQuote: number;
  readonly peakNotionalQuote: number;
  readonly minimumNotionalQuote: number;
  readonly matchingAggressiveNotionalQuote: number;
  readonly executionRatio: number;
  readonly spoofProbability: number | null;
  readonly absorptionScore: number | null;
  readonly liveOrderExecutionAllowed: false;
}

export interface WhaleAuthenticityOutcomeObservation {
  readonly schemaVersion: typeof WHALE_AUTHENTICITY_OUTCOME_SCHEMA_VERSION;
  readonly evaluationId: string;
  readonly alertId: string;
  readonly instrumentId: string;
  readonly wallId: string;
  readonly detectedAt: number;
  readonly observedAt: number;
  readonly classification: WhaleAuthenticityOutcomeClassification;
  readonly finalLifetimeMs: number;
  readonly finalExecutedRatio: number;
  readonly finalMatchingAggressiveNotionalQuote: number;
  readonly liveOrderExecutionAllowed: false;
}

export type WhaleAuthenticityLabel =
  | 'AUTHENTIC_EXECUTION'
  | 'DECEPTIVE_CANCELLATION';

export interface WhaleAuthenticityFeatureVector {
  readonly whaleNotionalLog: number;
  readonly wallPersistenceSeconds: number;
  readonly refillCount: number;
  readonly lifecycleUpdateCount: number;
  readonly increaseCount: number;
  readonly decreaseCount: number;
  readonly increaseRatePerMinute: number;
  readonly decreaseRatePerMinute: number;
  readonly directionalDistanceFromMarketPercent: number;
  readonly absoluteDistanceFromMarketPercent: number;
  readonly notionalChangeFromInitialPercent: number;
  readonly peakDrawdownPercent: number;
  readonly recoveryFromMinimumPercent: number;
  readonly matchingAggressiveNotionalLog: number;
  readonly executionRatio: number;
  readonly spoofProbability: number | null;
  readonly absorptionScore: number | null;
}

export interface WhaleAuthenticityDatasetRow {
  readonly evaluationId: string;
  readonly alertId: string;
  readonly instrumentId: string;
  readonly wallId: string;
  readonly detectedAt: number;
  readonly outcomeObservedAt: number;
  readonly label: WhaleAuthenticityLabel;
  readonly features: WhaleAuthenticityFeatureVector;
  readonly liveOrderExecutionAllowed: false;
}

export interface WhaleAuthenticityDataset {
  readonly evaluationId: string;
  readonly rows: readonly WhaleAuthenticityDatasetRow[];
  readonly inputEventCount: number;
  readonly inputOutcomeCount: number;
  readonly missingOutcomeCount: number;
  readonly unmatchedOutcomeCount: number;
  readonly unconfirmedOutcomeCount: number;
  readonly authenticExecutionCount: number;
  readonly deceptiveCancellationCount: number;
  readonly liveOrderExecutionAllowed: false;
}

const requireNonEmpty = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
};

const requireTimestamp = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
};

const requirePositive = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return value;
};

const requireNonNegative = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return value;
};

const requireNonNegativeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
};

const requireProbabilityOrNull = (
  value: number | null,
  name: string,
): number | null => {
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error(`${name} must be null or between 0 and 1`);
  }
  return value;
};

const recordKey = (input: {
  readonly evaluationId: string;
  readonly alertId: string;
  readonly wallId: string;
}): string => `${input.evaluationId}:${input.alertId}:${input.wallId}`;

export const createWhaleAuthenticityEventObservation = (
  input: Omit<
    WhaleAuthenticityEventObservation,
    'schemaVersion' | 'liveOrderExecutionAllowed'
  >,
): WhaleAuthenticityEventObservation => {
  const detectedAt = requireTimestamp(input.detectedAt, 'detectedAt');
  const availabilityTimestamp = requireTimestamp(
    input.availabilityTimestamp,
    'availabilityTimestamp',
  );
  if (availabilityTimestamp > detectedAt) {
    throw new Error(
      'Whale authenticity event features must be available no later than detectedAt',
    );
  }
  if (input.side !== 'BID' && input.side !== 'ASK') {
    throw new Error('side must be BID or ASK');
  }
  const whaleNotionalQuote = requirePositive(
    input.whaleNotionalQuote,
    'whaleNotionalQuote',
  );
  const initialNotionalQuote = requirePositive(
    input.initialNotionalQuote,
    'initialNotionalQuote',
  );
  const peakNotionalQuote = requirePositive(
    input.peakNotionalQuote,
    'peakNotionalQuote',
  );
  const minimumNotionalQuote = requirePositive(
    input.minimumNotionalQuote,
    'minimumNotionalQuote',
  );
  if (
    peakNotionalQuote < whaleNotionalQuote ||
    peakNotionalQuote < initialNotionalQuote ||
    minimumNotionalQuote > whaleNotionalQuote ||
    minimumNotionalQuote > initialNotionalQuote
  ) {
    throw new Error('Whale lifecycle notional extrema are inconsistent');
  }
  return Object.freeze({
    schemaVersion: WHALE_AUTHENTICITY_EVENT_SCHEMA_VERSION,
    evaluationId: requireNonEmpty(input.evaluationId, 'evaluationId'),
    alertId: requireNonEmpty(input.alertId, 'alertId'),
    instrumentId: requireNonEmpty(input.instrumentId, 'instrumentId'),
    wallId: requireNonEmpty(input.wallId, 'wallId'),
    detectedAt,
    availabilityTimestamp,
    side: input.side,
    whalePrice: requirePositive(input.whalePrice, 'whalePrice'),
    referencePrice: requirePositive(input.referencePrice, 'referencePrice'),
    whaleNotionalQuote,
    wallPersistenceMs: requireNonNegative(
      input.wallPersistenceMs,
      'wallPersistenceMs',
    ),
    refillCount: requireNonNegativeInteger(input.refillCount, 'refillCount'),
    lifecycleUpdateCount: requireNonNegativeInteger(
      input.lifecycleUpdateCount,
      'lifecycleUpdateCount',
    ),
    increaseCount: requireNonNegativeInteger(
      input.increaseCount,
      'increaseCount',
    ),
    decreaseCount: requireNonNegativeInteger(
      input.decreaseCount,
      'decreaseCount',
    ),
    initialNotionalQuote,
    peakNotionalQuote,
    minimumNotionalQuote,
    matchingAggressiveNotionalQuote: requireNonNegative(
      input.matchingAggressiveNotionalQuote,
      'matchingAggressiveNotionalQuote',
    ),
    executionRatio: requireNonNegative(input.executionRatio, 'executionRatio'),
    spoofProbability: requireProbabilityOrNull(
      input.spoofProbability,
      'spoofProbability',
    ),
    absorptionScore: requireProbabilityOrNull(
      input.absorptionScore,
      'absorptionScore',
    ),
    liveOrderExecutionAllowed: false,
  });
};

export const createWhaleAuthenticityOutcomeObservation = (
  input: Omit<
    WhaleAuthenticityOutcomeObservation,
    'schemaVersion' | 'liveOrderExecutionAllowed'
  >,
): WhaleAuthenticityOutcomeObservation => {
  const detectedAt = requireTimestamp(input.detectedAt, 'detectedAt');
  const observedAt = requireTimestamp(input.observedAt, 'observedAt');
  if (observedAt < detectedAt) {
    throw new Error('Whale authenticity outcome cannot precede the event');
  }
  if (
    input.classification !== 'LIKELY_EXECUTED' &&
    input.classification !== 'POSSIBLE_CANCELLATION' &&
    input.classification !== 'UNCONFIRMED_DISAPPEARANCE'
  ) {
    throw new Error('Whale authenticity classification is invalid');
  }
  return Object.freeze({
    schemaVersion: WHALE_AUTHENTICITY_OUTCOME_SCHEMA_VERSION,
    evaluationId: requireNonEmpty(input.evaluationId, 'evaluationId'),
    alertId: requireNonEmpty(input.alertId, 'alertId'),
    instrumentId: requireNonEmpty(input.instrumentId, 'instrumentId'),
    wallId: requireNonEmpty(input.wallId, 'wallId'),
    detectedAt,
    observedAt,
    classification: input.classification,
    finalLifetimeMs: requireNonNegative(
      input.finalLifetimeMs,
      'finalLifetimeMs',
    ),
    finalExecutedRatio: requireNonNegative(
      input.finalExecutedRatio,
      'finalExecutedRatio',
    ),
    finalMatchingAggressiveNotionalQuote: requireNonNegative(
      input.finalMatchingAggressiveNotionalQuote,
      'finalMatchingAggressiveNotionalQuote',
    ),
    liveOrderExecutionAllowed: false,
  });
};

export const extractWhaleAuthenticityFeatures = (
  event: WhaleAuthenticityEventObservation,
): WhaleAuthenticityFeatureVector => {
  const ageMinutes = Math.max(event.wallPersistenceMs / 60_000, 1 / 60);
  const directionalMultiplier = event.side === 'BID' ? 1 : -1;
  const rawDistancePercent =
    ((event.whalePrice - event.referencePrice) / event.referencePrice) * 100;
  return Object.freeze({
    whaleNotionalLog: Math.log1p(event.whaleNotionalQuote),
    wallPersistenceSeconds: event.wallPersistenceMs / 1_000,
    refillCount: event.refillCount,
    lifecycleUpdateCount: event.lifecycleUpdateCount,
    increaseCount: event.increaseCount,
    decreaseCount: event.decreaseCount,
    increaseRatePerMinute: event.increaseCount / ageMinutes,
    decreaseRatePerMinute: event.decreaseCount / ageMinutes,
    directionalDistanceFromMarketPercent:
      rawDistancePercent * directionalMultiplier,
    absoluteDistanceFromMarketPercent: Math.abs(rawDistancePercent),
    notionalChangeFromInitialPercent:
      ((event.whaleNotionalQuote - event.initialNotionalQuote) /
        event.initialNotionalQuote) *
      100,
    peakDrawdownPercent:
      ((event.peakNotionalQuote - event.whaleNotionalQuote) /
        event.peakNotionalQuote) *
      100,
    recoveryFromMinimumPercent:
      ((event.whaleNotionalQuote - event.minimumNotionalQuote) /
        event.minimumNotionalQuote) *
      100,
    matchingAggressiveNotionalLog: Math.log1p(
      event.matchingAggressiveNotionalQuote,
    ),
    executionRatio: event.executionRatio,
    spoofProbability: event.spoofProbability,
    absorptionScore: event.absorptionScore,
  });
};

export const buildWhaleAuthenticityDataset = (input: {
  readonly events: readonly WhaleAuthenticityEventObservation[];
  readonly outcomes: readonly WhaleAuthenticityOutcomeObservation[];
}): WhaleAuthenticityDataset => {
  const evaluationIds = new Set([
    ...input.events.map((event) => event.evaluationId),
    ...input.outcomes.map((outcome) => outcome.evaluationId),
  ]);
  if (evaluationIds.size > 1) {
    throw new Error('Whale authenticity dataset cannot mix evaluations');
  }
  const eventByKey = new Map<string, WhaleAuthenticityEventObservation>();
  for (const event of input.events) {
    const key = recordKey(event);
    if (eventByKey.has(key)) {
      throw new Error(`Duplicate whale authenticity event: ${key}`);
    }
    eventByKey.set(key, event);
  }
  const outcomeByKey = new Map<string, WhaleAuthenticityOutcomeObservation>();
  for (const outcome of input.outcomes) {
    const key = recordKey(outcome);
    if (outcomeByKey.has(key)) {
      throw new Error(`Duplicate whale authenticity outcome: ${key}`);
    }
    outcomeByKey.set(key, outcome);
  }
  const rows: WhaleAuthenticityDatasetRow[] = [];
  let missingOutcomeCount = 0;
  let unconfirmedOutcomeCount = 0;
  for (const event of input.events) {
    const outcome = outcomeByKey.get(recordKey(event));
    if (outcome === undefined) {
      missingOutcomeCount += 1;
      continue;
    }
    if (
      outcome.instrumentId !== event.instrumentId ||
      outcome.detectedAt !== event.detectedAt
    ) {
      throw new Error(
        `Whale authenticity event/outcome identity mismatch: ${event.alertId}`,
      );
    }
    if (outcome.classification === 'UNCONFIRMED_DISAPPEARANCE') {
      unconfirmedOutcomeCount += 1;
      continue;
    }
    rows.push(
      Object.freeze({
        evaluationId: event.evaluationId,
        alertId: event.alertId,
        instrumentId: event.instrumentId,
        wallId: event.wallId,
        detectedAt: event.detectedAt,
        outcomeObservedAt: outcome.observedAt,
        label:
          outcome.classification === 'LIKELY_EXECUTED'
            ? 'AUTHENTIC_EXECUTION'
            : 'DECEPTIVE_CANCELLATION',
        features: extractWhaleAuthenticityFeatures(event),
        liveOrderExecutionAllowed: false,
      }),
    );
  }
  rows.sort(
    (left, right) =>
      left.detectedAt - right.detectedAt ||
      left.instrumentId.localeCompare(right.instrumentId) ||
      left.alertId.localeCompare(right.alertId),
  );
  const matchedOutcomeKeys = new Set(
    input.events.map((event) => recordKey(event)),
  );
  const unmatchedOutcomeCount = input.outcomes.filter(
    (outcome) => !matchedOutcomeKeys.has(recordKey(outcome)),
  ).length;
  const evaluationId = [...evaluationIds][0] ?? '';
  return Object.freeze({
    evaluationId,
    rows: Object.freeze(rows),
    inputEventCount: input.events.length,
    inputOutcomeCount: input.outcomes.length,
    missingOutcomeCount,
    unmatchedOutcomeCount,
    unconfirmedOutcomeCount,
    authenticExecutionCount: rows.filter(
      (row) => row.label === 'AUTHENTIC_EXECUTION',
    ).length,
    deceptiveCancellationCount: rows.filter(
      (row) => row.label === 'DECEPTIVE_CANCELLATION',
    ).length,
    liveOrderExecutionAllowed: false,
  });
};
