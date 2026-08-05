import { describe, expect, it } from 'vitest';

import { ShadowTradingEngine } from '../src/shadow/ShadowTradingEngine';
import type { ExecutionOrderBook } from '../src/backtest/ExecutionSimulator';

const BOOK_TIME = 1_700_000_000_000;

const book = (quantity: number): ExecutionOrderBook => ({
  observedAt: BOOK_TIME,
  bids: [{ price: 99, quantity }],
  asks: [{ price: 101, quantity }],
});

const signal = (signalId: string, requestedContracts: number) => ({
  signalId,
  strategyId: 'derivatives-flow-v1',
  instrumentId: 'BTC-USDT-SWAP',
  observedAt: BOOK_TIME,
  direction: 'LONG' as const,
  requestedContracts,
  explanationFingerprint: 'explanation-fingerprint',
});

const engine = (): ShadowTradingEngine =>
  new ShadowTradingEngine({
    maximumBookAgeMs: 1_000,
    missedOpportunityThresholdBps: 10,
    execution: {
      takerFeeBps: 5,
      maxLevelParticipationRate: 1,
      latencyMs: 0,
      adverseLatencyBpsPerSecond: 0,
      minimumFillRatio: 0.95,
    },
  });

describe('ShadowTradingEngine', () => {
  it('simulates a live signal and compares it with paper execution', () => {
    const shadow = engine();
    const record = shadow.processSignal({
      signal: signal('filled', 2),
      book: book(10),
      processedAt: BOOK_TIME + 10,
      paperReference: {
        signalId: 'filled',
        status: 'FILLED',
        filledContracts: 2,
        averagePrice: 100.5,
        slippageBps: 50,
      },
    });

    expect(record.fill.status).toBe('FILLED');
    expect(record.fill.averagePrice).toBe(101);
    expect(record.shadowVsPaperPriceBps).toBeGreaterThan(0);
    expect(record.liveOrderSubmitted).toBe(false);

    const updated = shadow.observeOutcome({
      signalId: 'filled',
      observedAt: BOOK_TIME + 60_000,
      markPrice: 102,
    });
    expect(updated.outcomes[0]?.returnBps).toBeGreaterThan(0);

    const report = shadow.generateDailyReport({
      dayStart: BOOK_TIME,
      dayEnd: BOOK_TIME + 24 * 60 * 60 * 1_000,
    });
    expect(report.signalCount).toBe(1);
    expect(report.filledCount).toBe(1);
    expect(report.completedOutcomeCount).toBe(1);
    expect(report.averageShadowVsPaperPriceBps).not.toBeNull();
    expect(report.missedContracts).toBe(0);
    expect(report.liveOrderSubmitted).toBe(false);
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('measures favorable outcomes on unfilled partial-order quantity', () => {
    const shadow = engine();
    const record = shadow.processSignal({
      signal: signal('missed', 100),
      book: book(1),
      processedAt: BOOK_TIME + 10,
    });
    expect(record.fill.status).toBe('PARTIALLY_FILLED');
    expect(record.fill.unfilledQuantity).toBe(99);

    shadow.observeOutcome({
      signalId: 'missed',
      observedAt: BOOK_TIME + 60_000,
      markPrice: 102,
    });
    const report = shadow.generateDailyReport({
      dayStart: BOOK_TIME,
      dayEnd: BOOK_TIME + 24 * 60 * 60 * 1_000,
    });

    expect(report.partialFillCount).toBe(1);
    expect(report.rejectedCount).toBe(0);
    expect(report.missedOpportunityCount).toBe(1);
    expect(report.missedContracts).toBe(99);
    expect(report.averageUnfilledContracts).toBe(99);
    expect(report.averageFillRatio).toBeCloseTo(0.01);
  });

  it('rejects stale or future books before simulation', () => {
    const shadow = engine();
    expect(() =>
      shadow.processSignal({
        signal: signal('stale', 1),
        book: { ...book(10), observedAt: BOOK_TIME - 2_000 },
        processedAt: BOOK_TIME + 10,
      }),
    ).toThrow('stale or from the future');
  });
});
