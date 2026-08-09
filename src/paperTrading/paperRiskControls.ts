import type { PaperPortfolioValuation } from './paperPortfolioValuation';

export type PaperRiskStatus = 'ALLOWED' | 'WARNING' | 'BLOCKED';

export interface PaperRiskLimits {
  maxGrossExposure: number;
  maxAbsoluteNetExposure: number;
  maxPositionExposure: number;
  maxDrawdownPercent: number;
  warningThresholdPercent: number;
}

export interface PaperRiskAssessment {
  generatedAt: number;
  status: PaperRiskStatus;
  equity: number;
  drawdownPercent: number;
  largestPositionExposure: number;
  reasons: readonly string[];
}

const assertFiniteNonNegative = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
};

const assertPercent = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be between 0 and 100`);
  }
};

export const assessPaperTradingRisk = (input: {
  valuation: PaperPortfolioValuation;
  initialEquity: number;
  limits: PaperRiskLimits;
}): PaperRiskAssessment => {
  assertFiniteNonNegative('initialEquity', input.initialEquity);
  assertFiniteNonNegative('maxGrossExposure', input.limits.maxGrossExposure);
  assertFiniteNonNegative('maxAbsoluteNetExposure', input.limits.maxAbsoluteNetExposure);
  assertFiniteNonNegative('maxPositionExposure', input.limits.maxPositionExposure);
  assertPercent('maxDrawdownPercent', input.limits.maxDrawdownPercent);
  assertPercent('warningThresholdPercent', input.limits.warningThresholdPercent);

  if (input.initialEquity === 0) {
    throw new Error('initialEquity must be greater than zero');
  }

  const drawdownPercent = Math.max(
    0,
    ((input.initialEquity - input.valuation.equity) / input.initialEquity) * 100,
  );
  const largestPositionExposure = input.valuation.positions.reduce(
    (largest, position) => Math.max(largest, Math.abs(position.marketValue)),
    0,
  );

  const reasons: string[] = [];
  let blocked = false;
  let warning = false;

  const evaluate = (name: string, value: number, limit: number): void => {
    if (value > limit) {
      blocked = true;
      reasons.push(`${name} exceeds limit: ${value} > ${limit}`);
      return;
    }
    const warningLevel = limit * (input.limits.warningThresholdPercent / 100);
    if (limit > 0 && value >= warningLevel) {
      warning = true;
      reasons.push(`${name} is near limit: ${value} / ${limit}`);
    }
  };

  evaluate('Gross exposure', input.valuation.grossExposure, input.limits.maxGrossExposure);
  evaluate(
    'Absolute net exposure',
    Math.abs(input.valuation.netExposure),
    input.limits.maxAbsoluteNetExposure,
  );
  evaluate('Largest position exposure', largestPositionExposure, input.limits.maxPositionExposure);
  evaluate('Drawdown percent', drawdownPercent, input.limits.maxDrawdownPercent);

  if (input.valuation.equity <= 0) {
    blocked = true;
    reasons.push('Paper portfolio equity is non-positive');
  }

  return Object.freeze({
    generatedAt: input.valuation.generatedAt,
    status: blocked ? 'BLOCKED' : warning ? 'WARNING' : 'ALLOWED',
    equity: input.valuation.equity,
    drawdownPercent,
    largestPositionExposure,
    reasons: Object.freeze(reasons),
  });
};
