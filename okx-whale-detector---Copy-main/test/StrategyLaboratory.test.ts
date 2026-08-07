import { describe, expect, it } from 'vitest';

import type { DerivativeMarketSnapshot } from '../src/derivatives/DerivativeMarketSnapshot';
import {
  createDerivativesFlowStrategyAdapter,
  createMeanReversionCandidate,
  createOriginalWhaleStrategyAdapter,
  createPrimaryStrategyLaboratory,
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
  it('keeps legacy strategies available only for explicit research comparison', () => {
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
    expect(result.liveExecutionAllowed).toBe(false);
    expect(result.decisions.every((decision) => !decision.liveExecutionAllowed)).toBe(
      true,
    );
  });

  it('selects only EMA trend logic as the canonical primary entry strategy', () => {
    const laboratory = createPrimaryStrategyLaboratory();
    const result = laboratory.evaluate({
      snapshot: bullishSnapshot(),
      episodeId: 'primary-1',
      accountEquity: 10_000,
    });

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      strategyId: 'ema-trend-v1',
      status: 'NO_SIGNAL',
      direction: 'FLAT',
      reasons: ['CANDLE_HISTORY_REQUIRED'],
      liveExecutionAllowed: false,
    });
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
