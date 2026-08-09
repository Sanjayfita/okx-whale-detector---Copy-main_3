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
  readonly minimumValueAtRiskScenarios?: number;
  readonly requireCompleteScenarioCoverage?: boolean;
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
  minimumValueAtRiskScenarios: 20,
  requireCompleteScenarioCoverage: true,
};

const EPSILON = 1e-12;
const positive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
};
const fraction = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be in (0, 1]`);
  }
};

const validatePolicy = (policy: PortfolioPolicy): void => {
  positive(policy.maximumLeverage, 'maximumLeverage');
  positive(policy.maximumGrossExposureFraction, 'maximumGrossExposureFraction');
  positive(policy.maximumNetExposureFraction, 'maximumNetExposureFraction');
  positive(policy.maximumSectorExposureFraction, 'maximumSectorExposureFraction');
  positive(
    policy.maximumCorrelationGroupExposureFraction,
    'maximumCorrelationGroupExposureFraction',
  );
  fraction(policy.maximumDrawdownFraction, 'maximumDrawdownFraction');
  fraction(policy.valueAtRiskConfidence, 'valueAtRiskConfidence');
  fraction(policy.maximumValueAtRiskFraction, 'maximumValueAtRiskFraction');
  const minimumScenarios = policy.minimumValueAtRiskScenarios ?? 1;
  if (!Number.isSafeInteger(minimumScenarios) || minimumScenarios <= 0) {
    throw new Error('minimumValueAtRiskScenarios must be a positive integer');
  }
};

const aggregatePositions = (
  positions: readonly PortfolioPosition[],
): readonly PortfolioPosition[] => {
  const byInstrument = new Map<string, PortfolioPosition>();
  for (const position of positions) {
    if (
      position.instrumentId.trim().length === 0 ||
      position.sector.trim().length === 0 ||
      position.correlationGroup.trim().length === 0 ||
      !Number.isFinite(position.signedNotional)
    ) {
      throw new Error('portfolio position is invalid');
    }
    const previous = byInstrument.get(position.instrumentId);
    if (
      previous !== undefined &&
      (previous.sector !== position.sector ||
        previous.correlationGroup !== position.correlationGroup)
    ) {
      throw new Error(`inconsistent metadata for ${position.instrumentId}`);
    }
    byInstrument.set(position.instrumentId, {
      ...position,
      signedNotional:
        (previous?.signedNotional ?? 0) + position.signedNotional,
    });
  }
  return [...byInstrument.values()].filter(
    (position) => Math.abs(position.signedNotional) > EPSILON,
  );
};

const combine = (
  existing: readonly PortfolioPosition[],
  allocations: readonly PortfolioAllocation[],
): readonly PortfolioPosition[] =>
  aggregatePositions([
    ...existing,
    ...allocations.map((allocation) => ({
      instrumentId: allocation.instrumentId,
      sector: allocation.sector,
      correlationGroup: allocation.correlationGroup,
      signedNotional: allocation.signedNotional,
    })),
  ]);

const exposures = (positions: readonly PortfolioPosition[]) => ({
  gross: positions.reduce(
    (sum, position) => sum + Math.abs(position.signedNotional),
    0,
  ),
  net: positions.reduce((sum, position) => sum + position.signedNotional, 0),
});

const splitDelta = (existing: number, delta: number) => {
  const opposite =
    existing !== 0 && delta !== 0 && Math.sign(existing) !== Math.sign(delta);
  const reduction = opposite
    ? Math.min(Math.abs(existing), Math.abs(delta))
    : 0;
  return {
    reduction,
    growth: Math.max(0, Math.abs(delta) - reduction),
  };
};

const enforceGroupCap = (input: {
  readonly existing: readonly PortfolioPosition[];
  readonly allocations: readonly PortfolioAllocation[];
  readonly cap: number;
  readonly key: (value: {
    readonly sector: string;
    readonly correlationGroup: string;
  }) => string;
}): readonly PortfolioAllocation[] => {
  const working = new Map(
    aggregatePositions(input.existing).map((position) => [
      position.instrumentId,
      position,
    ]),
  );
  const groupExposure = new Map<string, number>();
  for (const position of working.values()) {
    const key = input.key(position);
    groupExposure.set(
      key,
      (groupExposure.get(key) ?? 0) + Math.abs(position.signedNotional),
    );
  }

  return input.allocations.map((allocation) => {
    const previous = working.get(allocation.instrumentId);
    const existing = previous?.signedNotional ?? 0;
    const key = input.key(allocation);
    const parts = splitDelta(existing, allocation.signedNotional);
    const exposureAfterReduction = Math.max(
      0,
      (groupExposure.get(key) ?? 0) - parts.reduction,
    );
    const allowedGrowth = Math.min(
      parts.growth,
      Math.max(0, input.cap - exposureAfterReduction),
    );
    const acceptedMagnitude = parts.reduction + allowedGrowth;
    const acceptedDelta =
      Math.sign(allocation.signedNotional) * acceptedMagnitude;
    const resulting = existing + acceptedDelta;
    groupExposure.set(
      key,
      exposureAfterReduction + Math.abs(resulting) -
        Math.max(0, Math.abs(existing) - parts.reduction),
    );
    if (Math.abs(resulting) <= EPSILON) {
      working.delete(allocation.instrumentId);
    } else {
      working.set(allocation.instrumentId, {
        instrumentId: allocation.instrumentId,
        sector: allocation.sector,
        correlationGroup: allocation.correlationGroup,
        signedNotional: resulting,
      });
    }
    return { ...allocation, signedNotional: acceptedDelta };
  });
};

const enforceNetCap = (input: {
  readonly currentNet: number;
  readonly allocations: readonly PortfolioAllocation[];
  readonly cap: number;
}): readonly PortfolioAllocation[] => {
  let net = input.currentNet;
  return input.allocations.map((allocation) => {
    const proposed = net + allocation.signedNotional;
    if (Math.abs(proposed) <= input.cap || Math.abs(proposed) < Math.abs(net)) {
      net = proposed;
      return allocation;
    }
    const target = Math.sign(proposed) * input.cap;
    const allowed = target - net;
    const scale = Math.max(
      0,
      Math.min(1, allowed / allocation.signedNotional),
    );
    const accepted = allocation.signedNotional * scale;
    net += accepted;
    return { ...allocation, signedNotional: accepted };
  });
};

interface ValueAtRiskResult {
  readonly value: number;
  readonly validScenarioCount: number;
  readonly complete: boolean;
  readonly nonFinite: boolean;
}

const calculateValueAtRisk = (input: {
  readonly positions: readonly PortfolioPosition[];
  readonly scenarios: readonly PortfolioReturnScenario[];
  readonly confidence: number;
}): ValueAtRiskResult => {
  if (input.positions.length === 0) {
    return {
      value: 0,
      validScenarioCount: input.scenarios.length,
      complete: true,
      nonFinite: false,
    };
  }
  let complete = true;
  let nonFinite = false;
  const losses: number[] = [];
  for (const scenario of input.scenarios) {
    let pnl = 0;
    let valid = true;
    for (const position of input.positions) {
      const value = scenario.returns[position.instrumentId];
      if (value === undefined) {
        complete = false;
        valid = false;
        break;
      }
      if (!Number.isFinite(value)) {
        nonFinite = true;
        valid = false;
        break;
      }
      pnl += position.signedNotional * value;
    }
    if (valid) losses.push(-pnl);
  }
  losses.sort((left, right) => left - right);
  const index = Math.min(
    Math.max(0, losses.length - 1),
    Math.max(0, Math.ceil(input.confidence * losses.length) - 1),
  );
  return {
    value: Math.max(0, losses[index] ?? 0),
    validScenarioCount: losses.length,
    complete,
    nonFinite,
  };
};

const scaleForValueAtRisk = (input: {
  readonly existing: readonly PortfolioPosition[];
  readonly allocations: readonly PortfolioAllocation[];
  readonly scenarios: readonly PortfolioReturnScenario[];
  readonly confidence: number;
  readonly cap: number;
}): readonly PortfolioAllocation[] => {
  const current = calculateValueAtRisk({
    positions: input.existing,
    scenarios: input.scenarios,
    confidence: input.confidence,
  }).value;
  const full = calculateValueAtRisk({
    positions: combine(input.existing, input.allocations),
    scenarios: input.scenarios,
    confidence: input.confidence,
  }).value;
  if (full <= input.cap || full < current) return input.allocations;

  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const scale = (lower + upper) / 2;
    const value = calculateValueAtRisk({
      positions: combine(
        input.existing,
        input.allocations.map((allocation) => ({
          ...allocation,
          signedNotional: allocation.signedNotional * scale,
        })),
      ),
      scenarios: input.scenarios,
      confidence: input.confidence,
    }).value;
    if (value <= input.cap) lower = scale;
    else upper = scale;
  }
  return input.allocations.map((allocation) => ({
    ...allocation,
    signedNotional: allocation.signedNotional * lower,
  }));
};

export const allocatePortfolioCapital = (input: {
  readonly state: PortfolioState;
  readonly candidates: readonly PortfolioCandidate[];
  readonly returnScenarios: readonly PortfolioReturnScenario[];
  readonly policy?: PortfolioPolicy;
}): PortfolioDecision => {
  const policy = input.policy ?? DEFAULT_PORTFOLIO_POLICY;
  validatePolicy(policy);
  positive(input.state.equity, 'equity');
  positive(input.state.peakEquity, 'peakEquity');
  const existing = aggregatePositions(input.state.positions);
  const drawdownFraction = Math.max(
    0,
    (input.state.peakEquity - input.state.equity) / input.state.peakEquity,
  );
  const currentExposure = exposures(existing);
  if (drawdownFraction >= policy.maximumDrawdownFraction) {
    return {
      status: 'REJECTED',
      allocations: [],
      grossExposure: currentExposure.gross,
      netExposure: currentExposure.net,
      leverage: currentExposure.gross / input.state.equity,
      valueAtRisk: 0,
      valueAtRiskFraction: 0,
      drawdownFraction,
      rejectionReasons: ['PORTFOLIO_DRAWDOWN_BREAKER'],
      liveExecutionAllowed: false,
    };
  }

  const existingByInstrument = new Map(
    existing.map((position) => [position.instrumentId, position]),
  );
  const candidateIds = new Set<string>();
  const scored = input.candidates.map((candidate) => {
    if (candidateIds.has(candidate.instrumentId)) {
      throw new Error(`duplicate portfolio candidate for ${candidate.instrumentId}`);
    }
    candidateIds.add(candidate.instrumentId);
    positive(candidate.dailyVolatility, 'candidate.dailyVolatility');
    positive(candidate.maximumNotional, 'candidate.maximumNotional');
    if (
      candidate.instrumentId.trim().length === 0 ||
      candidate.sector.trim().length === 0 ||
      candidate.correlationGroup.trim().length === 0 ||
      !Number.isFinite(candidate.expectedEdge)
    ) {
      throw new Error('portfolio candidate is invalid');
    }
    const previous = existingByInstrument.get(candidate.instrumentId);
    if (
      previous !== undefined &&
      (previous.sector !== candidate.sector ||
        previous.correlationGroup !== candidate.correlationGroup)
    ) {
      throw new Error(`candidate metadata mismatch for ${candidate.instrumentId}`);
    }
    return {
      candidate,
      score: Math.max(0, candidate.expectedEdge) / candidate.dailyVolatility,
    };
  }).filter((item) => item.score > 0).sort(
    (left, right) =>
      right.score - left.score ||
      left.candidate.instrumentId.localeCompare(right.candidate.instrumentId),
  );

  const totalScore = scored.reduce((sum, item) => sum + item.score, 0);
  const grossCap =
    input.state.equity *
    Math.min(policy.maximumLeverage, policy.maximumGrossExposureFraction);
  const totalReduction = scored.reduce((sum, item) => {
    const existingNotional =
      existingByInstrument.get(item.candidate.instrumentId)?.signedNotional ?? 0;
    const deltaSign = item.candidate.direction === 'LONG' ? 1 : -1;
    return sum +
      (existingNotional !== 0 && Math.sign(existingNotional) !== deltaSign
        ? Math.min(Math.abs(existingNotional), item.candidate.maximumNotional)
        : 0);
  }, 0);
  const growthBudget = Math.max(
    0,
    grossCap - Math.max(0, currentExposure.gross - totalReduction),
  );

  let allocations: readonly PortfolioAllocation[] = scored.map((item) => {
    const sign = item.candidate.direction === 'LONG' ? 1 : -1;
    const current =
      existingByInstrument.get(item.candidate.instrumentId)?.signedNotional ?? 0;
    const reduction =
      current !== 0 && Math.sign(current) !== sign
        ? Math.min(Math.abs(current), item.candidate.maximumNotional)
        : 0;
    const growth = Math.min(
      Math.max(0, item.candidate.maximumNotional - reduction),
      totalScore === 0 ? 0 : growthBudget * (item.score / totalScore),
    );
    return {
      instrumentId: item.candidate.instrumentId,
      sector: item.candidate.sector,
      correlationGroup: item.candidate.correlationGroup,
      direction: item.candidate.direction,
      signedNotional: sign * (reduction + growth),
      riskAdjustedScore: item.score,
    };
  });

  allocations = enforceGroupCap({
    existing,
    allocations,
    cap: input.state.equity * policy.maximumSectorExposureFraction,
    key: (value) => value.sector,
  });
  allocations = enforceGroupCap({
    existing,
    allocations,
    cap: input.state.equity * policy.maximumCorrelationGroupExposureFraction,
    key: (value) => value.correlationGroup,
  });
  allocations = enforceNetCap({
    currentNet: currentExposure.net,
    allocations,
    cap: input.state.equity * policy.maximumNetExposureFraction,
  });

  const minimumScenarios = policy.minimumValueAtRiskScenarios ?? 1;
  let valueAtRiskResult = calculateValueAtRisk({
    positions: combine(existing, allocations),
    scenarios: input.returnScenarios,
    confidence: policy.valueAtRiskConfidence,
  });
  const evidenceReasons: string[] = [];
  if (valueAtRiskResult.validScenarioCount < minimumScenarios) {
    evidenceReasons.push('VALUE_AT_RISK_SCENARIOS_INSUFFICIENT');
  }
  if (
    (policy.requireCompleteScenarioCoverage ?? true) &&
    !valueAtRiskResult.complete
  ) {
    evidenceReasons.push('VALUE_AT_RISK_SCENARIO_COVERAGE_INCOMPLETE');
  }
  if (valueAtRiskResult.nonFinite) {
    evidenceReasons.push('VALUE_AT_RISK_SCENARIO_NON_FINITE');
  }

  if (evidenceReasons.length === 0) {
    allocations = scaleForValueAtRisk({
      existing,
      allocations,
      scenarios: input.returnScenarios,
      confidence: policy.valueAtRiskConfidence,
      cap: input.state.equity * policy.maximumValueAtRiskFraction,
    });
    valueAtRiskResult = calculateValueAtRisk({
      positions: combine(existing, allocations),
      scenarios: input.returnScenarios,
      confidence: policy.valueAtRiskConfidence,
    });
  }

  const combined = combine(existing, allocations);
  const finalExposure = exposures(combined);
  const leverage = finalExposure.gross / input.state.equity;
  const valueAtRiskFraction = valueAtRiskResult.value / input.state.equity;
  const nonZeroAllocations = allocations.filter(
    (allocation) => Math.abs(allocation.signedNotional) > EPSILON,
  );
  const rejectionReasons = [...evidenceReasons];
  if (nonZeroAllocations.length === 0) {
    rejectionReasons.push('NO_CAPITAL_AVAILABLE_AFTER_RISK_LIMITS');
  }
  if (leverage > policy.maximumLeverage + EPSILON) {
    rejectionReasons.push('MAXIMUM_LEVERAGE_EXCEEDED');
  }
  if (
    evidenceReasons.length === 0 &&
    valueAtRiskFraction > policy.maximumValueAtRiskFraction + EPSILON
  ) {
    rejectionReasons.push('VALUE_AT_RISK_EXCEEDED');
  }

  return {
    status:
      rejectionReasons.length === 0
        ? 'APPROVED_FOR_PAPER_RESEARCH'
        : 'REJECTED',
    allocations: nonZeroAllocations,
    grossExposure: finalExposure.gross,
    netExposure: finalExposure.net,
    leverage,
    valueAtRisk: valueAtRiskResult.value,
    valueAtRiskFraction,
    drawdownFraction,
    rejectionReasons: [...new Set(rejectionReasons)],
    liveExecutionAllowed: false,
  };
};
