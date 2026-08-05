import type { QuoteCurrency } from './orderbook';

/**
 * Raw OKX instrument taxonomy used by adapters and historical-record readers.
 * The live application scope is intentionally narrower; see
 * DerivativeInstType and DerivativeMarketInstrumentConfig below.
 */
export enum InstType {
  SPOT = 'SPOT',
  FUTURES = 'FUTURES',
  SWAP = 'SWAP',
  OPTION = 'OPTION',
}

/** Instrument types that public market-data and legacy replay records can identify. */
export type SupportedInstType = 'SPOT' | 'FUTURES' | 'SWAP';

/** The only instrument types permitted for new live collection and strategy research. */
export type DerivativeInstType = 'FUTURES' | 'SWAP';

/**
 * Generic recorded instrument metadata.
 *
 * SPOT remains representable only so historical recordings, deterministic
 * benchmarks, and legacy audit tools can still be parsed. New live discovery,
 * configured symbols, and OKX instrument loading use the derivative subtype.
 */
export interface MarketInstrumentConfig {
  instId: string;
  instType: SupportedInstType;
  quoteCurrency: QuoteCurrency;
  baseUnitsPerSize: number;
}

/** Instrument metadata accepted by the live futures/perpetual application. */
export interface DerivativeMarketInstrumentConfig
  extends MarketInstrumentConfig {
  instType: DerivativeInstType;
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
