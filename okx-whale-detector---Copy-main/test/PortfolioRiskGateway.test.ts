import { describe, expect, it } from 'vitest';

import {
  evaluatePortfolioProposals,
  type StrategyCapitalProposal,
} from '../src/portfolio/PortfolioRiskGateway';

const proposal = (
  instrumentId: string,
  expectedEdge: number,
): StrategyCapitalProposal => ({
  strategyId: `strategy-${instrumentId}`,
  instrumentId,
  sector: 'CRYPTO_MAJOR',
  correlationGroup: instrumentId.includes('BTC') || instrumentId.includes('ETH')
    ? 'MAJOR'
    : 'ALT',
  direction: 'LONG',
  expectedEdge,
  dailyVolatility: 0.03,
  winProbability: 0.58,
  payoffRatio: 1.5,
  maximumNotional: 5_000,
});

describe('evaluatePortfolioProposals', () => {
  it('applies Kelly/risk-parity scoring before portfolio risk controls', () => {
    const decision = evaluatePortfolioProposals({
      state: { equity: 10_000, peakEquity: 10_000, positions: [] },
      proposals: [
        proposal('BTC-USDT-SWAP', 0.02),
        proposal('ETH-USDT-SWAP', 0.019),
        proposal('SOL-USDT-SWAP', 0.015),
      ],
      correlations: [
        {
          leftInstrumentId: 'BTC-USDT-SWAP',
          rightInstrumentId: 'ETH-USDT-SWAP',
          correlation: 0.95,
        },
      ],
      returnScenarios: [],
      policy: {
        allocationMode: 'HYBRID',
        fractionalKellyMultiplier: 0.25,
        maximumSimultaneousPositions: 2,
        maximumAbsolutePairCorrelation: 0.8,
        softDrawdownFraction: 0.05,
        hardDrawdownFraction: 0.1,
        minimumDynamicLeverageFraction: 0.25,
        portfolio: {
          maximumLeverage: 3,
          maximumGrossExposureFraction: 1.5,
          maximumNetExposureFraction: 0.75,
          maximumSectorExposureFraction: 1,
          maximumCorrelationGroupExposureFraction: 1,
          maximumDrawdownFraction: 0.1,
          valueAtRiskConfidence: 0.99,
          maximumValueAtRiskFraction: 0.025,
        },
      },
    });

    expect(decision.status).toBe('APPROVED_FOR_PAPER_RESEARCH');
    expect(
      decision.proposalDecisions.find(
        (item) => item.instrumentId === 'BTC-USDT-SWAP',
      )?.status,
    ).toBe('ADMITTED');
    expect(
      decision.proposalDecisions.find(
        (item) => item.instrumentId === 'ETH-USDT-SWAP',
      )?.rejectionReasons,
    ).toContain('PAIR_CORRELATION_LIMIT');
    expect(decision.portfolioDecision.allocations).toHaveLength(2);
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('reduces dynamic leverage as drawdown approaches the hard limit', () => {
    const decision = evaluatePortfolioProposals({
      state: { equity: 9_250, peakEquity: 10_000, positions: [] },
      proposals: [proposal('BTC-USDT-SWAP', 0.02)],
      correlations: [],
      returnScenarios: [],
    });

    expect(decision.dynamicMaximumLeverage).toBeLessThan(3);
    expect(decision.dynamicMaximumLeverage).toBeGreaterThan(0);
  });

  it('blocks every strategy at the hard portfolio drawdown breaker', () => {
    const decision = evaluatePortfolioProposals({
      state: { equity: 8_900, peakEquity: 10_000, positions: [] },
      proposals: [proposal('BTC-USDT-SWAP', 0.02)],
      correlations: [],
      returnScenarios: [],
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.dynamicMaximumLeverage).toBe(0);
    expect(decision.rejectionReasons).toEqual([
      'PORTFOLIO_HARD_DRAWDOWN_BREAKER',
    ]);
    expect(decision.portfolioDecision.allocations).toEqual([]);
  });
});
