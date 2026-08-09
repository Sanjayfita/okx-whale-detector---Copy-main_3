import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import type { OKXOrderBookUpdate } from '../clients/okx/OKXWebSocketClient';
import type { MarketInstrumentConfig } from '../types/instrument';

export const MARKET_RECORDING_SCHEMA_VERSION = 1 as const;

export const MARKET_RECORDING_CLOCK_BASIS = {
  eventTime: 'UTC_EPOCH_MS',
  availabilityTime: 'UTC_EPOCH_MS',
  arrivalOrder: 'FILE_ORDINAL',
} as const;

export type MarketRecordingFormatType = 'VERSIONED_V1' | 'LEGACY_UNVERSIONED';

export interface MarketRecordingProducer {
  name: string;
  version: string;
}

export interface MarketRecordingSubscriptions {
  orderBookChannel: string;
  orderBookDepth: number;
  candleIntervals: string[];
}

export interface MarketRecordingHeaderRecord {
  recordType: 'header';
  schemaVersion: typeof MARKET_RECORDING_SCHEMA_VERSION;
  /** UTC epoch milliseconds when the header was written. */
  recordedAt: number;
  /** The application runtime that also owns related alert records. */
  sourceSessionId: string;
  /** The unique identity of this specific market recording stream. */
  recordingId: string;
  /** UTC epoch milliseconds when the application runtime started. */
  startedAt: number;
  producer: MarketRecordingProducer;
  clockBasis: typeof MARKET_RECORDING_CLOCK_BASIS;
  instruments: MarketInstrumentConfig[];
  subscriptions: MarketRecordingSubscriptions;
}

export interface InstrumentRecordingRecord {
  type: 'instrument';
  recordedAt: number;
  instrument: MarketInstrumentConfig;
}

export interface OrderBookRecordingRecord {
  type: 'orderBook';
  recordedAt: number;
  update: OKXOrderBookUpdate;
}

export interface LegacyCandleRecordingRecord {
  type: 'candle';
  recordedAt: number;
  candle: OKXCandle;
}

export interface VersionedCandleRecordingRecord extends LegacyCandleRecordingRecord {
  interval: string;
}

export type MarketDataRecordingRecord =
  | InstrumentRecordingRecord
  | OrderBookRecordingRecord
  | VersionedCandleRecordingRecord;

export type LegacyRecordingRecord =
  | InstrumentRecordingRecord
  | OrderBookRecordingRecord
  | LegacyCandleRecordingRecord;

export interface MarketRecordingCounts {
  instrumentRecords: number;
  orderBookRecords: number;
  candleRecords: number;
}

export interface MarketRecordingSessionEndRecord {
  recordType: 'sessionEnd';
  schemaVersion: typeof MARKET_RECORDING_SCHEMA_VERSION;
  /** UTC epoch milliseconds when the footer was written. */
  recordedAt: number;
  sourceSessionId: string;
  recordingId: string;
  /** UTC epoch milliseconds when orderly shutdown completed. */
  endedAt: number;
  status: 'CLEAN';
  counts: MarketRecordingCounts;
  /** Includes the header, data records, and this footer. */
  finalFileRecordCount: number;
  shutdownReason?: string;
}

export type RecordingRecord =
  | MarketRecordingHeaderRecord
  | MarketDataRecordingRecord
  | LegacyRecordingRecord
  | MarketRecordingSessionEndRecord;

export interface MarketRecordingSummary {
  formatType: MarketRecordingFormatType;
  schemaVersion?: typeof MARKET_RECORDING_SCHEMA_VERSION;
  sourceSessionId?: string;
  recordingId?: string;
  startedAt?: number;
  endedAt?: number;
  termination: 'CLEAN' | 'INCOMPLETE';
  instruments: MarketInstrumentConfig[];
  subscriptions?: MarketRecordingSubscriptions;
  counts: MarketRecordingCounts;
  finalFileRecordCount: number;
}
