import type { OrderBookLevel } from '../../types/orderbook';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isFiniteNumberString = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim() !== '' &&
  Number.isFinite(Number(value));

export const isOrderBookLevel = (value: unknown): value is OrderBookLevel =>
  Array.isArray(value) &&
  value.length >= 4 &&
  isFiniteNumberString(value[0]) &&
  Number(value[0]) > 0 &&
  isFiniteNumberString(value[1]) &&
  Number(value[1]) >= 0 &&
  typeof value[2] === 'string' &&
  typeof value[3] === 'string';
