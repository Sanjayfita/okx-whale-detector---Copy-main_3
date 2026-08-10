import { describe, expect, it } from 'vitest';
import {
  normalizeBacktestQuantity,
  quantizeBacktestFillPrice,
  validateBacktestInstrumentSpecification,
} from '../src/backtest/BacktestInstrumentSpecification';

describe('backtest instrument specification', () => {
  it('quantizes size down and market prices adversely', () => {
    expect(normalizeBacktestQuantity(1.239, 0.01)).toBe(1.23);
    expect(quantizeBacktestFillPrice(100.01, 0.1, 'BUY')).toBe(100.1);
    expect(quantizeBacktestFillPrice(100.09, 0.1, 'SELL')).toBe(100);
  });

  it('requires the specification to match the tested instrument', () => {
    expect(() =>
      validateBacktestInstrumentSpecification(
        {
          instrumentId: 'ETH-USDT-SWAP',
          tickSize: 0.1,
          lotSizeBaseUnits: 0.01,
          minimumOrderBaseUnits: 0.01,
          minimumOrderValue: 1,
          maximumLeverage: 10,
        },
        'BTC-USDT-SWAP',
      ),
    ).toThrow('does not match');
  });
});
