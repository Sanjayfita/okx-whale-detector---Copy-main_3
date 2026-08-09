import { describe, expect, it } from 'vitest';

import {
  PaperTradingEngine,
  type PaperContractSpecification,
} from '../src/paper/PaperTradingEngine';

const timestamp = Date.UTC(2026, 7, 5, 8);
const specification: PaperContractSpecification = {
  instrumentId: 'BTC-USDT-SWAP',
  tickSize: 0.1,
  lotSize: 1,
  minimumContracts: 1,
  maximumLeverage: 20,
  contractValue: 0.01,
};

const book = (observedAt = timestamp) => ({
  observedAt,
  bids: [
    { price: 99.9, quantity: 1_000 },
    { price: 99.8, quantity: 1_000 },
  ],
  asks: [
    { price: 100.1, quantity: 1_000 },
    { price: 100.2, quantity: 1_000 },
  ],
});

describe('PaperTradingEngine', () => {
  it('normalizes contracts, retries transient failures, and applies contract value', () => {
    const engine = new PaperTradingEngine();
    const order = engine.submitOrder({
      intent: {
        orderId: 'entry-1',
        instrumentId: 'BTC-USDT-SWAP',
        submittedAt: timestamp,
        side: 'BUY',
        orderType: 'MARKET',
        requestedContracts: 10.8,
        limitPrice: null,
        reduceOnly: false,
      },
      specification,
      book: book(),
      now: timestamp + 10,
      transientFailuresBeforeAcceptance: 2,
    });

    expect(order.status).toBe('FILLED');
    expect(order.normalizedContracts).toBe(10);
    expect(order.filledContracts).toBeCloseTo(10, 8);
    expect(order.attempts).toBe(3);
    expect(order.simulatedLatencyMs).toBe(650);
    expect(order.fee).toBeCloseTo(
      (order.averagePrice ?? 0) * 10 * specification.contractValue * 0.0005,
      8,
    );
    expect(order.liveExecutionAllowed).toBe(false);
  });

  it('rejects stale books, non-marketable limits, and exhausted retries', () => {
    const engine = new PaperTradingEngine();
    const stale = engine.submitOrder({
      intent: {
        orderId: 'stale',
        instrumentId: specification.instrumentId,
        submittedAt: timestamp,
        side: 'BUY',
        orderType: 'MARKET',
        requestedContracts: 10,
        limitPrice: null,
        reduceOnly: false,
      },
      specification,
      book: book(timestamp - 3_000),
      now: timestamp,
    });
    const limit = engine.submitOrder({
      intent: {
        orderId: 'limit',
        instrumentId: specification.instrumentId,
        submittedAt: timestamp,
        side: 'BUY',
        orderType: 'LIMIT',
        requestedContracts: 10,
        limitPrice: 99,
        reduceOnly: false,
      },
      specification,
      book: book(),
      now: timestamp,
    });
    const retry = engine.submitOrder({
      intent: {
        orderId: 'retry',
        instrumentId: specification.instrumentId,
        submittedAt: timestamp,
        side: 'BUY',
        orderType: 'MARKET',
        requestedContracts: 10,
        limitPrice: null,
        reduceOnly: false,
      },
      specification,
      book: book(),
      now: timestamp,
      transientFailuresBeforeAcceptance: 10,
    });

    expect(stale.rejectionReasons).toContain('STALE_ORDER_BOOK');
    expect(limit.rejectionReasons).toContain('NON_MARKETABLE_LIMIT_NOT_SIMULATED');
    expect(retry.status).toBe('RETRY_EXHAUSTED');
    expect(retry.attempts).toBe(4);
  });

  it('opens, funds, closes, and reports a contract-aware paper position', () => {
    const engine = new PaperTradingEngine();
    const entry = engine.submitOrder({
      intent: {
        orderId: 'entry',
        instrumentId: specification.instrumentId,
        submittedAt: timestamp,
        side: 'BUY',
        orderType: 'MARKET',
        requestedContracts: 100,
        limitPrice: null,
        reduceOnly: false,
      },
      specification,
      book: book(),
      now: timestamp,
    });
    const position = engine.openPosition({
      order: entry,
      instrumentId: specification.instrumentId,
      direction: 'LONG',
      leverage: 10,
      openedAt: timestamp,
    });
    const funded = engine.applyFunding({
      instrumentId: specification.instrumentId,
      fundingRatePercent: 0.01,
    });
    const exitBook = {
      observedAt: timestamp + 60_000,
      bids: [{ price: 102, quantity: 1_000 }],
      asks: [{ price: 102.2, quantity: 1_000 }],
    };
    const exit = engine.submitOrder({
      intent: {
        orderId: 'exit',
        instrumentId: specification.instrumentId,
        submittedAt: timestamp + 60_000,
        side: 'SELL',
        orderType: 'MARKET',
        requestedContracts: position.contracts,
        limitPrice: null,
        reduceOnly: true,
      },
      specification,
      book: exitBook,
      now: timestamp + 60_010,
    });
    const closed = engine.closePosition({
      instrumentId: specification.instrumentId,
      order: exit,
      closedAt: timestamp + 60_000,
      entryFee: entry.fee,
    });
    const report = engine.generateDailyReport(timestamp + 60_000);

    expect(funded.accumulatedFundingPnl).toBeLessThan(0);
    expect(closed.grossPnl).toBeCloseTo(
      ((exit.averagePrice ?? 0) - (entry.averagePrice ?? 0)) *
        closed.contracts *
        specification.contractValue,
      8,
    );
    expect(report.submittedOrders).toBe(2);
    expect(report.closedTrades).toBe(1);
    expect(report.netPnl).toBe(closed.netPnl);
    expect(report.openPositions).toBe(0);
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('rejects leverage above exchange metadata', () => {
    const engine = new PaperTradingEngine();
    const entry = engine.submitOrder({
      intent: {
        orderId: 'entry-leverage',
        instrumentId: specification.instrumentId,
        submittedAt: timestamp,
        side: 'BUY',
        orderType: 'MARKET',
        requestedContracts: 10,
        limitPrice: null,
        reduceOnly: false,
      },
      specification,
      book: book(),
      now: timestamp,
    });

    expect(() =>
      engine.openPosition({
        order: entry,
        instrumentId: specification.instrumentId,
        direction: 'LONG',
        leverage: 21,
        openedAt: timestamp,
      }),
    ).toThrow('leverage exceeds contract maximum');
  });
});
