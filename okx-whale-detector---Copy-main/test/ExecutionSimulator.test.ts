import { describe, expect, it } from 'vitest';

import {
  estimateLinearLiquidationPrice,
  simulateLeveragedTrade,
  simulateMarketOrder,
  type ExecutionOrderBook,
  type ExecutionSimulationPolicy,
} from '../src/backtest/ExecutionSimulator';

const policy: ExecutionSimulationPolicy = {
  takerFeeBps: 5,
  maxLevelParticipationRate: 1,
  latencyMs: 0,
  adverseLatencyBpsPerSecond: 0,
  minimumFillRatio: 0.9,
};

const book = (
  observedAt: number,
  bestBid: number,
  bestAsk: number,
): ExecutionOrderBook => ({
  observedAt,
  bids: [
    { price: bestBid, quantity: 1 },
    { price: bestBid - 1, quantity: 2 },
  ],
  asks: [
    { price: bestAsk, quantity: 1 },
    { price: bestAsk + 1, quantity: 2 },
  ],
});

describe('simulateMarketOrder', () => {
  it('walks depth and reports volume-weighted slippage and fees', () => {
    const result = simulateMarketOrder({
      side: 'BUY',
      quantity: 2,
      book: book(0, 99, 101),
      policy,
    });

    expect(result.status).toBe('FILLED');
    expect(result.minimumFillRatioMet).toBe(true);
    expect(result.averagePrice).toBe(101.5);
    expect(result.grossNotional).toBe(203);
    expect(result.fee).toBeCloseTo(0.1015, 8);
    expect(result.slippageBps).toBeCloseTo(150, 8);
    expect(result.consumedLevels).toBe(2);
  });

  it('records real partial exposure below the preferred fill ratio', () => {
    const result = simulateMarketOrder({
      side: 'SELL',
      quantity: 10,
      book: book(0, 99, 101),
      policy,
    });

    expect(result.status).toBe('PARTIALLY_FILLED');
    expect(result.fillRatio).toBe(0.3);
    expect(result.filledQuantity).toBe(3);
    expect(result.unfilledQuantity).toBe(7);
    expect(result.minimumFillRatioMet).toBe(false);
    expect(result.rejectionReasons).toEqual(['MINIMUM_FILL_RATIO_NOT_MET']);
  });
});

describe('simulateLeveragedTrade', () => {
  it('deducts taker fees and funding from a long trade', () => {
    const result = simulateLeveragedTrade({
      direction: 'LONG',
      quantity: 1,
      entryBook: book(0, 99, 100),
      exitBook: book(8 * 3_600_000, 110, 111),
      leverage: 3,
      maintenanceMarginRate: 0.05,
      fundingRatePercentPerInterval: 0.01,
      fundingIntervalHours: 8,
      pathLow: 95,
      pathHigh: 111,
      policy,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.grossPnl).toBe(10);
    expect(result.feeCost).toBeCloseTo(0.105, 8);
    expect(result.fundingPnl).toBeCloseTo(-0.01, 8);
    expect(result.netPnl).toBeCloseTo(9.885, 8);
    expect(result.unmatchedQuantity).toBe(0);
    expect(result.liveExecutionAllowed).toBe(false);
  });

  it('keeps partial entry fills in the simulated position', () => {
    const result = simulateLeveragedTrade({
      direction: 'LONG',
      quantity: 10,
      entryBook: book(0, 99, 100),
      exitBook: {
        observedAt: 3_600_000,
        bids: [{ price: 105, quantity: 3 }],
        asks: [{ price: 106, quantity: 3 }],
      },
      leverage: 3,
      maintenanceMarginRate: 0.05,
      fundingRatePercentPerInterval: 0,
      fundingIntervalHours: 8,
      pathLow: 95,
      pathHigh: 106,
      policy,
    });

    expect(result.entry.status).toBe('PARTIALLY_FILLED');
    expect(result.entry.filledQuantity).toBe(3);
    expect(result.status).toBe('COMPLETED');
    expect(result.matchedQuantity).toBe(3);
    expect(result.unmatchedQuantity).toBe(0);
  });

  it('reports residual exposure and all paid fees after a partial exit', () => {
    const result = simulateLeveragedTrade({
      direction: 'LONG',
      quantity: 3,
      entryBook: book(0, 99, 100),
      exitBook: {
        observedAt: 3_600_000,
        bids: [{ price: 105, quantity: 1 }],
        asks: [{ price: 106, quantity: 1 }],
      },
      leverage: 3,
      maintenanceMarginRate: 0.05,
      fundingRatePercentPerInterval: 0,
      fundingIntervalHours: 8,
      pathLow: 95,
      pathHigh: 106,
      policy,
    });

    expect(result.status).toBe('PARTIALLY_EXITED');
    expect(result.matchedQuantity).toBe(1);
    expect(result.unmatchedQuantity).toBe(2);
    expect(result.rejectionReasons).toContain('RESIDUAL_POSITION_REMAINS_OPEN');
    expect(result.feeCost).toBeCloseTo(
      result.entry.fee + (result.exit?.fee ?? 0),
      8,
    );
  });

  it('flags a path that crosses the estimated isolated liquidation price', () => {
    const liquidationPrice = estimateLinearLiquidationPrice({
      direction: 'LONG',
      entryPrice: 100,
      leverage: 5,
      maintenanceMarginRate: 0.05,
    });
    expect(liquidationPrice).toBeCloseTo(85, 8);

    const result = simulateLeveragedTrade({
      direction: 'LONG',
      quantity: 1,
      entryBook: book(0, 99, 100),
      exitBook: book(3_600_000, 105, 106),
      leverage: 5,
      maintenanceMarginRate: 0.05,
      fundingRatePercentPerInterval: 0,
      fundingIntervalHours: 8,
      pathLow: 84,
      pathHigh: 106,
      policy,
    });

    expect(result.status).toBe('LIQUIDATED');
    expect(result.netPnl).toBeLessThan(0);
    expect(result.exit).toBeNull();
    expect(result.unmatchedQuantity).toBe(0);
  });
});
