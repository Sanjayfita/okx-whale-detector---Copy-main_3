import { describe, expect, it } from 'vitest';

import type { DerivativeMarketSnapshot } from '../src/derivatives/DerivativeMarketSnapshot';
import {
  createDerivativesFlowStrategyAdapter,
  createMeanReversionCandidate,
  createOriginalWhaleStrategyAdapter,
  createTrendFollowingCandidate,
  StrategyLaboratory,
} from '../src/strategy/StrategyLaboratory';

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

describe('StrategyLaboratory', () => {
  it('evaluates competing strategies through one deterministic interface', () => {
    const laboratory = new StrategyLaboratory([
      createOriginalWhaleStrategyAdapter(),
      createDerivativesFlowStrategyAdapter(),
      createTrendFollowingCandidate(),
      createMeanReversionCandidate(),
    ]);

    const result = laboratory.evaluate({
      snapshot: bullishSnapshot(),
      episodeId: 'episode-1',
    });

    expect(result.decisions.map((decision) => decision.strategyId)).toEqual([
      'derivatives-flow-v1',
      'mean-reversion-v1',
      'original-whale-baseline',
      'trend-following-v1',
    ]);
    expect(
      result.decisions.find(
        (decision) => decision.strategyId === 'derivatives-flow-v1',
      )?.status,
    ).toBe('SIGNAL');
    expect(
      result.decisions.find(
        (decision) => decision.strategyId === 'mean-reversion-v1',
      )?.status,
    ).toBe('NO_SIGNAL');
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.decisions.every((decision) => !decision.liveExecutionAllowed)).toBe(
      true,
    );
  });

  it('supports a range mean-reversion candidate without promoting it', () => {
    const laboratory = new StrategyLaboratory([createMeanReversionCandidate()]);
    const result = laboratory.evaluate({
      snapshot: bullishSnapshot({
        marketStructure: 'RANGE',
        trendEfficiency: 0.2,
        vwapDeviationAtr: 2,
      }),
      episodeId: 'episode-2',
    });

    expect(result.decisions[0]).toMatchObject({
      status: 'SIGNAL',
      direction: 'SHORT',
      liveExecutionAllowed: false,
    });
  });

  it('rejects duplicate strategy identifiers', () => {
    expect(
      () =>
        new StrategyLaboratory([
          createTrendFollowingCandidate(),
          createTrendFollowingCandidate(),
        ]),
    ).toThrow('Duplicate strategy id trend-following-v1');
  });
});
