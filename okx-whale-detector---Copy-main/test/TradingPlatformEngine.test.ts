import { describe, expect, it } from 'vitest';
import { resolveSymbolConfig } from '../src/config/symbolProfiles';
import { MarketState } from '../src/core/MarketState';
import { PlatformStateStore } from '../src/platform/PlatformStateStore';
import { TradingPlatformEngine } from '../src/platform/TradingPlatformEngine';

describe('TradingPlatformEngine', () => {
  it('marks positions and closes a take-profit through the depth-aware simulator', () => {
    const store = new PlatformStateStore({ now: () => 2_000 });
    const engine = new TradingPlatformEngine(store, { now: () => 2_000 });
    store.account.openPosition({
      instrumentId: 'BTC-USDT-SWAP',
      direction: 'LONG',
      openedAt: 1_000,
      entryPrice: 100,
      quantityBaseUnits: 1,
      stopLossPrice: 95,
      takeProfitPrice: 110,
      riskAmount: 5,
      entryReason: 'TEST_ENTRY',
      entryFee: 0,
    });

    const state = new MarketState(resolveSymbolConfig('BTC-USDT-SWAP'), {
      instId: 'BTC-USDT-SWAP',
      instType: 'SWAP',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 1,
    });
    expect(
      state.orderBookManager.applyUpdate(
        [['110', '10', '0', '1']],
        [['111', '10', '0', '1']],
        2_000,
        1,
        -1,
        'snapshot',
      ),
    ).toBe(true);

    engine.onOrderBook('BTC-USDT-SWAP', state);

    const snapshot = store.account.snapshot(2_000);
    expect(snapshot.openPositions).toHaveLength(0);
    expect(snapshot.trades).toHaveLength(1);
    expect(snapshot.trades[0]?.exitReason).toBe('TAKE_PROFIT');
    expect(snapshot.trades[0]?.fees).toBeGreaterThan(0);
  });

  it('applies funding to an open paper position', () => {
    const store = new PlatformStateStore({ now: () => 2_000 });
    const engine = new TradingPlatformEngine(store, { now: () => 2_000 });
    store.account.openPosition({
      instrumentId: 'ETH-USDT-SWAP',
      direction: 'LONG',
      openedAt: 1_000,
      entryPrice: 100,
      quantityBaseUnits: 2,
      stopLossPrice: 95,
      takeProfitPrice: 110,
      riskAmount: 10,
      entryReason: 'TEST_ENTRY',
      entryFee: 0,
    });

    engine.onFunding({
      instrumentId: 'ETH-USDT-SWAP',
      fundingRatePercent: 0.1,
      timestamp: 2_000,
    });

    expect(
      store.account.getOpenPosition('ETH-USDT-SWAP')?.fundingPnl,
    ).toBeCloseTo(-0.2);
  });
});