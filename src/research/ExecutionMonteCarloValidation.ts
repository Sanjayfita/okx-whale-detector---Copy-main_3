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
  readonly positiveFundingReceiptHaircutRange: readonly [number, number];
  readonly slippageMultiplierRange: readonly [number, number];
  readonly latencyMultiplierRange: readonly [number, number];
  readonly systemicShockWeight: number;
  readonly latencyImpactBpsPerSecond: number;
  readonly missedFillProbability: number;
  readonly favorableTradeMissedFillMultiplier: number;
  readonly partialFillFractionRange: readonly [number, number];
  readonly confidenceLevel: number;
  readonly tailConfidenceLevel: number;
  readonly maximumDrawdownThresholdFraction: number;
  readonly minimumIndependentEpisodes: number;
}

export const DEFAULT_EXECUTION_MONTE_CARLO_POLICY: ExecutionMonteCarloPolicy = {
  iterations: 10_000,
  seed: 42,
  initialEquity: 10_000,
  ruinEquityFraction: 0.25,
  feeMultiplierRange: [1, 1.5],
  fundingMultiplierRange: [1, 2],
  positiveFundingReceiptHaircutRange: [0, 0.75],
  slippageMultiplierRange: [1, 3],
  latencyMultiplierRange: [1, 3],
  systemicShockWeight: 0.7,
  latencyImpactBpsPerSecond: 1,
  missedFillProbability: 0.05,
  favorableTradeMissedFillMultiplier: 2,
  partialFillFractionRange: [0.25, 1],
  confidenceLevel: 0.95,
  tailConfidenceLevel: 0.95,
  maximumDrawdownThresholdFraction: 0.2,
  minimumIndependentEpisodes: 30,
};

export interface MonteCarloDistribution {
  readonly minimum: number;
  readonly p05: number;
  readonly p50: number;
  readonly p95: number;
  readonly maximum: number;
  readonly mean: number;
}

export interface ExecutionMonteCarloReport {
  readonly iterations: number;
  readonly tradeCount: number;
  readonly independentEpisodeCount: number;
  readonly endingEquity: MonteCarloDistribution;
  readonly netReturnFraction: MonteCarloDistribution;
  readonly maximumDrawdownFraction: MonteCarloDistribution;
  readonly expectedReturnConfidenceInterval: Readonly<{
    lower: number;
    upper: number;
    level: number;
  }>;
  readonly expectedShortfallReturnFraction: number;
  readonly tailConfidenceLevel: number;
  readonly probabilityOfRuin: number;
  readonly probabilityOfPositiveReturn: number;
  readonly probabilityDrawdownExceedsThreshold: number;
  readonly maximumDrawdownThresholdFraction: number;
  readonly averageMissedFills: number;
  readonly averageFavorableMissedFills: number;
  readonly averageUnfavorableMissedFills: number;
  readonly averagePartialFills: number;
  readonly averageFillFraction: number;
  readonly averageSystemicCostMultiplier: number;
  readonly liveExecutionAllowed: false;
}

interface Episode {
  readonly episodeId: string;
  readonly trades: readonly MonteCarloTrade[];
}

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
  range: readonly [number, number],
  random: () => number,
): number => range[0] + (range[1] - range[0]) * random();

const validateRange = (
  range: readonly [number, number],
  name: string,
  minimum: number,
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
  if (
    !Number.isSafeInteger(policy.iterations) ||
    policy.iterations <= 0 ||
    !Number.isSafeInteger(policy.seed) ||
    !Number.isSafeInteger(policy.minimumIndependentEpisodes) ||
    policy.minimumIndependentEpisodes <= 0
  ) {
    throw new Error('invalid Monte Carlo integer policy');
  }
  if (
    !Number.isFinite(policy.initialEquity) ||
    policy.initialEquity <= 0 ||
    policy.ruinEquityFraction <= 0 ||
    policy.ruinEquityFraction >= 1 ||
    policy.systemicShockWeight < 0 ||
    policy.systemicShockWeight > 1 ||
    policy.missedFillProbability < 0 ||
    policy.missedFillProbability > 1 ||
    policy.favorableTradeMissedFillMultiplier < 1 ||
    policy.confidenceLevel <= 0.5 ||
    policy.confidenceLevel >= 1 ||
    policy.tailConfidenceLevel <= 0.5 ||
    policy.tailConfidenceLevel >= 1 ||
    policy.maximumDrawdownThresholdFraction <= 0 ||
    policy.maximumDrawdownThresholdFraction >= 1 ||
    policy.latencyImpactBpsPerSecond < 0
  ) {
    throw new Error('invalid Monte Carlo threshold policy');
  }
  validateRange(policy.feeMultiplierRange, 'feeMultiplierRange', 0);
  validateRange(policy.fundingMultiplierRange, 'fundingMultiplierRange', 0);
  validateRange(
    policy.positiveFundingReceiptHaircutRange,
    'positiveFundingReceiptHaircutRange',
    0,
  );
  if (policy.positiveFundingReceiptHaircutRange[1] > 1) {
    throw new Error('positive funding receipt haircut cannot exceed one');
  }
  validateRange(policy.slippageMultiplierRange, 'slippageMultiplierRange', 0);
  validateRange(policy.latencyMultiplierRange, 'latencyMultiplierRange', 0);
  validateRange(policy.partialFillFractionRange, 'partialFillFractionRange', 0);
  if (policy.partialFillFractionRange[1] > 1) {
    throw new Error('partial fill fraction cannot exceed one');
  }
};

const groupEpisodes = (trades: readonly MonteCarloTrade[]): readonly Episode[] => {
  const tradeIds = new Set<string>();
  const byEpisode = new Map<string, MonteCarloTrade[]>();
  for (const trade of trades) {
    if (trade.tradeId.trim().length === 0 || trade.episodeId.trim().length === 0) {
      throw new Error('tradeId and episodeId must not be empty');
    }
    if (tradeIds.has(trade.tradeId)) {
      throw new Error(`duplicate Monte Carlo trade ${trade.tradeId}`);
    }
    tradeIds.add(trade.tradeId);
    for (const [name, value] of Object.entries(trade)) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(`non-finite Monte Carlo ${name}`);
      }
    }
    if (
      trade.feeCost < 0 ||
      trade.slippageCost < 0 ||
      trade.notional <= 0 ||
      trade.latencyMs < 0
    ) {
      throw new Error(`invalid Monte Carlo trade ${trade.tradeId}`);
    }
    byEpisode.set(trade.episodeId, [
      ...(byEpisode.get(trade.episodeId) ?? []),
      trade,
    ]);
  }
  return [...byEpisode.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([episodeId, episodeTrades]) => ({
      episodeId,
      trades: episodeTrades,
    }));
};

const quantile = (values: readonly number[], probability: number): number => {
  const sorted = values.slice().sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
};

const distribution = (values: readonly number[]): MonteCarloDistribution => ({
  minimum: Math.min(...values),
  p05: quantile(values, 0.05),
  p50: quantile(values, 0.5),
  p95: quantile(values, 0.95),
  maximum: Math.max(...values),
  mean: values.reduce((sum, value) => sum + value, 0) / values.length,
});

const combinedMultiplier = (input: {
  readonly systemic: number;
  readonly idiosyncratic: number;
  readonly systemicWeight: number;
}): number =>
  input.systemic * input.systemicWeight +
  input.idiosyncratic * (1 - input.systemicWeight);

export const runExecutionMonteCarlo = (input: {
  readonly trades: readonly MonteCarloTrade[];
  readonly policy?: Partial<ExecutionMonteCarloPolicy>;
}): ExecutionMonteCarloReport => {
  const policy: ExecutionMonteCarloPolicy = {
    ...DEFAULT_EXECUTION_MONTE_CARLO_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  const episodes = groupEpisodes(input.trades);
  if (episodes.length < policy.minimumIndependentEpisodes) {
    throw new Error(
      `Monte Carlo requires at least ${policy.minimumIndependentEpisodes} independent episodes`,
    );
  }
  const random = createRandom(policy.seed);
  const endingEquities: number[] = [];
  const returns: number[] = [];
  const drawdowns: number[] = [];
  let ruinCount = 0;
  let positiveReturnCount = 0;
  let drawdownThresholdCount = 0;
  let totalMissed = 0;
  let totalFavorableMissed = 0;
  let totalUnfavorableMissed = 0;
  let totalPartial = 0;
  let totalFillFraction = 0;
  let attemptedFillCount = 0;
  let totalSystemicMultiplier = 0;

  for (let iteration = 0; iteration < policy.iterations; iteration += 1) {
    let equity = policy.initialEquity;
    let peak = equity;
    let maximumDrawdown = 0;
    let ruined = false;
    const ruinThreshold = policy.initialEquity * policy.ruinEquityFraction;
    const systemicFee = sampleRange(policy.feeMultiplierRange, random);
    const systemicFunding = sampleRange(policy.fundingMultiplierRange, random);
    const systemicSlippage = sampleRange(
      policy.slippageMultiplierRange,
      random,
    );
    const systemicLatency = sampleRange(policy.latencyMultiplierRange, random);
    totalSystemicMultiplier +=
      (systemicFee + systemicFunding + systemicSlippage + systemicLatency) / 4;

    for (let sampleIndex = 0; sampleIndex < episodes.length; sampleIndex += 1) {
      const episode = episodes[Math.floor(random() * episodes.length)];
      if (episode === undefined) {
        continue;
      }
      for (const trade of episode.trades) {
        const favorable = trade.grossPnl > 0;
        const missedProbability = Math.min(
          1,
          policy.missedFillProbability *
            (favorable ? policy.favorableTradeMissedFillMultiplier : 1),
        );
        if (random() < missedProbability) {
          totalMissed += 1;
          if (favorable) {
            totalFavorableMissed += 1;
          } else {
            totalUnfavorableMissed += 1;
          }
          continue;
        }

        const fillFraction = sampleRange(
          policy.partialFillFractionRange,
          random,
        );
        attemptedFillCount += 1;
        totalFillFraction += fillFraction;
        if (fillFraction < 1 - 1e-12) {
          totalPartial += 1;
        }
        const feeMultiplier = combinedMultiplier({
          systemic: systemicFee,
          idiosyncratic: sampleRange(policy.feeMultiplierRange, random),
          systemicWeight: policy.systemicShockWeight,
        });
        const fundingMultiplier = combinedMultiplier({
          systemic: systemicFunding,
          idiosyncratic: sampleRange(policy.fundingMultiplierRange, random),
          systemicWeight: policy.systemicShockWeight,
        });
        const slippageMultiplier = combinedMultiplier({
          systemic: systemicSlippage,
          idiosyncratic: sampleRange(policy.slippageMultiplierRange, random),
          systemicWeight: policy.systemicShockWeight,
        });
        const latencyMultiplier = combinedMultiplier({
          systemic: systemicLatency,
          idiosyncratic: sampleRange(policy.latencyMultiplierRange, random),
          systemicWeight: policy.systemicShockWeight,
        });
        const latencyCost =
          trade.notional *
          ((trade.latencyMs * latencyMultiplier) / 1_000) *
          (policy.latencyImpactBpsPerSecond / 10_000);
        const fundingPnl =
          trade.fundingPnl <= 0
            ? trade.fundingPnl * fundingMultiplier
            : trade.fundingPnl *
              sampleRange(policy.positiveFundingReceiptHaircutRange, random);
        const netPnl =
          (trade.grossPnl -
            trade.feeCost * feeMultiplier -
            trade.slippageCost * slippageMultiplier -
            latencyCost +
            fundingPnl) *
          fillFraction;
        equity += netPnl;
        peak = Math.max(peak, equity);
        maximumDrawdown = Math.max(
          maximumDrawdown,
          peak <= 0 ? 1 : Math.max(0, (peak - equity) / peak),
        );
        if (equity <= ruinThreshold) {
          ruined = true;
        }
      }
    }

    endingEquities.push(equity);
    const netReturn = (equity - policy.initialEquity) / policy.initialEquity;
    returns.push(netReturn);
    drawdowns.push(maximumDrawdown);
    if (ruined) {
      ruinCount += 1;
    }
    if (equity > policy.initialEquity) {
      positiveReturnCount += 1;
    }
    if (maximumDrawdown >= policy.maximumDrawdownThresholdFraction) {
      drawdownThresholdCount += 1;
    }
  }

  const confidenceAlpha = 1 - policy.confidenceLevel;
  const tailCutoff = quantile(returns, 1 - policy.tailConfidenceLevel);
  const tailReturns = returns.filter((value) => value <= tailCutoff);
  return {
    iterations: policy.iterations,
    tradeCount: input.trades.length,
    independentEpisodeCount: episodes.length,
    endingEquity: distribution(endingEquities),
    netReturnFraction: distribution(returns),
    maximumDrawdownFraction: distribution(drawdowns),
    expectedReturnConfidenceInterval: {
      lower: quantile(returns, confidenceAlpha / 2),
      upper: quantile(returns, 1 - confidenceAlpha / 2),
      level: policy.confidenceLevel,
    },
    expectedShortfallReturnFraction:
      tailReturns.reduce((sum, value) => sum + value, 0) / tailReturns.length,
    tailConfidenceLevel: policy.tailConfidenceLevel,
    probabilityOfRuin: ruinCount / policy.iterations,
    probabilityOfPositiveReturn: positiveReturnCount / policy.iterations,
    probabilityDrawdownExceedsThreshold:
      drawdownThresholdCount / policy.iterations,
    maximumDrawdownThresholdFraction:
      policy.maximumDrawdownThresholdFraction,
    averageMissedFills: totalMissed / policy.iterations,
    averageFavorableMissedFills:
      totalFavorableMissed / policy.iterations,
    averageUnfavorableMissedFills:
      totalUnfavorableMissed / policy.iterations,
    averagePartialFills: totalPartial / policy.iterations,
    averageFillFraction:
      attemptedFillCount === 0 ? 0 : totalFillFraction / attemptedFillCount,
    averageSystemicCostMultiplier:
      totalSystemicMultiplier / policy.iterations,
    liveExecutionAllowed: false,
  };
};
