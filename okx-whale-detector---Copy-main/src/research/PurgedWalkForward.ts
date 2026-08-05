export interface WalkForwardObservation {
  readonly id: string;
  readonly observedAt: number;
  readonly episodeId: string;
}

export interface PurgedWalkForwardPolicy {
  readonly trainSize: number;
  readonly testSize: number;
  readonly stepSize: number;
  readonly purgeMs: number;
  readonly embargoMs: number;
  readonly holdoutFraction: number;
  readonly anchoredTraining: boolean;
}

export interface PurgedWalkForwardFold<T extends WalkForwardObservation> {
  readonly fold: number;
  readonly train: readonly T[];
  readonly test: readonly T[];
  readonly purgedObservationCount: number;
  readonly embargoedObservationCount: number;
  readonly overlappingEpisodeCount: number;
}

export interface PurgedWalkForwardPlan<T extends WalkForwardObservation> {
  readonly discovery: readonly T[];
  readonly holdout: readonly T[];
  readonly folds: readonly PurgedWalkForwardFold<T>[];
}

const requirePositiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
};

const validatePolicy = (policy: PurgedWalkForwardPolicy): void => {
  requirePositiveInteger(policy.trainSize, 'trainSize');
  requirePositiveInteger(policy.testSize, 'testSize');
  requirePositiveInteger(policy.stepSize, 'stepSize');
  if (!Number.isFinite(policy.purgeMs) || policy.purgeMs < 0) {
    throw new Error('purgeMs must be finite and non-negative');
  }
  if (!Number.isFinite(policy.embargoMs) || policy.embargoMs < 0) {
    throw new Error('embargoMs must be finite and non-negative');
  }
  if (
    !Number.isFinite(policy.holdoutFraction) ||
    policy.holdoutFraction <= 0 ||
    policy.holdoutFraction >= 0.5
  ) {
    throw new Error('holdoutFraction must be in (0, 0.5)');
  }
};

const validateObservations = <T extends WalkForwardObservation>(
  observations: readonly T[],
): void => {
  const ids = new Set<string>();
  for (const observation of observations) {
    if (observation.id.trim().length === 0) {
      throw new Error('observation id must not be empty');
    }
    if (observation.episodeId.trim().length === 0) {
      throw new Error('episodeId must not be empty');
    }
    if (
      !Number.isSafeInteger(observation.observedAt) ||
      observation.observedAt < 0
    ) {
      throw new Error(`invalid observedAt for ${observation.id}`);
    }
    if (ids.has(observation.id)) {
      throw new Error(`duplicate observation id ${observation.id}`);
    }
    ids.add(observation.id);
  }
};

export const createPurgedWalkForwardPlan = <T extends WalkForwardObservation>(
  input: {
    readonly observations: readonly T[];
    readonly policy: PurgedWalkForwardPolicy;
  },
): PurgedWalkForwardPlan<T> => {
  validatePolicy(input.policy);
  validateObservations(input.observations);

  const ordered = input.observations
    .slice()
    .sort(
      (left, right) =>
        left.observedAt - right.observedAt || left.id.localeCompare(right.id),
    );
  const holdoutCount = Math.max(
    1,
    Math.floor(ordered.length * input.policy.holdoutFraction),
  );
  const discoveryEnd = Math.max(0, ordered.length - holdoutCount);
  const discovery = ordered.slice(0, discoveryEnd);
  const holdout = ordered.slice(discoveryEnd);
  const folds: PurgedWalkForwardFold<T>[] = [];

  for (
    let rawTestStart = input.policy.trainSize;
    rawTestStart + input.policy.testSize <= discovery.length;
    rawTestStart += input.policy.stepSize
  ) {
    const rawTrainStart = input.policy.anchoredTraining
      ? 0
      : Math.max(0, rawTestStart - input.policy.trainSize);
    const rawTrain = discovery.slice(rawTrainStart, rawTestStart);
    const rawTest = discovery.slice(
      rawTestStart,
      rawTestStart + input.policy.testSize,
    );
    const lastRawTrain = rawTrain.at(-1);
    if (lastRawTrain === undefined) {
      continue;
    }

    const embargoCutoff = lastRawTrain.observedAt + input.policy.embargoMs;
    const test = rawTest.filter(
      (observation) => observation.observedAt >= embargoCutoff,
    );
    const embargoedObservationCount = rawTest.length - test.length;
    const firstTest = test[0];
    if (firstTest === undefined) {
      continue;
    }

    const purgeCutoff = firstTest.observedAt - input.policy.purgeMs;
    const timePurgedTrain = rawTrain.filter(
      (observation) => observation.observedAt <= purgeCutoff,
    );
    const purgedObservationCount = rawTrain.length - timePurgedTrain.length;
    const testEpisodes = new Set(test.map((observation) => observation.episodeId));
    const train = timePurgedTrain.filter(
      (observation) => !testEpisodes.has(observation.episodeId),
    );
    const overlappingEpisodeCount =
      timePurgedTrain.length - train.length;

    if (train.length === 0 || test.length === 0) {
      continue;
    }

    folds.push({
      fold: folds.length + 1,
      train,
      test,
      purgedObservationCount,
      embargoedObservationCount,
      overlappingEpisodeCount,
    });
  }

  return {
    discovery,
    holdout,
    folds,
  };
};
