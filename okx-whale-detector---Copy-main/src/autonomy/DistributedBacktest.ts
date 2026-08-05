import { fingerprintResearchValue } from '../research/ResearchFingerprint';

export interface BacktestCandidateReference {
  readonly candidateId: string;
  readonly candidateFingerprint: string;
}

export interface BacktestScenarioReference {
  readonly scenarioId: string;
  readonly assumptionsFingerprint: string;
}

export interface BacktestObservationReference {
  readonly observationId: string;
  readonly episodeId: string;
  readonly instrumentId: string;
  readonly foldId: string;
  readonly observedAt: number;
}

export interface DistributedBacktestPolicy {
  readonly shardCount: number;
  readonly maximumWorkUnits: number;
  readonly maximumObservationsPerWorkUnit: number;
}

export const DEFAULT_DISTRIBUTED_BACKTEST_POLICY: DistributedBacktestPolicy = {
  shardCount: 16,
  maximumWorkUnits: 100_000,
  maximumObservationsPerWorkUnit: 1_000_000,
};

export interface BacktestWorkUnit {
  readonly workUnitId: string;
  readonly workUnitFingerprint: string;
  readonly candidateId: string;
  readonly candidateFingerprint: string;
  readonly scenarioId: string;
  readonly assumptionsFingerprint: string;
  readonly foldId: string;
  readonly instrumentId: string;
  readonly shardIndex: number;
  readonly shardCount: number;
  readonly observationIds: readonly string[];
  readonly episodeIds: readonly string[];
  readonly datasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly discoveryOnly: true;
  readonly holdoutAccessed: false;
  readonly liveExecutionAllowed: false;
}

export interface DistributedBacktestPlan {
  readonly datasetFingerprint: string;
  readonly candidateCount: number;
  readonly scenarioCount: number;
  readonly observationCount: number;
  readonly workUnitCount: number;
  readonly independentEpisodeCount: number;
  readonly planFingerprint: string;
  readonly workUnits: readonly BacktestWorkUnit[];
  readonly status: 'PLANNED' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
  readonly holdoutAccessed: false;
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

export interface BacktestWorkUnitResult {
  readonly workUnitId: string;
  readonly workUnitFingerprint: string;
  readonly resultFingerprint: string;
  readonly workerId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly observationCount: number;
  readonly independentEpisodeCount: number;
  readonly tradeCount: number;
  readonly netPnl: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly maximumDrawdownFraction: number;
  readonly status: 'COMPLETED' | 'FAILED';
  readonly failureReason: string | null;
  readonly liveExecutionAllowed: false;
}

export interface CandidateScenarioBacktestAggregate {
  readonly candidateId: string;
  readonly scenarioId: string;
  readonly expectedWorkUnitCount: number;
  readonly completedWorkUnitCount: number;
  readonly observationCount: number;
  readonly independentEpisodeCount: number;
  readonly tradeCount: number;
  readonly netPnl: number;
  readonly expectancyPerTrade: number | null;
  readonly profitFactor: number | null;
  readonly maximumDrawdownFraction: number;
  readonly status: 'COMPLETE' | 'INCOMPLETE' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
}

export interface DistributedBacktestAggregationReport {
  readonly planFingerprint: string;
  readonly expectedWorkUnitCount: number;
  readonly receivedResultCount: number;
  readonly completedWorkUnitCount: number;
  readonly failedWorkUnitCount: number;
  readonly missingWorkUnitIds: readonly string[];
  readonly unexpectedWorkUnitIds: readonly string[];
  readonly duplicateWorkUnitIds: readonly string[];
  readonly candidateScenarioResults: readonly CandidateScenarioBacktestAggregate[];
  readonly status: 'COMPLETE' | 'INCOMPLETE' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

const requireText = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
};

const requireTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const validatePolicy = (policy: DistributedBacktestPolicy): void => {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
};

const hashToShard = (value: string, shardCount: number): number => {
  const hash = fingerprintResearchValue(value);
  const prefix = hash.slice(0, 12);
  return Number.parseInt(prefix, 16) % shardCount;
};

const assertUnique = (values: readonly string[], name: string): void => {
  if (new Set(values).size !== values.length) {
    throw new Error(`${name} must be unique`);
  }
};

export const planDistributedBacktests = (input: {
  readonly datasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly candidates: readonly BacktestCandidateReference[];
  readonly scenarios: readonly BacktestScenarioReference[];
  readonly observations: readonly BacktestObservationReference[];
  readonly discoveryOnly: true;
  readonly holdoutAccessed: false;
  readonly policy?: Partial<DistributedBacktestPolicy>;
}): DistributedBacktestPlan => {
  const policy: DistributedBacktestPolicy = {
    ...DEFAULT_DISTRIBUTED_BACKTEST_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  if (input.discoveryOnly !== true || input.holdoutAccessed !== false) {
    throw new Error('distributed backtests are permitted only on discovery data');
  }
  const datasetFingerprint = requireText(input.datasetFingerprint, 'datasetFingerprint');
  const codeCommit = requireText(input.codeCommit, 'codeCommit');
  const configurationHash = requireText(input.configurationHash, 'configurationHash');
  const candidates = input.candidates
    .map((candidate) => ({
      candidateId: requireText(candidate.candidateId, 'candidateId'),
      candidateFingerprint: requireText(
        candidate.candidateFingerprint,
        'candidateFingerprint',
      ),
    }))
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const scenarios = input.scenarios
    .map((scenario) => ({
      scenarioId: requireText(scenario.scenarioId, 'scenarioId'),
      assumptionsFingerprint: requireText(
        scenario.assumptionsFingerprint,
        'assumptionsFingerprint',
      ),
    }))
    .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId));
  const observations = input.observations
    .map((observation) => {
      requireTimestamp(observation.observedAt, 'observedAt');
      return {
        ...observation,
        observationId: requireText(observation.observationId, 'observationId'),
        episodeId: requireText(observation.episodeId, 'episodeId'),
        instrumentId: requireText(observation.instrumentId, 'instrumentId'),
        foldId: requireText(observation.foldId, 'foldId'),
      };
    })
    .sort(
      (left, right) =>
        left.foldId.localeCompare(right.foldId) ||
        left.instrumentId.localeCompare(right.instrumentId) ||
        left.observedAt - right.observedAt ||
        left.observationId.localeCompare(right.observationId),
    );
  assertUnique(candidates.map((candidate) => candidate.candidateId), 'candidate IDs');
  assertUnique(
    candidates.map((candidate) => candidate.candidateFingerprint),
    'candidate fingerprints',
  );
  assertUnique(scenarios.map((scenario) => scenario.scenarioId), 'scenario IDs');
  assertUnique(
    observations.map((observation) => observation.observationId),
    'observation IDs',
  );
  const rejectionReasons: string[] = [];
  if (candidates.length === 0) rejectionReasons.push('NO_CANDIDATES');
  if (scenarios.length === 0) rejectionReasons.push('NO_SCENARIOS');
  if (observations.length === 0) rejectionReasons.push('NO_OBSERVATIONS');

  const grouped = new Map<string, BacktestObservationReference[]>();
  for (const observation of observations) {
    const key = `${observation.foldId}\u0000${observation.instrumentId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), observation]);
  }
  const workUnits: BacktestWorkUnit[] = [];
  if (rejectionReasons.length === 0) {
    for (const candidate of candidates) {
      for (const scenario of scenarios) {
        for (const [groupKey, groupObservations] of [...grouped.entries()].sort()) {
          const [foldId, instrumentId] = groupKey.split('\u0000');
          if (foldId === undefined || instrumentId === undefined) {
            throw new Error('invalid distributed backtest group key');
          }
          for (let shardIndex = 0; shardIndex < policy.shardCount; shardIndex += 1) {
            const shardObservations = groupObservations.filter(
              (observation) =>
                hashToShard(observation.episodeId, policy.shardCount) === shardIndex,
            );
            if (shardObservations.length === 0) continue;
            if (
              shardObservations.length > policy.maximumObservationsPerWorkUnit
            ) {
              rejectionReasons.push('WORK_UNIT_OBSERVATION_LIMIT_EXCEEDED');
              continue;
            }
            const observationIds = shardObservations.map(
              (observation) => observation.observationId,
            );
            const episodeIds = [...new Set(
              shardObservations.map((observation) => observation.episodeId),
            )].sort();
            const identity = {
              datasetFingerprint,
              codeCommit,
              configurationHash,
              candidate,
              scenario,
              foldId,
              instrumentId,
              shardIndex,
              shardCount: policy.shardCount,
              observationIds,
            };
            const workUnitFingerprint = fingerprintResearchValue(identity);
            workUnits.push({
              workUnitId: `backtest-${workUnitFingerprint.slice(0, 24)}`,
              workUnitFingerprint,
              candidateId: candidate.candidateId,
              candidateFingerprint: candidate.candidateFingerprint,
              scenarioId: scenario.scenarioId,
              assumptionsFingerprint: scenario.assumptionsFingerprint,
              foldId,
              instrumentId,
              shardIndex,
              shardCount: policy.shardCount,
              observationIds,
              episodeIds,
              datasetFingerprint,
              codeCommit,
              configurationHash,
              discoveryOnly: true,
              holdoutAccessed: false,
              liveExecutionAllowed: false,
            });
          }
        }
      }
    }
  }
  workUnits.sort((left, right) => left.workUnitId.localeCompare(right.workUnitId));
  assertUnique(workUnits.map((workUnit) => workUnit.workUnitId), 'work unit IDs');
  if (workUnits.length > policy.maximumWorkUnits) {
    rejectionReasons.push('WORK_UNIT_LIMIT_EXCEEDED');
  }
  const visibleWorkUnits = rejectionReasons.length === 0 ? workUnits : [];
  return {
    datasetFingerprint,
    candidateCount: candidates.length,
    scenarioCount: scenarios.length,
    observationCount: observations.length,
    workUnitCount: visibleWorkUnits.length,
    independentEpisodeCount: new Set(
      observations.map((observation) => observation.episodeId),
    ).size,
    planFingerprint: fingerprintResearchValue({
      datasetFingerprint,
      codeCommit,
      configurationHash,
      workUnitFingerprints: visibleWorkUnits.map(
        (workUnit) => workUnit.workUnitFingerprint,
      ),
    }),
    workUnits: visibleWorkUnits,
    status: rejectionReasons.length === 0 ? 'PLANNED' : 'REJECTED',
    rejectionReasons: [...new Set(rejectionReasons)],
    holdoutAccessed: false,
    strategyPromotionAllowed: false,
    liveExecutionAllowed: false,
  };
};

const validateResult = (result: BacktestWorkUnitResult): void => {
  requireText(result.workUnitId, 'workUnitId');
  requireText(result.workUnitFingerprint, 'workUnitFingerprint');
  requireText(result.resultFingerprint, 'resultFingerprint');
  requireText(result.workerId, 'workerId');
  requireTimestamp(result.startedAt, 'startedAt');
  requireTimestamp(result.completedAt, 'completedAt');
  if (result.completedAt < result.startedAt) {
    throw new Error('backtest result completed before it started');
  }
  for (const [name, value] of [
    ['observationCount', result.observationCount],
    ['independentEpisodeCount', result.independentEpisodeCount],
    ['tradeCount', result.tradeCount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }
  for (const [name, value] of [
    ['netPnl', result.netPnl],
    ['grossProfit', result.grossProfit],
    ['grossLoss', result.grossLoss],
    ['maximumDrawdownFraction', result.maximumDrawdownFraction],
  ] as const) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  if (
    result.grossProfit < 0 ||
    result.grossLoss < 0 ||
    result.maximumDrawdownFraction < 0 ||
    result.maximumDrawdownFraction > 1 ||
    result.liveExecutionAllowed !== false
  ) {
    throw new Error('invalid distributed backtest result metrics');
  }
  if ((result.status === 'FAILED') !== (result.failureReason !== null)) {
    throw new Error('failed result must provide exactly one failure reason');
  }
};

export const aggregateDistributedBacktests = (input: {
  readonly plan: DistributedBacktestPlan;
  readonly results: readonly BacktestWorkUnitResult[];
}): DistributedBacktestAggregationReport => {
  if (input.plan.status !== 'PLANNED') {
    return {
      planFingerprint: input.plan.planFingerprint,
      expectedWorkUnitCount: 0,
      receivedResultCount: input.results.length,
      completedWorkUnitCount: 0,
      failedWorkUnitCount: 0,
      missingWorkUnitIds: [],
      unexpectedWorkUnitIds: [],
      duplicateWorkUnitIds: [],
      candidateScenarioResults: [],
      status: 'REJECTED',
      rejectionReasons: ['BACKTEST_PLAN_NOT_PLANNED'],
      strategyPromotionAllowed: false,
      liveExecutionAllowed: false,
    };
  }
  for (const result of input.results) validateResult(result);
  const expectedById = new Map(
    input.plan.workUnits.map((workUnit) => [workUnit.workUnitId, workUnit] as const),
  );
  const resultById = new Map<string, BacktestWorkUnitResult>();
  const duplicateWorkUnitIds: string[] = [];
  const unexpectedWorkUnitIds: string[] = [];
  const invalidFingerprintIds: string[] = [];
  for (const result of input.results) {
    if (resultById.has(result.workUnitId)) {
      duplicateWorkUnitIds.push(result.workUnitId);
      continue;
    }
    const expected = expectedById.get(result.workUnitId);
    if (expected === undefined) {
      unexpectedWorkUnitIds.push(result.workUnitId);
      continue;
    }
    if (expected.workUnitFingerprint !== result.workUnitFingerprint) {
      invalidFingerprintIds.push(result.workUnitId);
      continue;
    }
    resultById.set(result.workUnitId, result);
  }
  const missingWorkUnitIds = input.plan.workUnits
    .filter((workUnit) => !resultById.has(workUnit.workUnitId))
    .map((workUnit) => workUnit.workUnitId);
  const groupMap = new Map<
    string,
    { workUnits: BacktestWorkUnit[]; results: BacktestWorkUnitResult[] }
  >();
  for (const workUnit of input.plan.workUnits) {
    const key = `${workUnit.candidateId}\u0000${workUnit.scenarioId}`;
    const group = groupMap.get(key) ?? { workUnits: [], results: [] };
    group.workUnits.push(workUnit);
    const result = resultById.get(workUnit.workUnitId);
    if (result !== undefined) group.results.push(result);
    groupMap.set(key, group);
  }
  const candidateScenarioResults = [...groupMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]): CandidateScenarioBacktestAggregate => {
      const [candidateId, scenarioId] = key.split('\u0000');
      if (candidateId === undefined || scenarioId === undefined) {
        throw new Error('invalid candidate/scenario group key');
      }
      const rejectionReasons: string[] = [];
      if (group.results.length !== group.workUnits.length) {
        rejectionReasons.push('MISSING_WORK_UNIT_RESULTS');
      }
      if (group.results.some((result) => result.status === 'FAILED')) {
        rejectionReasons.push('FAILED_WORK_UNIT');
      }
      const completed = group.results.filter((result) => result.status === 'COMPLETED');
      const tradeCount = completed.reduce((sum, result) => sum + result.tradeCount, 0);
      const netPnl = completed.reduce((sum, result) => sum + result.netPnl, 0);
      const grossProfit = completed.reduce(
        (sum, result) => sum + result.grossProfit,
        0,
      );
      const grossLoss = completed.reduce((sum, result) => sum + result.grossLoss, 0);
      return {
        candidateId,
        scenarioId,
        expectedWorkUnitCount: group.workUnits.length,
        completedWorkUnitCount: completed.length,
        observationCount: completed.reduce(
          (sum, result) => sum + result.observationCount,
          0,
        ),
        independentEpisodeCount: new Set(
          group.workUnits.flatMap((workUnit) => workUnit.episodeIds),
        ).size,
        tradeCount,
        netPnl,
        expectancyPerTrade: tradeCount === 0 ? null : netPnl / tradeCount,
        profitFactor:
          grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss,
        maximumDrawdownFraction: completed.reduce(
          (maximum, result) => Math.max(maximum, result.maximumDrawdownFraction),
          0,
        ),
        status:
          rejectionReasons.includes('FAILED_WORK_UNIT')
            ? 'REJECTED'
            : rejectionReasons.length > 0
              ? 'INCOMPLETE'
              : 'COMPLETE',
        rejectionReasons,
      };
    });
  const rejectionReasons: string[] = [];
  if (duplicateWorkUnitIds.length > 0) rejectionReasons.push('DUPLICATE_RESULTS');
  if (unexpectedWorkUnitIds.length > 0) rejectionReasons.push('UNEXPECTED_RESULTS');
  if (invalidFingerprintIds.length > 0) rejectionReasons.push('RESULT_FINGERPRINT_MISMATCH');
  if (input.results.some((result) => result.status === 'FAILED')) {
    rejectionReasons.push('FAILED_WORK_UNITS');
  }
  const incomplete = missingWorkUnitIds.length > 0;
  return {
    planFingerprint: input.plan.planFingerprint,
    expectedWorkUnitCount: input.plan.workUnits.length,
    receivedResultCount: input.results.length,
    completedWorkUnitCount: [...resultById.values()].filter(
      (result) => result.status === 'COMPLETED',
    ).length,
    failedWorkUnitCount: [...resultById.values()].filter(
      (result) => result.status === 'FAILED',
    ).length,
    missingWorkUnitIds,
    unexpectedWorkUnitIds: [...new Set(unexpectedWorkUnitIds)].sort(),
    duplicateWorkUnitIds: [...new Set(duplicateWorkUnitIds)].sort(),
    candidateScenarioResults,
    status:
      rejectionReasons.length > 0
        ? 'REJECTED'
        : incomplete
          ? 'INCOMPLETE'
          : 'COMPLETE',
    rejectionReasons: [
      ...new Set([
        ...rejectionReasons,
        ...(incomplete ? ['MISSING_RESULTS'] : []),
      ]),
    ],
    strategyPromotionAllowed: false,
    liveExecutionAllowed: false,
  };
};
