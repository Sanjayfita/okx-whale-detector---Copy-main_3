export interface WalkForwardObservation {
  readonly id: string;
  readonly observedAt: number;
  readonly labelEndAt?: number;
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
  readonly maximumTrainLabelEndAt: number;
  readonly firstTestObservedAt: number;
}

export interface PurgedWalkForwardPlan<T extends WalkForwardObservation> {
  readonly discovery: readonly T[];
  readonly holdout: readonly T[];
  readonly folds: readonly PurgedWalkForwardFold<T>[];
  readonly holdoutBoundaryAt: number;
  readonly holdoutEpisodeCount: number;
  readonly holdoutPurgedObservationCount: number;
  readonly holdoutEmbargoedObservationCount: number;
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
  if (!Number.isSafeInteger(policy.purgeMs) || policy.purgeMs < 0) {
    throw new Error('purgeMs must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(policy.embargoMs) || policy.embargoMs < 0) {
    throw new Error('embargoMs must be a non-negative safe integer');
  }
  if (
    !Number.isFinite(policy.holdoutFraction) ||
    policy.holdoutFraction <= 0 ||
    policy.holdoutFraction >= 0.5
  ) {
    throw new Error('holdoutFraction must be in (0, 0.5)');
  }
};

const labelEndAt = (observation: WalkForwardObservation): number =>
  observation.labelEndAt ?? observation.observedAt;

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
      observation.observedAt < 0 ||
      !Number.isSafeInteger(labelEndAt(observation)) ||
      labelEndAt(observation) < observation.observedAt
    ) {
      throw new Error(`invalid observation interval for ${observation.id}`);
    }
    if (ids.has(observation.id)) {
      throw new Error(`duplicate observation id ${observation.id}`);
    }
    ids.add(observation.id);
  }
};

const selectHoldoutEpisodeIds = <T extends WalkForwardObservation>(
  ordered: readonly T[],
  targetObservationCount: number,
): ReadonlySet<string> => {
  const byEpisode = new Map<
    string,
    { readonly observations: T[]; readonly lastObservedAt: number }
  >();
  for (const observation of ordered) {
    const existing = byEpisode.get(observation.episodeId);
    if (existing === undefined) {
      byEpisode.set(observation.episodeId, {
        observations: [observation],
        lastObservedAt: observation.observedAt,
      });
    } else {
      existing.observations.push(observation);
      byEpisode.set(observation.episodeId, {
        observations: existing.observations,
        lastObservedAt: Math.max(existing.lastObservedAt, observation.observedAt),
      });
    }
  }
  const episodes = [...byEpisode.entries()].sort(
    ([leftId, left], [rightId, right]) =>
      left.lastObservedAt - right.lastObservedAt || leftId.localeCompare(rightId),
  );
  const selected = new Set<string>();
  let selectedObservationCount = 0;
  for (let index = episodes.length - 1; index >= 0; index -= 1) {
    const episode = episodes[index];
    if (episode === undefined) {
      continue;
    }
    selected.add(episode[0]);
    selectedObservationCount += episode[1].observations.length;
    if (selectedObservationCount >= targetObservationCount) {
      break;
    }
  }
  return selected;
};

export const createPurgedWalkForwardPlan = <T extends WalkForwardObservation>(
  input: {
    readonly observations: readonly T[];
    readonly policy: PurgedWalkForwardPolicy;
  },
): PurgedWalkForwardPlan<T> => {
  validatePolicy(input.policy);
  validateObservations(input.observations);
  if (input.observations.length < 2) {
    throw new Error('purged walk-forward requires at least two observations');
  }

  const ordered = input.observations
    .slice()
    .sort(
      (left, right) =>
        left.observedAt - right.observedAt || left.id.localeCompare(right.id),
    );
  const targetHoldoutCount = Math.max(
    1,
    Math.floor(ordered.length * input.policy.holdoutFraction),
  );
  const holdoutEpisodeIds = selectHoldoutEpisodeIds(
    ordered,
    targetHoldoutCount,
  );
  const holdout = ordered.filter((observation) =>
    holdoutEpisodeIds.has(observation.episodeId),
  );
  const rawDiscovery = ordered.filter(
    (observation) => !holdoutEpisodeIds.has(observation.episodeId),
  );
  const holdoutBoundaryAt = Math.min(
    ...holdout.map((observation) => observation.observedAt),
  );
  const embargoCutoff = holdoutBoundaryAt - input.policy.embargoMs;
  const embargoSafeDiscovery = rawDiscovery.filter(
    (observation) => observation.observedAt <= embargoCutoff,
  );
  const holdoutEmbargoedObservationCount =
    rawDiscovery.length - embargoSafeDiscovery.length;
  const purgeCutoff = holdoutBoundaryAt - input.policy.purgeMs;
  const discovery = embargoSafeDiscovery.filter(
    (observation) => labelEndAt(observation) <= purgeCutoff,
  );
  const holdoutPurgedObservationCount =
    embargoSafeDiscovery.length - discovery.length;
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
    if (rawTrain.length === 0 || rawTest.length === 0) {
      continue;
    }

    const maximumTrainLabelEndAt = Math.max(
      ...rawTrain.map((observation) => labelEndAt(observation)),
    );
    const test = rawTest.filter(
      (observation) =>
        observation.observedAt >=
        maximumTrainLabelEndAt + input.policy.embargoMs,
    );
    const embargoedObservationCount = rawTest.length - test.length;
    const firstTest = test[0];
    if (firstTest === undefined) {
      continue;
    }

    const trainPurgeCutoff = firstTest.observedAt - input.policy.purgeMs;
    const timePurgedTrain = rawTrain.filter(
      (observation) => labelEndAt(observation) <= trainPurgeCutoff,
    );
    const purgedObservationCount = rawTrain.length - timePurgedTrain.length;
    const testEpisodes = new Set(test.map((observation) => observation.episodeId));
    const train = timePurgedTrain.filter(
      (observation) => !testEpisodes.has(observation.episodeId),
    );
    const overlappingEpisodeCount = timePurgedTrain.length - train.length;

    if (train.length === 0) {
      continue;
    }

    folds.push({
      fold: folds.length + 1,
      train,
      test,
      purgedObservationCount,
      embargoedObservationCount,
      overlappingEpisodeCount,
      maximumTrainLabelEndAt,
      firstTestObservedAt: firstTest.observedAt,
    });
  }

  return {
    discovery,
    holdout,
    folds,
    holdoutBoundaryAt,
    holdoutEpisodeCount: holdoutEpisodeIds.size,
    holdoutPurgedObservationCount,
    holdoutEmbargoedObservationCount,
  };
};
