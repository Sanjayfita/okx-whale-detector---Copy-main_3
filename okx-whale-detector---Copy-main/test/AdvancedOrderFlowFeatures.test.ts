import { describe, expect, it } from 'vitest';

import { calculateAdvancedOrderFlowFeatures } from '../src/orderflow/AdvancedOrderFlowFeatures';
import type {
  FundingRateRecord,
  HistoricalTradeRecord,
  OpenInterestRecord,
  OrderBookSnapshotRecord,
} from '../src/data/ResearchMarketData';

const trade = (
  observedAt: number,
  side: 'BUY' | 'SELL',
  contracts: number,
  price = 101,
): HistoricalTradeRecord => ({
  kind: 'TRADE',
  instrumentId: 'BTC-USDT-SWAP',
  observedAt,
  receivedAt: observedAt + 1,
  source: 'OKX_WEBSOCKET',
  tradeId: `${observedAt}-${side}-${contracts}`,
  side,
  price,
  contracts,
});

const book = (
  observedAt: number,
  bidContracts: number,
  askContracts: number,
): OrderBookSnapshotRecord => ({
  kind: 'ORDER_BOOK',
  instrumentId: 'BTC-USDT-SWAP',
  observedAt,
  receivedAt: observedAt + 1,
  source: 'OKX_WEBSOCKET',
  sequenceId: observedAt,
  bids: [
    { price: 99, contracts: bidContracts, orderCount: 4 },
    { price: 98, contracts: 10, orderCount: 2 },
  ],
  asks: [
    { price: 101, contracts: askContracts, orderCount: 3 },
    { price: 102, contracts: 10, orderCount: 2 },
  ],
});

const openInterest: OpenInterestRecord[] = [
  {
    kind: 'OPEN_INTEREST',
    instrumentId: 'BTC-USDT-SWAP',
    observedAt: 1_000,
    receivedAt: 1_001,
    source: 'OKX_WEBSOCKET',
    contracts: 1_000,
    baseCurrencyAmount: null,
    quoteCurrencyAmount: null,
  },
  {
    kind: 'OPEN_INTEREST',
    instrumentId: 'BTC-USDT-SWAP',
    observedAt: 2_000,
    receivedAt: 2_001,
    source: 'OKX_WEBSOCKET',
    contracts: 1_100,
    baseCurrencyAmount: null,
    quoteCurrencyAmount: null,
  },
];

const funding: FundingRateRecord[] = [
  {
    kind: 'FUNDING',
    instrumentId: 'BTC-USDT-SWAP',
    observedAt: 1_000,
    receivedAt: 1_001,
    source: 'OKX_WEBSOCKET',
    fundingTime: 1_000,
    fundingRate: 0.0001,
    realizedRate: null,
  },
  {
    kind: 'FUNDING',
    instrumentId: 'BTC-USDT-SWAP',
    observedAt: 3_601_000,
    receivedAt: 3_601_001,
    source: 'OKX_WEBSOCKET',
    fundingTime: 3_601_000,
    fundingRate: 0.0002,
    realizedRate: null,
  },
];

describe('calculateAdvancedOrderFlowFeatures', () => {
  it('calculates multi-level flow, OI, funding, and absorption features', () => {
    const vector = calculateAdvancedOrderFlowFeatures({
      asOf: 3_601_000,
      trades: [
        trade(1_100, 'BUY', 10),
        trade(1_200, 'BUY', 10),
        trade(1_300, 'SELL', 2),
      ],
      books: [book(1_000, 20, 20), book(2_000, 30, 18)],
      openInterest,
      funding,
      priorCumulativeVolumeDelta: 5,
    });

    expect(vector.deltaContracts).toBe(18);
    expect(vector.cumulativeVolumeDelta).toBe(23);
    expect(vector.multiLevelOrderBookImbalance).toBeGreaterThan(0);
    expect(vector.queueImbalance).not.toBeNull();
    expect(vector.openInterestState).toBe('EXPANSION');
    expect(vector.openInterestChangePercent).toBeCloseTo(10);
    expect(vector.fundingAccelerationPerHour).toBeCloseTo(0.0001);
    expect(vector.absorption).toBe('BUY_ABSORBED');
    expect(vector.directTradingSignalAllowed).toBe(false);
  });

  it('labels spoofing and hidden-liquidity observations as limited inferences', () => {
    const first = book(1_000, 100, 5);
    const second = book(2_000, 1, 5);
    const vector = calculateAdvancedOrderFlowFeatures({
      asOf: 2_000,
      trades: [trade(1_100, 'BUY', 15, 101)],
      books: [first, second],
      openInterest: [],
      funding: [],
      policy: {
        depthLevels: 2,
        nearTouchWeightDecay: 0.75,
        deltaDivergenceThreshold: 0.2,
        absorptionAggressorFraction: 0.65,
        absorptionMaximumPriceDisplacementBps: 2,
        absorptionMinimumRemainingDepthFraction: 0.8,
        exhaustionVolumeFraction: 0.5,
        spoofingVisibleSizeMultiple: 1.5,
        spoofingMaximumLifetimeMs: 5_000,
        hiddenLiquidityExecutionMultiple: 2,
      },
    });

    expect(vector.spoofingInference.status).toBe(
      'INFERRED_WITH_LIMITATIONS',
    );
    expect(vector.spoofingInference.side).toBe('BUY');
    expect(vector.spoofingInference.limitations.join(' ')).toContain(
      'order identifiers',
    );
    expect(vector.hiddenLiquidityInference.status).toBe(
      'INFERRED_WITH_LIMITATIONS',
    );
    expect(vector.hiddenLiquidityInference.side).toBe('SELL');
    expect(vector.liveExecutionAllowed).toBe(false);
  });
});
