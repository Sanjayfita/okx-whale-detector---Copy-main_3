import { describe, expect, it } from 'vitest';
import { PaperAccountLedger } from '../src/paper/PaperAccountLedger';

describe('PaperAccountLedger', () => {
  it('marks equity and journals fees, funding and R on close', () => {
    const ledger = new PaperAccountLedger(10_000);
    ledger.openPosition({
      instrumentId: 'BTC-USDT-SWAP',
      direction: 'LONG',
      openedAt: 1_000,
      entryPrice: 100,
      quantityBaseUnits: 2,
      stopLossPrice: 95,
      takeProfitPrice: 110,
      riskAmount: 10,
      entryReason: 'EMA_CROSS',
      entryFee: 1,
    });
    ledger.markPosition({
      instrumentId: 'BTC-USDT-SWAP',
      price: 105,
      timestamp: 2_000,
    });
    expect(ledger.snapshot(2_000).unrealizedPnl).toBe(10);

    ledger.applyFunding({
      instrumentId: 'BTC-USDT-SWAP',
      fundingPnl: -0.5,
      timestamp: 2_500,
    });
    const trade = ledger.closePosition({
      instrumentId: 'BTC-USDT-SWAP',
      exitPrice: 110,
      closedAt: 3_000,
      exitReason: 'TAKE_PROFIT',
      exitFee: 1,
    });

    expect(trade.grossPnl).toBe(20);
    expect(trade.fees).toBe(2);
    expect(trade.fundingPnl).toBe(-0.5);
    expect(trade.netPnl).toBe(17.5);
    expect(trade.rMultiple).toBe(1.75);
    expect(ledger.snapshot(3_000).equity).toBe(10_017.5);
  });

  it('rejects a duplicate instrument position', () => {
    const ledger = new PaperAccountLedger(10_000);
    const input = {
      instrumentId: 'ETH-USDT-SWAP',
      direction: 'SHORT' as const,
      openedAt: 1_000,
      entryPrice: 100,
      quantityBaseUnits: 1,
      stopLossPrice: 105,
      takeProfitPrice: 90,
      riskAmount: 5,
      entryReason: 'TEST',
      entryFee: 0,
    };
    ledger.openPosition(input);
    expect(() => ledger.openPosition(input)).toThrow(/already exists/u);
  });
});
