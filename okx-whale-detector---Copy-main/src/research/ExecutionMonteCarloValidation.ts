export interface MonteCarloTrade {
  readonly tradeId: string;
  readonly episodeId: string;
  readonly grossPnl: number;
  readonly feeCost: number;
  readonly fundingPnl: number;
  readonly slippageCost: number;
  readonly notional: number;
  readonly latencyMs: number;
}

export interface ExecutionMonteCarloPolicy {
  readonly iterations: number;
  readonly seed: number;
  readonly initialEquity: number;
  readonly ruinEquityFraction: number;
  readonly feeMultiplierRange: readonly [number, number];
  readonly fundingMultiplierRange: readonly [number, number];
  readonly slippageMultiplierRange: readonly [number, number];
  readonly latencyMultiplierRange: readonly [number, number];
  readonly latencyImpactBpsPerSecond: number;
  readonly missedFillProbability: number;
  readonly partialFillFractionRange: readonly [number, number];
  readonly confidenceLevel: number;
}

export const DEFAULT_EXECUTION_MONTE_CARLO_POLICY: ExecutionMonteCarloPolicy = {
  iterations: 5_000,
  seed: 42,
  initialEquity: 10_000,
  ruinEquityFraction: 0.5,
  feeMultiplierRange: [1, 1.5],
  fundingMultiplierRange: [1, 2],
  slippageMultiplierRange: [1, 2],
  latencyMultiplierRange: [1, 2],
  latencyImpactBpsPerSecond: 0.25,
  missedFillProbability: 0.05,
  partialFillFractionRange: [0.5, 1],
  confidenceLevel: 0.95,
};

export interface DistributionSummary {
  readonly p05: number;
  readonly p50: number;
  readonly p95: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly mean: number;
}

export interface ExecutionMonteCarloReport {
  readonly iterations: number;
  readonly tradeCount: number;
  readonly independentEpisodeCount: number;
  readonly endingEquity: DistributionSummary;
  readonly netReturnFraction: DistributionSummary;
  readonly maximumDrawdownFraction: DistributionSummary;
  readonly expectedReturnConfidenceInterval: Readonly<{
    lower: number;
    upper: number;
    level: number;
  }>;
  readonly probabilityOfRuin: number;
  readonly probabilityOfPositiveReturn: number;
  readonly averageMissedFills: number;
  readonly averagePartialFills: number;
  readonly liveExecutionAllowed: false;
}

const requireRange = (
  range: readonly [number, number],
  name: string,
  minimum = 0,
): void => {
  if (
    !Number.isFinite(range[0]) ||
    !Number.isFinite(range[1]) ||
    range[0] < minimum ||
    range[1] < range[0]
  ) {
    throw new Error(`${name} is invalid`);
  }
};

const validatePolicy = (policy: ExecutionMonteCarloPolicy): void => {
  if (!Number.isSafeInteger(policy.iterations) || policy.iterations < 100) {
    throw new Error('iterations must be a safe integer >= 100');
  }
  if (!Number.isSafeInteger(policy.seed)) {
    throw new Error('seed must be a safe integer');
  }
  if (!Number.isFinite(policy.initialEquity) || policy.initialEquity <= 0) {
    throw new Error('initialEquity must be positive');
  }
  if (
    policy.ruinEquityFraction <= 0 ||
    policy.ruinEquityFraction >= 1 ||
    policy.missedFillProbability < 0 ||
    policy.missedFillProbability > 1 ||
    policy.confidenceLevel <= 0.5 ||
    policy.confidenceLevel >= 1
  ) {
    throw new Error('Monte Carlo fractions are invalid');
  }
  requireRange(policy.feeMultiplierRange, 'feeMultiplierRange');
  requireRange(policy.fundingMultiplierRange, 'fundingMultiplierRange');
  requireRange(policy.slippageMultiplierRange, 'slippageMultiplierRange');
  requireRange(policy.latencyMultiplierRange, 'latencyMultiplierRange');
  requireRange(
    policy.partialFillFractionRange,
    'partialFillFractionRange',
  );
  if (policy.partialFillFractionRange[1] > 1) {
    throw new Error('partialFillFractionRange must not exceed 1');
  }
  if (
    !Number.isFinite(policy.latencyImpactBpsPerSecond) ||
    policy.latencyImpactBpsPerSecond < 0
  ) {
    throw new Error('latencyImpactBpsPerSecond must be non-negative');
  }
};

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x9e3779b9;
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};

const sampleRange = (
  random: () => number,
  range: readonly [number, number],
): number => range[0] + random() * (range[1] - range[0]);

const shuffled = <T>(values: readonly T[], random: () => number): T[] => {
  const output = values.slice();
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = output[index];
    const swap = output[swapIndex];
    if (current !== undefined && swap !== undefined) {
      output[index] = swap;
      output[swapIndex] = current;
    }
  }
  return output;
};

const quantile = (values: readonly number[], probability: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
};

const summarize = (values: readonly number[]): DistributionSummary => ({
  p05: quantile(values, 0.05),
  p50: quantile(values, 0.5),
  p95: quantile(values, 0.95),
  minimum: Math.min(...values),
  maximum: Math.max(...values),
  mean: values.reduce((sum, value) => sum + value, 0) / values.length,
});

const validateTrade = (trade: MonteCarloTrade): void => {
  if (trade.tradeId.trim().length === 0 || trade.episodeId.trim().length === 0) {
    throw new Error('tradeId and episodeId must not be empty');
  }
  for (const [name, value] of Object.entries(trade)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`${name} must be finite`);
    }
  }
  if (
    trade.feeCost < 0 ||
    trade.slippageCost < 0 ||
    trade.notional < 0 ||
    trade.latencyMs < 0
  ) {
    throw new Error(`invalid non-negative trade values for ${trade.tradeId}`);
  }
};

export const runExecutionMonteCarlo = (input: {
  readonly trades: readonly MonteCarloTrade[];
  readonly policy?: ExecutionMonteCarloPolicy;
}): ExecutionMonteCarloReport => {
  const policy = input.policy ?? DEFAULT_EXECUTION_MONTE_CARLO_POLICY;
  validatePolicy(policy);
  if (input.trades.length === 0) {
    throw new Error('Monte Carlo validation requires trades');
  }
  for (const trade of input.trades) {
    validateTrade(trade);
  }
  const byEpisode = new Map<string, MonteCarloTrade[]>();
  for (const trade of input.trades) {
    byEpisode.set(trade.episodeId, [...(byEpisode.get(trade.episodeId) ?? []), trade]);
  }
  const episodes = [...byEpisode.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, trades]) => trades);
  const random = createRandom(policy.seed);
  const endingEquities: number[] = [];
  const returns: number[] = [];
  const drawdowns: number[] = [];
  let ruinCount = 0;
  let positiveCount = 0;
  let totalMissedFills = 0;
  let totalPartialFills = 0;

  for (let iteration = 0; iteration < policy.iterations; iteration += 1) {
    const sampledEpisodes = Array.from({ length: episodes.length }, () => {
      const episode = episodes[Math.floor(random() * episodes.length)];
      if (episode === undefined) {
        throw new Error('failed to sample Monte Carlo episode');
      }
      return episode;
    });
    const path = shuffled(sampledEpisodes, random).flat();
    let equity = policy.initialEquity;
    let peakEquity = equity;
    let maximumDrawdown = 0;
    let ruined = false;

    for (const trade of path) {
      if (random() < policy.missedFillProbability) {
        totalMissedFills += 1;
        continue;
      }
      const fillFraction = sampleRange(
        random,
        policy.partialFillFractionRange,
      );
      if (fillFraction < 0.999999) {
        totalPartialFills += 1;
      }
      const feeMultiplier = sampleRange(random, policy.feeMultiplierRange);
      const fundingMultiplier = sampleRange(
        random,
        policy.fundingMultiplierRange,
      );
      const slippageMultiplier = sampleRange(
        random,
        policy.slippageMultiplierRange,
      );
      const latencyMultiplier = sampleRange(
        random,
        policy.latencyMultiplierRange,
      );
      const latencySeconds =
        (trade.latencyMs * latencyMultiplier) / 1_000;
      const latencyCost =
        trade.notional *
        (policy.latencyImpactBpsPerSecond * latencySeconds) /
        10_000;
      const pnl =
        trade.grossPnl * fillFraction -
        trade.feeCost * feeMultiplier * fillFraction +
        trade.fundingPnl * fundingMultiplier * fillFraction -
        trade.slippageCost * slippageMultiplier * fillFraction -
        latencyCost * fillFraction;
      equity += pnl;
      peakEquity = Math.max(peakEquity, equity);
      maximumDrawdown = Math.max(
        maximumDrawdown,
        peakEquity <= 0 ? 1 : (peakEquity - equity) / peakEquity,
      );
      if (equity <= policy.initialEquity * policy.ruinEquityFraction) {
        ruined = true;
      }
    }
    const returnFraction = (equity - policy.initialEquity) / policy.initialEquity;
    endingEquities.push(equity);
    returns.push(returnFraction);
    drawdowns.push(maximumDrawdown);
    if (ruined) {
      ruinCount += 1;
    }
    if (returnFraction > 0) {
      positiveCount += 1;
    }
  }

  const alpha = 1 - policy.confidenceLevel;
  return {
    iterations: policy.iterations,
    tradeCount: input.trades.length,
    independentEpisodeCount: episodes.length,
    endingEquity: summarize(endingEquities),
    netReturnFraction: summarize(returns),
    maximumDrawdownFraction: summarize(drawdowns),
    expectedReturnConfidenceInterval: {
      lower: quantile(returns, alpha / 2),
      upper: quantile(returns, 1 - alpha / 2),
      level: policy.confidenceLevel,
    },
    probabilityOfRuin: ruinCount / policy.iterations,
    probabilityOfPositiveReturn: positiveCount / policy.iterations,
    averageMissedFills: totalMissedFills / policy.iterations,
    averagePartialFills: totalPartialFills / policy.iterations,
    liveExecutionAllowed: false,
  };
};
