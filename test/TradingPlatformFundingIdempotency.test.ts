import { describe, expect, it } from 'vitest';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';
import { TradingPlatformEngine } from '../src/platform/TradingPlatformEngine';

const open = (
  store: PlatformStateStore,
  instrumentId: string,
  direction: 'LONG' | 'SHORT',
): void => {
  store.account.openPosition({
    instrumentId,
    direction,
    openedAt: 1_000,
    entryPrice: 100,
    quantityBaseUnits: 2,
    stopLossPrice: direction === 'LONG' ? 95 : 105,
    takeProfitPrice: direction === 'LONG' ? 110 : 90,
    riskAmount: 10,
    entryReason: 'TEST_ENTRY',
    entryFee: 0,
  });
};

describe('TradingPlatformEngine funding accounting', () => {
  it('charges a long and credits a short for a positive funding rate', () => {
    const longStore = new PlatformStateStore({ now: () => 2_000 });
    const longEngine = new TradingPlatformEngine(longStore, { now: () => 2_000 });
    open(longStore, 'ETH-USDT-SWAP', 'LONG');
    longEngine.onFunding({
      instrumentId: 'ETH-USDT-SWAP',
      fundingRatePercent: 0.1,
      timestamp: 2_000,
      fundingEventId: 'eth-funding-2000',
    });

    const shortStore = new PlatformStateStore({ now: () => 2_000 });
    const shortEngine = new TradingPlatformEngine(shortStore, { now: () => 2_000 });
    open(shortStore, 'BTC-USDT-SWAP', 'SHORT');
    shortEngine.onFunding({
      instrumentId: 'BTC-USDT-SWAP',
      fundingRatePercent: 0.1,
      timestamp: 2_000,
      fundingEventId: 'btc-funding-2000',
    });

    expect(longStore.account.getOpenPosition('ETH-USDT-SWAP')?.fundingPnl).toBeCloseTo(
      -0.2,
    );
    expect(shortStore.account.getOpenPosition('BTC-USDT-SWAP')?.fundingPnl).toBeCloseTo(
      0.2,
    );
  });

  it('does not apply the same funding event twice', () => {
    const store = new PlatformStateStore({ now: () => 2_000 });
    const engine = new TradingPlatformEngine(store, { now: () => 2_000 });
    open(store, 'ETH-USDT-SWAP', 'LONG');
    const event = {
      instrumentId: 'ETH-USDT-SWAP',
      fundingRatePercent: 0.1,
      timestamp: 2_000,
      fundingEventId: 'eth-funding-2000',
    } as const;

    engine.onFunding(event);
    engine.onFunding(event);

    const snapshot = store.account.snapshot(2_000);
    expect(snapshot.fundingEvents).toHaveLength(1);
    expect(snapshot.fundingEvents[0]?.fundingId).toBe('eth-funding-2000');
    expect(snapshot.openPositions[0]?.fundingPnl).toBeCloseTo(-0.2);
  });
});
