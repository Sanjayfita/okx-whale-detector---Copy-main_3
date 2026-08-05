import type { DerivativeInstType } from '../types/instrument';

export type MarketDataSource =
  | 'OKX_REST'
  | 'OKX_WEBSOCKET'
  | 'OKX_HISTORICAL_ARCHIVE'
  | 'SYNTHETIC_TEST';

export interface TimestampedRecord {
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly receivedAt: number;
  readonly source: MarketDataSource;
}

export interface HistoricalTradeRecord extends TimestampedRecord {
  readonly kind: 'TRADE';
  readonly tradeId: string;
  readonly side: 'BUY' | 'SELL';
  readonly price: number;
  readonly contracts: number;
}

export interface OrderBookDepthLevel {
  readonly price: number;
  readonly contracts: number;
  readonly orderCount: number | null;
}

export interface OrderBookSnapshotRecord extends TimestampedRecord {
  readonly kind: 'ORDER_BOOK';
  readonly sequenceId: number | null;
  readonly bids: readonly OrderBookDepthLevel[];
  readonly asks: readonly OrderBookDepthLevel[];
}

export interface CandleRecord extends TimestampedRecord {
  readonly kind: 'CANDLE';
  readonly intervalMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly contractVolume: number;
  readonly baseVolume: number | null;
  readonly quoteVolume: number | null;
  readonly confirmed: boolean;
}

export interface OpenInterestRecord extends TimestampedRecord {
  readonly kind: 'OPEN_INTEREST';
  readonly contracts: number;
  readonly baseCurrencyAmount: number | null;
  readonly quoteCurrencyAmount: number | null;
}

export interface FundingRateRecord extends TimestampedRecord {
  readonly kind: 'FUNDING';
  readonly fundingTime: number;
  readonly fundingRate: number;
  readonly realizedRate: number | null;
}

export interface LiquidationRecord extends TimestampedRecord {
  readonly kind: 'LIQUIDATION';
  readonly side: 'LONG_LIQUIDATED' | 'SHORT_LIQUIDATED';
  readonly price: number;
  readonly contracts: number;
}

export interface MarkIndexRecord extends TimestampedRecord {
  readonly kind: 'MARK_INDEX';
  readonly markPrice: number;
  readonly indexPrice: number;
}

export interface BestQuoteRecord extends TimestampedRecord {
  readonly kind: 'BEST_QUOTE';
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly bidContracts: number | null;
  readonly askContracts: number | null;
}

export interface VolumeRecord extends TimestampedRecord {
  readonly kind: 'VOLUME';
  readonly windowMs: number;
  readonly contractVolume: number;
  readonly baseVolume: number | null;
  readonly quoteVolume: number | null;
}

export interface ContractMetadataRecord extends TimestampedRecord {
  readonly kind: 'CONTRACT_METADATA';
  readonly instrumentType: DerivativeInstType;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly settlementCurrency: string;
  readonly contractValue: number;
  readonly contractValueCurrency: string;
  readonly tickSize: number;
  readonly lotSize: number;
  readonly minimumContracts: number;
  readonly maximumLeverage: number | null;
  readonly listingTime: number | null;
  readonly expiryTime: number | null;
}

export type ResearchMarketDataRecord =
  | HistoricalTradeRecord
  | OrderBookSnapshotRecord
  | CandleRecord
  | OpenInterestRecord
  | FundingRateRecord
  | LiquidationRecord
  | MarkIndexRecord
  | BestQuoteRecord
  | VolumeRecord
  | ContractMetadataRecord;

export interface HistoricalMarketDataBatch {
  readonly instrumentId: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly records: readonly ResearchMarketDataRecord[];
}

export const MARKET_DATA_SCHEMA_VERSION = 1 as const;
