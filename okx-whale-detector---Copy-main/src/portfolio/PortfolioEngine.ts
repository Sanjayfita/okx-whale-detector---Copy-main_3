export interface PortfolioPosition {
  readonly instrumentId: string;
  readonly sector: string;
  readonly correlationGroup: string;
  readonly signedNotional: number;
}

export interface PortfolioCandidate {
  readonly instrumentId: string;
  readonly sector: string;
  readonly correlationGroup: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly expectedEdge: number;
  readonly dailyVolatility: number;
  readonly maximumNotional: number;
}

export interface PortfolioReturnScenario {
  readonly timestamp: number;
  readonly returns: Readonly<Record<string, number>>;
}

export interface PortfolioState {
  readonly equity: number;
  readonly peakEquity: number;
  readonly positions: readonly PortfolioPosition[];
}

export interface PortfolioPolicy {
  readonly maximumLeverage: number;
  readonly maximumGrossExposureFraction: number;
  readonly maximumNetExposureFraction: number;
  readonly maximumSectorExposureFraction: number;
  readonly maximumCorrelationGroupExposureFraction: number;
  readonly maximumDrawdownFraction: number;
  readonly valueAtRiskConfidence: number;
  readonly maximumValueAtRiskFraction: number;
}

export interface PortfolioAllocation {
  readonly instrumentId: string;
  readonly sector: string;
  readonly correlationGroup: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly signedNotional: number;
  readonly riskAdjustedScore: number;
}

export interface PortfolioDecision {
  readonly status: 'APPROVED_FOR_PAPER_RESEARCH' | 'REJECTED';
  readonly allocations: readonly PortfolioAllocation[];
  readonly grossExposure: number;
  readonly netExposure: number;
  readonly leverage: number;
  readonly valueAtRisk: number;
  readonly valueAtRiskFraction: number;
  readonly drawdownFraction: number;
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

export const DEFAULT_PORTFOLIO_POLICY: PortfolioPolicy = {
  maximumLeverage: 3,
  maximumGrossExposureFraction: 1.5,
  maximumNetExposureFraction: 0.75,
  maximumSectorExposureFraction: 0.5,
  maximumCorrelationGroupExposureFraction: 0.65,
  maximumDrawdownFraction: 0.1,
  valueAtRiskConfidence: 0.99,
  maximumValueAtRiskFraction: 0.025,
};

const requirePositive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
};

const requireFraction = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be in (0, 1]`);
  }
};

const validatePolicy = (policy: PortfolioPolicy): void => {
  requirePositive(policy.maximumLeverage, 'maximumLeverage');
  requirePositive(
    policy.maximumGrossExposureFraction,
    'maximumGrossExposureFraction',
  );
  requirePositive(
    policy.maximumNetExposureFraction,
    'maximumNetExposureFraction',
  );
  requirePositive(
    policy.maximumSectorExposureFraction,
    'maximumSectorExposureFraction',
  );
  requirePositive(
    policy.maximumCorrelationGroupExposureFraction,
    'maximumCorrelationGroupExposureFraction',
  );
  requireFraction(policy.maximumDrawdownFraction, 'maximumDrawdownFraction');
  requireFraction(policy.valueAtRiskConfidence, 'valueAtRiskConfidence');
  requireFraction(
    policy.maximumValueAtRiskFraction,
    'maximumValueAtRiskFraction',
  );
};

const aggregateAbsoluteExposure = (
  positions: readonly PortfolioPosition[],
  selector: (position: PortfolioPosition) => string,
): ReadonlyMap<string, number> => {
  const exposure = new Map<string, number>();
  for (const position of positions) {
    const key = selector(position);
    exposure.set(key, (exposure.get(key) ?? 0) + Math.abs(position.signedNotional));
  }
  return exposure;
};

const calculateHistoricalValueAtRisk = (input: {
  readonly positions: readonly PortfolioPosition[];
  readonly scenarios: readonly PortfolioReturnScenario[];
  readonly confidence: number;
}): number => {
  if (input.scenarios.length === 0 || input.positions.length === 0) {
    return 0;
  }
  const losses = input.scenarios
    .map((scenario) => {
      const pnl = input.positions.reduce(
        (sum, position) =>
          sum +
          position.signedNotional *
            (scenario.returns[position.instrumentId] ?? 0),
        0,
      );
      return -pnl;
    })
    .sort((left, right) => left - right);
  const index = Math.min(
    losses.length - 1,
    Math.max(0, Math.ceil(input.confidence * losses.length) - 1),
  );
  return Math.max(0, losses[index] ?? 0);
};

const scaleAllocations = (
  allocations: readonly PortfolioAllocation[],
  scale: number,
): readonly PortfolioAllocation[] =>
  allocations.map((allocation) => ({
    ...allocation,
    signedNotional: allocation.signedNotional * scale,
  }));

const toPositions = (
  existing: readonly PortfolioPosition[],
  allocations: readonly PortfolioAllocation[],
): readonly PortfolioPosition[] => [
  ...existing,
  ...allocations.map((allocation) => ({
    instrumentId: allocation.instrumentId,
    sector: allocation.sector,
    correlationGroup: allocation.correlationGroup,
    signedNotional: allocation.signedNotional,
  })),
];

const enforceGroupCap = (input: {
  readonly allocations: readonly PortfolioAllocation[];
  readonly existingExposure: ReadonlyMap<string, number>;
  readonly cap: number;
  readonly selector: (allocation: PortfolioAllocation) => string;
}): readonly PortfolioAllocation[] => {
  const grouped = new Map<string, PortfolioAllocation[]>();
  for (const allocation of input.allocations) {
    const key = input.selector(allocation);
    grouped.set(key, [...(grouped.get(key) ?? []), allocation]);
  }
  const output: PortfolioAllocation[] = [];
  for (const [key, group] of grouped) {
    const available = Math.max(0, input.cap - (input.existingExposure.get(key) ?? 0));
    const requested = group.reduce(
      (sum, allocation) => sum + Math.abs(allocation.signedNotional),
      0,
    );
    const scale = requested === 0 ? 0 : Math.min(1, available / requested);
    output.push(...scaleAllocations(group, scale));
  }
  return output;
};

export const allocatePortfolioCapital = (input: {
  readonly state: PortfolioState;
  readonly candidates: readonly PortfolioCandidate[];
  readonly returnScenarios: readonly PortfolioReturnScenario[];
  readonly policy?: PortfolioPolicy;
}): PortfolioDecision => {
  const policy = input.policy ?? DEFAULT_PORTFOLIO_POLICY;
  validatePolicy(policy);
  requirePositive(input.state.equity, 'equity');
  requirePositive(input.state.peakEquity, 'peakEquity');

  const drawdownFraction = Math.max(
    0,
    (input.state.peakEquity - input.state.equity) / input.state.peakEquity,
  );
  if (drawdownFraction >= policy.maximumDrawdownFraction) {
    return {
      status: 'REJECTED',
      allocations: [],
      grossExposure: input.state.positions.reduce(
        (sum, position) => sum + Math.abs(position.signedNotional),
        0,
      ),
      netExposure: input.state.positions.reduce(
        (sum, position) => sum + position.signedNotional,
        0,
      ),
      leverage:
        input.state.positions.reduce(
          (sum, position) => sum + Math.abs(position.signedNotional),
          0,
        ) / input.state.equity,
      valueAtRisk: 0,
      valueAtRiskFraction: 0,
      drawdownFraction,
      rejectionReasons: ['PORTFOLIO_DRAWDOWN_BREAKER'],
      liveExecutionAllowed: false,
    };
  }

  const existingGross = input.state.positions.reduce(
    (sum, position) => sum + Math.abs(position.signedNotional),
    0,
  );
  const grossCap =
    input.state.equity *
    Math.min(policy.maximumLeverage, policy.maximumGrossExposureFraction);
  const availableGross = Math.max(0, grossCap - existingGross);

  const scored = input.candidates
    .map((candidate) => {
      requirePositive(candidate.dailyVolatility, 'candidate.dailyVolatility');
      requirePositive(candidate.maximumNotional, 'candidate.maximumNotional');
      if (!Number.isFinite(candidate.expectedEdge)) {
        throw new Error('candidate.expectedEdge must be finite');
      }
      return {
        candidate,
        score: Math.max(0, candidate.expectedEdge) / candidate.dailyVolatility,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.instrumentId.localeCompare(right.candidate.instrumentId),
    );
  const totalScore = scored.reduce((sum, candidate) => sum + candidate.score, 0);

  let allocations: readonly PortfolioAllocation[] = scored.map(({ candidate, score }) => {
    const unsignedNotional = Math.min(
      candidate.maximumNotional,
      totalScore === 0 ? 0 : availableGross * (score / totalScore),
    );
    return {
      instrumentId: candidate.instrumentId,
      sector: candidate.sector,
      correlationGroup: candidate.correlationGroup,
      direction: candidate.direction,
      signedNotional:
        candidate.direction === 'LONG' ? unsignedNotional : -unsignedNotional,
      riskAdjustedScore: score,
    };
  });

  allocations = enforceGroupCap({
    allocations,
    existingExposure: aggregateAbsoluteExposure(
      input.state.positions,
      (position) => position.sector,
    ),
    cap: input.state.equity * policy.maximumSectorExposureFraction,
    selector: (allocation) => allocation.sector,
  });
  allocations = enforceGroupCap({
    allocations,
    existingExposure: aggregateAbsoluteExposure(
      input.state.positions,
      (position) => position.correlationGroup,
    ),
    cap:
      input.state.equity * policy.maximumCorrelationGroupExposureFraction,
    selector: (allocation) => allocation.correlationGroup,
  });

  const currentNet = input.state.positions.reduce(
    (sum, position) => sum + position.signedNotional,
    0,
  );
  const proposedNet = allocations.reduce(
    (sum, allocation) => sum + allocation.signedNotional,
    currentNet,
  );
  const netCap = input.state.equity * policy.maximumNetExposureFraction;
  if (Math.abs(proposedNet) > netCap) {
    const newNet = proposedNet - currentNet;
    const availableNet = Math.max(0, netCap - Math.abs(currentNet));
    const scale = newNet === 0 ? 1 : Math.min(1, availableNet / Math.abs(newNet));
    allocations = scaleAllocations(allocations, scale);
  }

  let combinedPositions = toPositions(input.state.positions, allocations);
  let valueAtRisk = calculateHistoricalValueAtRisk({
    positions: combinedPositions,
    scenarios: input.returnScenarios,
    confidence: policy.valueAtRiskConfidence,
  });
  const valueAtRiskCap = input.state.equity * policy.maximumValueAtRiskFraction;
  if (valueAtRisk > valueAtRiskCap && valueAtRisk > 0) {
    allocations = scaleAllocations(allocations, valueAtRiskCap / valueAtRisk);
    combinedPositions = toPositions(input.state.positions, allocations);
    valueAtRisk = calculateHistoricalValueAtRisk({
      positions: combinedPositions,
      scenarios: input.returnScenarios,
      confidence: policy.valueAtRiskConfidence,
    });
  }

  const grossExposure = combinedPositions.reduce(
    (sum, position) => sum + Math.abs(position.signedNotional),
    0,
  );
  const netExposure = combinedPositions.reduce(
    (sum, position) => sum + position.signedNotional,
    0,
  );
  const leverage = grossExposure / input.state.equity;
  const valueAtRiskFraction = valueAtRisk / input.state.equity;
  const nonZeroAllocations = allocations.filter(
    (allocation) => Math.abs(allocation.signedNotional) > 1e-12,
  );
  const rejectionReasons: string[] = [];
  if (nonZeroAllocations.length === 0) {
    rejectionReasons.push('NO_CAPITAL_AVAILABLE_AFTER_RISK_LIMITS');
  }
  if (leverage > policy.maximumLeverage + 1e-12) {
    rejectionReasons.push('MAXIMUM_LEVERAGE_EXCEEDED');
  }
  if (valueAtRiskFraction > policy.maximumValueAtRiskFraction + 1e-12) {
    rejectionReasons.push('VALUE_AT_RISK_EXCEEDED');
  }

  return {
    status:
      rejectionReasons.length === 0
        ? 'APPROVED_FOR_PAPER_RESEARCH'
        : 'REJECTED',
    allocations: nonZeroAllocations,
    grossExposure,
    netExposure,
    leverage,
    valueAtRisk,
    valueAtRiskFraction,
    drawdownFraction,
    rejectionReasons,
    liveExecutionAllowed: false,
  };
};
