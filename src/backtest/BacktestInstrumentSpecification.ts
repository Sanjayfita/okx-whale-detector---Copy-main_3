import type { MarketOrderSide } from './ExecutionSimulator';

export interface BacktestInstrumentSpecification {
  readonly instrumentId: string;
  /** Smallest valid price increment. */
  readonly tickSize: number;
  /** Smallest valid base-quantity increment after contract conversion. */
  readonly lotSizeBaseUnits: number;
  readonly minimumOrderBaseUnits: number;
  readonly minimumOrderValue: number;
  readonly maximumLeverage: number;
}

const decimalPlaces = (value: number): number => {
  const text = value.toString().toLowerCase();
  if (text.includes('e-')) return Number(text.split('e-')[1] ?? 0);
  return text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0;
};

const positive = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
};

export const validateBacktestInstrumentSpecification = (
  specification: BacktestInstrumentSpecification,
  expectedInstrumentId?: string,
): void => {
  if (specification.instrumentId.trim().length === 0) {
    throw new Error('instrument specification ID must not be empty');
  }
  if (
    expectedInstrumentId !== undefined &&
    specification.instrumentId !== expectedInstrumentId
  ) {
    throw new Error('instrument specification does not match the backtest');
  }
  positive(specification.tickSize, 'tickSize');
  positive(specification.lotSizeBaseUnits, 'lotSizeBaseUnits');
  positive(specification.minimumOrderBaseUnits, 'minimumOrderBaseUnits');
  positive(specification.minimumOrderValue, 'minimumOrderValue');
  positive(specification.maximumLeverage, 'maximumLeverage');
  const normalizedMinimum = normalizeBacktestQuantity(
    specification.minimumOrderBaseUnits,
    specification.lotSizeBaseUnits,
  );
  if (normalizedMinimum !== specification.minimumOrderBaseUnits) {
    throw new Error('minimumOrderBaseUnits must align with lotSizeBaseUnits');
  }
};

export const normalizeBacktestQuantity = (
  quantity: number,
  lotSizeBaseUnits: number,
): number => {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  positive(lotSizeBaseUnits, 'lotSizeBaseUnits');
  const precision = Math.min(15, decimalPlaces(lotSizeBaseUnits));
  const units = Math.floor((quantity + Number.EPSILON) / lotSizeBaseUnits);
  return Number((units * lotSizeBaseUnits).toFixed(precision));
};

/** Quantizes a simulated market fill against the trader. */
export const quantizeBacktestFillPrice = (
  price: number,
  tickSize: number,
  side: MarketOrderSide,
): number => {
  positive(price, 'price');
  positive(tickSize, 'tickSize');
  const precision = Math.min(15, decimalPlaces(tickSize));
  const rawUnits = price / tickSize;
  const units = side === 'BUY' ? Math.ceil(rawUnits) : Math.floor(rawUnits);
  return Number((units * tickSize).toFixed(precision));
};
