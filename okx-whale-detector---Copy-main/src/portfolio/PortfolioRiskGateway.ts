import {
  allocatePortfolioCapital,
  DEFAULT_PORTFOLIO_POLICY,
  type PortfolioDecision,
  type PortfolioPolicy,
  type PortfolioReturnScenario,
  type PortfolioState,
} from './PortfolioEngine';

export type PortfolioAllocationMode =
  | 'RISK_PARITY'
  | 'FRACTIONAL_KELLY'
  | 'HYBRID';

export interface StrategyCapitalProposal {
  readonly strategyId: string;
  readonly instrumentId: string;
  readonly sector: string;
  readonly correlationGroup: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly expectedEdge: number;
  readonly dailyVolatility: number;
  readonly winProbability: number;
  readonly payoffRatio: number;
  readonly maximumNotional: number;
}

export interface InstrumentCorrelation {
  readonly leftInstrumentId: string;
  readonly rightInstrumentId: string;
  readonly correlation: number;
}

export interface PortfolioRiskGatewayPolicy {
  readonly allocationMode: PortfolioAllocationMode;
  readonly fractionalKellyMultiplier: number;
  readonly maximumSimultaneousPositions: number;
  readonly maximumAbsolutePairCorrelation: number;
  readonly requireCompleteCorrelationCoverage?: boolean;
  readonly softDrawdownFraction: number;
  readonly hardDrawdownFraction: number;
  readonly minimumDynamicLeverageFraction: number;
  readonly portfolio: PortfolioPolicy;
}

export const DEFAULT_PORTFOLIO_RISK_GATEWAY_POLICY: PortfolioRiskGatewayPolicy = {
  allocationMode: 'HYBRID',
  fractionalKellyMultiplier: 0.25,
  maximumSimultaneousPositions: 5,
  maximumAbsolutePairCorrelation: 0.8,
  requireCompleteCorrelationCoverage: true,
  softDrawdownFraction: 0.05,
  hardDrawdownFraction: 0.1,
  minimumDynamicLeverageFraction: 0.25,
  portfolio: DEFAULT_PORTFOLIO_POLICY,
};

export interface PortfolioProposalDecision {
  readonly strategyId: string;
  readonly instrumentId: string;
  readonly allocationScore: number;
  readonly fractionalKelly: number;
  readonly inverseVolatilityWeight: number;
  readonly status: 'ADMITTED' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
}

export interface PortfolioRiskGatewayDecision {
  readonly status: 'APPROVED_FOR_PAPER_RESEARCH' | 'REJECTED';
  readonly dynamicMaximumLeverage: number;
  readonly proposalDecisions: readonly PortfolioProposalDecision[];
  readonly portfolioDecision: PortfolioDecision;
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

const requireFraction = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be in [0, 1]`);
  }
};

const correlationKey = (left: string, right: string): string =>
  [left, right].sort().join('::');

const fractionalKelly = (proposal: StrategyCapitalProposal): number => {
  requireFraction(proposal.winProbability, 'winProbability');
  if (!Number.isFinite(proposal.payoffRatio) || proposal.payoffRatio <= 0) {
    throw new Error('payoffRatio must be positive and finite');
  }
  const lossProbability = 1 - proposal.winProbability;
  return Math.max(
    0,
    proposal.winProbability - lossProbability / proposal.payoffRatio,
  );
};

const allocationScore = (input: {
  readonly proposal: StrategyCapitalProposal;
  readonly mode: PortfolioAllocationMode;
  readonly fractionalKellyMultiplier: number;
}): Readonly<{
  score: number;
  fractionalKelly: number;
  inverseVolatilityWeight: number;
}> => {
  if (
    input.proposal.strategyId.trim().length === 0 ||
    input.proposal.instrumentId.trim().length === 0 ||
    input.proposal.sector.trim().length === 0 ||
    input.proposal.correlationGroup.trim().length === 0 ||
    !Number.isFinite(input.proposal.expectedEdge) ||
    !Number.isFinite(input.proposal.dailyVolatility) ||
    input.proposal.dailyVolatility <= 0 ||
    !Number.isFinite(input.proposal.maximumNotional) ||
    input.proposal.maximumNotional <= 0
  ) {
    throw new Error('proposal identifiers, edge, volatility, or notional are invalid');
  }
  const kelly = fractionalKelly(input.proposal);
  const inverseVolatilityWeight = 1 / input.proposal.dailyVolatility;
  const edge = Math.max(0, input.proposal.expectedEdge);
  const score =
    input.mode === 'RISK_PARITY'
      ? edge * inverseVolatilityWeight
      : input.mode === 'FRACTIONAL_KELLY'
        ? edge * kelly * input.fractionalKellyMultiplier
        : edge *
          inverseVolatilityWeight *
          kelly *
          input.fractionalKellyMultiplier;
  return { score, fractionalKelly: kelly, inverseVolatilityWeight };
};

const emptyPortfolioDecision = (
  state: PortfolioState,
  reason: string,
): PortfolioDecision => {
  const grossExposure = state.positions.reduce(
    (sum, position) => sum + Math.abs(position.signedNotional),
    0,
  );
  const netExposure = state.positions.reduce(
    (sum, position) => sum + position.signedNotional,
    0,
  );
  return {
    status: 'REJECTED',
    allocations: [],
    grossExposure,
    netExposure,
    leverage: grossExposure / state.equity,
    valueAtRisk: 0,
    valueAtRiskFraction: 0,
    drawdownFraction: (state.peakEquity - state.equity) / state.peakEquity,
    rejectionReasons: [reason],
    liveExecutionAllowed: false,
  };
};

export const evaluatePortfolioProposals = (input: {
  readonly state: PortfolioState;
  readonly proposals: readonly StrategyCapitalProposal[];
  readonly correlations: readonly InstrumentCorrelation[];
  readonly returnScenarios: readonly PortfolioReturnScenario[];
  readonly policy?: PortfolioRiskGatewayPolicy;
}): PortfolioRiskGatewayDecision => {
  const policy = input.policy ?? DEFAULT_PORTFOLIO_RISK_GATEWAY_POLICY;
  requireFraction(policy.fractionalKellyMultiplier, 'fractionalKellyMultiplier');
  requireFraction(
    policy.maximumAbsolutePairCorrelation,
    'maximumAbsolutePairCorrelation',
  );
  requireFraction(policy.softDrawdownFraction, 'softDrawdownFraction');
  requireFraction(policy.hardDrawdownFraction, 'hardDrawdownFraction');
  requireFraction(
    policy.minimumDynamicLeverageFraction,
    'minimumDynamicLeverageFraction',
  );
  if (
    !Number.isFinite(input.state.equity) ||
    input.state.equity <= 0 ||
    !Number.isFinite(input.state.peakEquity) ||
    input.state.peakEquity <= 0
  ) {
    throw new Error('portfolio equity and peak equity must be positive');
  }
  if (
    policy.softDrawdownFraction >= policy.hardDrawdownFraction ||
    !Number.isSafeInteger(policy.maximumSimultaneousPositions) ||
    policy.maximumSimultaneousPositions <= 0
  ) {
    throw new Error('invalid drawdown or simultaneous-position policy');
  }

  const drawdownFraction = Math.max(
    0,
    (input.state.peakEquity - input.state.equity) / input.state.peakEquity,
  );
  if (drawdownFraction >= policy.hardDrawdownFraction) {
    const portfolioDecision = emptyPortfolioDecision(
      input.state,
      'PORTFOLIO_HARD_DRAWDOWN_BREAKER',
    );
    return {
      status: 'REJECTED',
      dynamicMaximumLeverage: 0,
      proposalDecisions: input.proposals.map((proposal) => ({
        strategyId: proposal.strategyId,
        instrumentId: proposal.instrumentId,
        allocationScore: 0,
        fractionalKelly: 0,
        inverseVolatilityWeight: 0,
        status: 'REJECTED',
        rejectionReasons: ['PORTFOLIO_HARD_DRAWDOWN_BREAKER'],
      })),
      portfolioDecision,
      rejectionReasons: ['PORTFOLIO_HARD_DRAWDOWN_BREAKER'],
      liveExecutionAllowed: false,
    };
  }

  const leverageScale =
    drawdownFraction <= policy.softDrawdownFraction
      ? 1
      : Math.max(
          policy.minimumDynamicLeverageFraction,
          1 -
            (drawdownFraction - policy.softDrawdownFraction) /
              (policy.hardDrawdownFraction - policy.softDrawdownFraction),
        );
  const dynamicMaximumLeverage =
    policy.portfolio.maximumLeverage * leverageScale;

  const correlations = new Map<string, number>();
  for (const pair of input.correlations) {
    if (
      pair.leftInstrumentId.trim().length === 0 ||
      pair.rightInstrumentId.trim().length === 0 ||
      pair.leftInstrumentId === pair.rightInstrumentId ||
      !Number.isFinite(pair.correlation) ||
      Math.abs(pair.correlation) > 1
    ) {
      throw new Error('correlation pair is invalid');
    }
    const key = correlationKey(pair.leftInstrumentId, pair.rightInstrumentId);
    const previous = correlations.get(key);
    if (previous !== undefined && Math.abs(previous - pair.correlation) > 1e-12) {
      throw new Error(`conflicting correlation pair ${key}`);
    }
    correlations.set(key, pair.correlation);
  }

  const scored = input.proposals
    .map((proposal) => ({
      proposal,
      ...allocationScore({
        proposal,
        mode: policy.allocationMode,
        fractionalKellyMultiplier: policy.fractionalKellyMultiplier,
      }),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.proposal.instrumentId.localeCompare(right.proposal.instrumentId) ||
        left.proposal.strategyId.localeCompare(right.proposal.strategyId),
    );

  const existingInstrumentIds = new Set(
    input.state.positions.map((position) => position.instrumentId),
  );
  const capacity = Math.max(
    0,
    policy.maximumSimultaneousPositions - existingInstrumentIds.size,
  );
  const admitted: typeof scored = [];
  const admittedNewInstrumentIds = new Set<string>();
  const consideredInstrumentIds = new Set<string>();
  const proposalDecisions: PortfolioProposalDecision[] = [];

  for (const item of scored) {
    const rejectionReasons: string[] = [];
    const instrumentId = item.proposal.instrumentId;
    if (consideredInstrumentIds.has(instrumentId)) {
      rejectionReasons.push('DUPLICATE_INSTRUMENT_PROPOSAL');
    }
    consideredInstrumentIds.add(instrumentId);

    if (item.score <= 0) rejectionReasons.push('NON_POSITIVE_ALLOCATION_SCORE');

    const opensNewPosition = !existingInstrumentIds.has(instrumentId);
    if (
      opensNewPosition &&
      !admittedNewInstrumentIds.has(instrumentId) &&
      admittedNewInstrumentIds.size >= capacity
    ) {
      rejectionReasons.push('MAXIMUM_SIMULTANEOUS_POSITIONS');
    }

    const comparisonIds = [
      ...existingInstrumentIds,
      ...admitted.map((candidate) => candidate.proposal.instrumentId),
    ].filter((comparisonId) => comparisonId !== instrumentId);
    for (const comparisonId of [...new Set(comparisonIds)]) {
      const correlation = correlations.get(
        correlationKey(comparisonId, instrumentId),
      );
      if (
        correlation === undefined &&
        (policy.requireCompleteCorrelationCoverage ?? true)
      ) {
        rejectionReasons.push('CORRELATION_DATA_MISSING');
        continue;
      }
      if (
        correlation !== undefined &&
        Math.abs(correlation) > policy.maximumAbsolutePairCorrelation
      ) {
        rejectionReasons.push('PAIR_CORRELATION_LIMIT');
      }
    }

    if (rejectionReasons.length === 0) {
      admitted.push(item);
      if (opensNewPosition) admittedNewInstrumentIds.add(instrumentId);
    }
    proposalDecisions.push({
      strategyId: item.proposal.strategyId,
      instrumentId,
      allocationScore: item.score,
      fractionalKelly: item.fractionalKelly,
      inverseVolatilityWeight: item.inverseVolatilityWeight,
      status: rejectionReasons.length === 0 ? 'ADMITTED' : 'REJECTED',
      rejectionReasons: [...new Set(rejectionReasons)],
    });
  }

  const portfolioDecision = allocatePortfolioCapital({
    state: input.state,
    candidates: admitted.map((item) => ({
      instrumentId: item.proposal.instrumentId,
      sector: item.proposal.sector,
      correlationGroup: item.proposal.correlationGroup,
      direction: item.proposal.direction,
      expectedEdge: item.score,
      dailyVolatility: item.proposal.dailyVolatility,
      maximumNotional: item.proposal.maximumNotional,
    })),
    returnScenarios: input.returnScenarios,
    policy: {
      ...policy.portfolio,
      maximumLeverage: dynamicMaximumLeverage,
      maximumDrawdownFraction: policy.hardDrawdownFraction,
    },
  });

  const rejectionReasons = [
    ...(admitted.length === 0 ? ['NO_STRATEGY_PROPOSAL_ADMITTED'] : []),
    ...portfolioDecision.rejectionReasons,
  ];
  return {
    status:
      rejectionReasons.length === 0
        ? 'APPROVED_FOR_PAPER_RESEARCH'
        : 'REJECTED',
    dynamicMaximumLeverage,
    proposalDecisions,
    portfolioDecision,
    rejectionReasons: [...new Set(rejectionReasons)],
    liveExecutionAllowed: false,
  };
};
