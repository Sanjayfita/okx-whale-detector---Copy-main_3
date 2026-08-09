import { describe, expect, it } from 'vitest';
import { PaperAccountLedger } from '../src/paper/PaperAccountLedger';

describe('PaperAccountLedger equity memory bounds', () => {
  it('does not mutate equity history merely because dashboards request snapshots', () => {
    const ledger = new PaperAccountLedger(10_000);

    for (let timestamp = 1; timestamp <= 10_000; timestamp += 1) {
      ledger.snapshot(timestamp);
    }

    expect(ledger.snapshot(10_001).equityCurve).toHaveLength(1);
  });

  it('samples high-frequency position marks instead of appending every update', () => {
    const ledger = new PaperAccountLedger(10_000);
    ledger.openPosition({
      instrumentId: 'BTC-USDT-SWAP',
      direction: 'LONG',
      openedAt: 60_000,
      entryPrice: 100,
      quantityBaseUnits: 1,
      stopLossPrice: 90,
      takeProfitPrice: 120,
      riskAmount: 10,
      entryReason: 'TEST',
      entryFee: 0,
    });

    for (let timestamp = 60_001; timestamp < 120_000; timestamp += 250) {
      ledger.markPosition({
        instrumentId: 'BTC-USDT-SWAP',
        price: 101,
        timestamp,
      });
    }
    expect(ledger.snapshot(119_999).equityCurve).toHaveLength(2);

    ledger.markPosition({
      instrumentId: 'BTC-USDT-SWAP',
      price: 102,
      timestamp: 120_000,
    });
    expect(ledger.snapshot(120_001).equityCurve).toHaveLength(3);
  });
});
