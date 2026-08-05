import type { QuoteCurrency } from './orderbook';

/**
 * Raw OKX instrument taxonomy used at exchange-adapter boundaries.
 * Application trading and research scope is intentionally narrower; see
 * DerivativeInstType and MarketInstrumentConfig below.
 */
export enum InstType {
  SPOT = 'SPOT',
  FUTURES = 'FUTURES',
  SWAP = 'SWAP',
  OPTION = 'OPTION',
}

/** Instrument types that the public market-data adapter can identify. */
export type SupportedInstType = 'SPOT' | 'FUTURES' | 'SWAP';

/**
 * The only instrument types permitted in the application, research datasets,
 * market discovery, and future execution adapters.
 */
export type DerivativeInstType = 'FUTURES' | 'SWAP';

export interface MarketInstrumentConfig {
  instId: string;
  instType: DerivativeInstType;
  quoteCurrency: QuoteCurrency;

  /*
   * Order-book size is a contract count for FUTURES and SWAP instruments.
   * This value is the amount of base asset represented by one contract.
   */
  baseUnitsPerSize: number;
}

export interface OKXPublicInstrument {
  instId: string;
  instType: DerivativeInstType;
  state: string;
  baseCcy: string;
  quoteCcy: string;
  settleCcy: string;
  ctType: string;
  ctVal: string;
  ctValCcy: string;
  ctMult: string;
}

export interface Instrument {
  instId: string;
  instType: InstType;
  baseCcy: string;
  quoteCcy: string;
  settleCcy?: string;
  ctType: string;
  ctVal: number;
  ctValCcy: string;
  ctMult?: number;
  tickSz: string;
  lotSz: string;
  minSz: string;
}
