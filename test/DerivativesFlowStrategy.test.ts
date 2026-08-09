import { describe, expect, it } from 'vitest';

import {
  calculateBasisBps,
  calculateSpreadBps,
  type DerivativeMarketSnapshot,
  validateDerivativeMarketSnapshot,
} from '../src/derivatives/DerivativeMarketSnapshot';
import {
  DEFAULT_DERIVATIVES_FLOW_STRATEGY_POLICY,
  evaluateDerivativesFlowStrategy,
} from '../src/strategy/DerivativesFlowStrategy';

const bullishSnapshot = (
  override: Partial<DerivativeMarketSnapshot> = {},
): DerivativeMarketSnapshot => ({
  instrumentId: 'BTC-USDT-SWAP',
  observedAt: 1_700_000_000_000,
  markPrice: 100,
  indexPrice: 100,
  bestBid: 99.99,
  bestAsk: 100.01,
  atrPercent: 1,
  trendEfficiency: 0.6,
  trendAlignment: 0.7,
  volumeRatio: 1.5,
  priceChangePercent: 0.3,
  openInterestChangePercent: 0.2,
  aggressiveDeltaNormalized: 0.4,
  cvdSlopeNormalized: 0.3,
  orderBookImbalance: 0.2,
  liquidationImbalance: 0.2,
  fundingRatePercent: 0.01,
  vwapDeviationAtr: 0.5,
  marketStructure: 'BULLISH_SWEEP_RECLAIM',
  whaleDirectionalBias: 0.5,
  whaleAuthenticity: 0.8,
  ...override,
});

describe('DerivativeMarketSnapshot', () => {
  it('validates synchronized derivatives-native inputs', () => {
    const snapshot = bullishSnapshot();

    expect(() => validateDerivativeMarketSnapshot(snapshot)).not.toThrow();
    expect(calculateSpreadBps(snapshot)).toBeCloseTo(2, 8);
    expect(calculateBasisBps(snapshot)).toBe(0);
  });

  it('rejects crossed books and partial whale evidence', () => {
    expect(() =>
      validateDerivativeMarketSnapshot(
        bullishSnapshot({ bestBid: 100.02, bestAsk: 100.01 }),
      ),
    ).toThrow('bestAsk must be greater than bestBid');
    expect(() =>
      validateDerivativeMarketSnapshot(
        bullishSnapshot({ whaleAuthenticity: null }),
      ),
    ).toThrow(
      'whaleDirectionalBias and whaleAuthenticity must both be present or null',
    );
  });
});

describe('DerivativesFlowStrategy', () => {
  it('qualifies a bullish structure only after derivatives-flow confirmation', () => {
    const decision = evaluateDerivativesFlowStrategy({
      snapshot: bullishSnapshot(),
    });

    expect(decision.status).toBe('QUALIFIED_FOR_RESEARCH');
    expect(decision.direction).toBe('LONG');
    expect(decision.weightedScore).toBe(1);
    expect(decision.passedConfirmations).toBe(10);
    expect(decision.tradeManagement).toEqual({
      initialStopAtrMultiple:
        DEFAULT_DERIVATIVES_FLOW_STRATEGY_POLICY.initialStopAtrMultiple,
      trailingStopAtrMultiple:
        DEFAULT_DERIVATIVES_FLOW_STRATEGY_POLICY.trailingStopAtrMultiple,
      partialTakeProfitR:
        DEFAULT_DERIVATIVES_FLOW_STRATEGY_POLICY.partialTakeProfitR,
      minimumRewardRiskRatio:
        DEFAULT_DERIVATIVES_FLOW_STRATEGY_POLICY.minimumRewardRiskRatio,
    });
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('uses symmetric bearish confirmation', () => {
    const decision = evaluateDerivativesFlowStrategy({
      snapshot: bullishSnapshot({
        trendAlignment: -0.7,
        priceChangePercent: -0.3,
        aggressiveDeltaNormalized: -0.4,
        cvdSlopeNormalized: -0.3,
        orderBookImbalance: -0.2,
        liquidationImbalance: -0.2,
        fundingRatePercent: -0.01,
        vwapDeviationAtr: -0.5,
        marketStructure: 'BEARISH_BREAK',
        whaleDirectionalBias: -0.5,
      }),
    });

    expect(decision.status).toBe('QUALIFIED_FOR_RESEARCH');
    expect(decision.direction).toBe('SHORT');
    expect(decision.weightedScore).toBe(1);
  });

  it('rejects range signals to reduce choppy-market overtrading', () => {
    const decision = evaluateDerivativesFlowStrategy({
      snapshot: bullishSnapshot({ marketStructure: 'RANGE' }),
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.direction).toBeNull();
    expect(decision.rejectionReasons).toEqual([
      'RANGE_OR_NO_STRUCTURE_TRIGGER',
    ]);
  });

  it('rejects apparent breakouts without aggressive flow and new positioning', () => {
    const decision = evaluateDerivativesFlowStrategy({
      snapshot: bullishSnapshot({
        aggressiveDeltaNormalized: -0.1,
        cvdSlopeNormalized: 0,
        openInterestChangePercent: -0.2,
      }),
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.rejectionReasons).toContain(
      'AGGRESSIVE_FLOW_NOT_CONFIRMED',
    );
    expect(decision.rejectionReasons).toContain(
      'OPEN_INTEREST_NOT_CONFIRMED',
    );
  });

  it('treats whale evidence as optional unless a frozen policy requires it', () => {
    const withoutWhale = bullishSnapshot({
      whaleDirectionalBias: null,
      whaleAuthenticity: null,
    });

    expect(
      evaluateDerivativesFlowStrategy({ snapshot: withoutWhale }).status,
    ).toBe('QUALIFIED_FOR_RESEARCH');
    expect(
      evaluateDerivativesFlowStrategy({
        snapshot: withoutWhale,
        policy: {
          ...DEFAULT_DERIVATIVES_FLOW_STRATEGY_POLICY,
          requireWhaleAuthenticity: true,
        },
      }).rejectionReasons,
    ).toContain('WHALE_AUTHENTICITY_REQUIRED');
  });

  it('rejects expensive or dislocated market conditions before scoring', () => {
    const decision = evaluateDerivativesFlowStrategy({
      snapshot: bullishSnapshot({
        bestBid: 99.5,
        bestAsk: 100.5,
        markPrice: 101,
        fundingRatePercent: 0.1,
      }),
    });

    expect(decision.status).toBe('REJECTED');
    expect(decision.rejectionReasons).toContain('SPREAD_TOO_WIDE');
    expect(decision.rejectionReasons).toContain(
      'BASIS_DISLOCATION_TOO_LARGE',
    );
    expect(decision.rejectionReasons).toContain('ADVERSE_FUNDING');
  });
});
