import { describe, expect, it } from 'vitest';
import { PaperAccountLedger } from '../src/paper/PaperAccountLedger';

const openInput = {
  fillId: 'fill-entry-1',
  tradeId: 'trade-1',
  instrumentId: 'BTC-USDT-SWAP',
  direction: 'LONG' as const,
  openedAt: 1_000,
  entryPrice: 100,
  quantityBaseUnits: 2,
  stopLossPrice: 95,
  takeProfitPrice: 110,
  trailingStopPrice: 97,
  riskAmount: 10,
  entryReason: 'EMA_CROSS',
  entryFee: 1,
  slippageBps: 2,
  strategyId: 'ema-trend-crossover-v1',
  timeframe: '15m' as const,
};

describe('paper ledger idempotency', () => {
  it('applies the same entry fill exactly once', () => {
    const ledger = new PaperAccountLedger(10_000);

    expect(ledger.openPositionFromFill(openInput).applied).toBe(true);
    expect(ledger.openPositionFromFill(openInput).applied).toBe(false);

    const snapshot = ledger.snapshot(1_000);
    expect(snapshot.openPositions).toHaveLength(1);
    expect(snapshot.fills).toHaveLength(1);
    expect(snapshot.cashBalance).toBe(9_999);
    expect(
      snapshot.ledgerEvents.filter((event) => event.type === 'FILL'),
    ).toHaveLength(1);
    expect(
      snapshot.ledgerEvents.filter((event) => event.type === 'FEE'),
    ).toHaveLength(1);
  });

  it('applies the same funding event exactly once', () => {
    const ledger = new PaperAccountLedger(10_000);
    ledger.openPositionFromFill(openInput);

    const event = {
      fundingId: 'BTC-USDT-SWAP:funding:2000',
      instrumentId: 'BTC-USDT-SWAP',
      timestamp: 2_000,
      positionNotional: 200,
      fundingRatePercent: 0.1,
      fundingPnl: -0.2,
    };
    expect(ledger.applyFundingEvent(event).applied).toBe(true);
    expect(ledger.applyFundingEvent(event).applied).toBe(false);

    const snapshot = ledger.snapshot(2_000);
    expect(snapshot.fundingEvents).toHaveLength(1);
    expect(snapshot.openPositions[0]?.fundingPnl).toBeCloseTo(-0.2);
    expect(snapshot.cashBalance).toBeCloseTo(9_998.8);
    expect(
      snapshot.ledgerEvents.filter((entry) => entry.type === 'FUNDING'),
    ).toHaveLength(1);
  });

  it('applies the same closing fill exactly once', () => {
    const ledger = new PaperAccountLedger(10_000);
    ledger.openPositionFromFill(openInput);

    const close = {
      fillId: 'fill-exit-1',
      instrumentId: 'BTC-USDT-SWAP',
      exitPrice: 110,
      quantityBaseUnits: 2,
      closedAt: 3_000,
      exitReason: 'TAKE_PROFIT',
      exitFee: 1,
      slippageBps: 1.5,
    };
    expect(ledger.closePositionFromFill(close).applied).toBe(true);
    expect(ledger.closePositionFromFill(close).applied).toBe(false);

    const snapshot = ledger.snapshot(3_000);
    expect(snapshot.openPositions).toHaveLength(0);
    expect(snapshot.trades).toHaveLength(1);
    expect(snapshot.fills).toHaveLength(2);
    expect(snapshot.trades[0]).toMatchObject({
      tradeId: 'trade-1',
      strategyId: 'ema-trend-crossover-v1',
      timeframe: '15m',
      entryFillId: 'fill-entry-1',
      exitFillId: 'fill-exit-1',
      entrySlippageBps: 2,
      exitSlippageBps: 1.5,
    });
    expect(snapshot.equity).toBeCloseTo(10_018);
  });
});
