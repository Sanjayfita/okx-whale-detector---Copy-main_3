import { describe, expect, it } from 'vitest';

import type { DerivativeMarketSnapshot } from '../src/derivatives/DerivativeMarketSnapshot';
import {
  createPrimaryStrategyLaboratory,
  type StrategyObservation,
} from '../src/strategy/StrategyLaboratory';

const start = 1_800_000_000_000;

const snapshot: DerivativeMarketSnapshot = {
  instrumentId: 'BTC-USDT-SWAP',
  observedAt: start + 6 * 60_000,
  markPrice: 98.5,
  indexPrice: 98.5,
  bestBid: 98.49,
  bestAsk: 98.51,
  atrPercent: 1,
  trendEfficiency: 0.5,
  trendAlignment: 0,
  volumeRatio: 1,
  priceChangePercent: 0,
  openInterestChangePercent: 0,
  aggressiveDeltaNormalized: 0,
  cvdSlopeNormalized: 0,
  orderBookImbalance: 0,
  liquidationImbalance: 0,
  fundingRatePercent: 0,
  vwapDeviationAtr: 0,
  marketStructure: 'RANGE',
  whaleDirectionalBias: -1,
  whaleAuthenticity: 1,
};

const closes = [100, 98, 96, 94, 94.5, 96.5, 98.5];
const candles = closes.map((close, index) => {
  const open = closes[index - 1] ?? close;
  return {
    timestamp: start + index * 60_000,
    open,
    high: Math.max(open, close) + 0.5,
    low: Math.min(open, close) - 0.5,
    close,
    confirm: true,
  };
});

const observation: StrategyObservation = {
  snapshot,
  episodeId: 'ema-primary-1',
  candles,
  accountEquity: 10_000,
};

describe('primary strategy laboratory', () => {
  it('contains only the EMA strategy and ignores contradictory whale evidence', () => {
    const laboratory = createPrimaryStrategyLaboratory({
      fastEmaLength: 3,
      slowEmaLength: 5,
      rsiPeriod: 3,
      atrPeriod: 3,
      atrMultiplier: 1.5,
      minimumAtrPercent: 0.1,
      maximumAtrPercent: 20,
      stopLossPercent: 1,
      takeProfitPercent: 2,
      trailingStopEnabled: false,
      trailingStopPercent: 1,
    });

    const result = laboratory.evaluate(observation);

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      strategyId: 'ema-trend-crossover-v1',
      status: 'SIGNAL',
      direction: 'LONG',
      liveExecutionAllowed: false,
    });
  });

  it('fails closed when candle/equity inputs required by the EMA strategy are absent', () => {
    const laboratory = createPrimaryStrategyLaboratory();
    const result = laboratory.evaluate({
      snapshot,
      episodeId: 'ema-primary-missing-inputs',
    });

    expect(result.decisions[0]).toMatchObject({
      strategyId: 'ema-trend-crossover-v1',
      status: 'NO_SIGNAL',
      direction: 'FLAT',
      reasons: ['EMA_CANDLES_OR_EQUITY_MISSING'],
    });
  });
});
