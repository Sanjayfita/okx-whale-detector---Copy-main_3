import { isValidRuntimeSessionId } from '../runtime/runtimeSession';
import type { MarketInstrumentConfig } from '../types/instrument';
import {
  MARKET_RECORDING_CLOCK_BASIS,
  MARKET_RECORDING_SCHEMA_VERSION,
  type LegacyRecordingRecord,
  type MarketDataRecordingRecord,
  type MarketRecordingCounts,
  type MarketRecordingHeaderRecord,
  type MarketRecordingSessionEndRecord,
  type MarketRecordingSummary,
  type RecordingRecord,
} from './marketRecordingFormat';

const EARLIEST_PLAUSIBLE_TIMESTAMP = Date.UTC(2000, 0, 1);
const DEFAULT_FUTURE_ALLOWANCE_MS = 24 * 60 * 60 * 1_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const requireLegacyRecordedAt = (value: Record<string, unknown>): void => {
  if (
    typeof value.recordedAt !== 'number' ||
    !Number.isFinite(value.recordedAt)
  ) {
    throw new Error('Invalid recording timestamp');
  }
};

export const validateUtcEpochMilliseconds = (
  value: unknown,
  fieldName: string,
  now = Date.now(),
  futureAllowanceMs = DEFAULT_FUTURE_ALLOWANCE_MS,
): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < EARLIEST_PLAUSIBLE_TIMESTAMP
  ) {
    throw new Error(`${fieldName} must be plausible UTC epoch milliseconds`);
  }

  if (value > now + futureAllowanceMs) {
    throw new Error(`${fieldName} is unreasonably far in the future`);
  }

  return value;
};

const validateIdentifier = (
  value: unknown,
  fieldName: string,
  maximumLength: number,
  pattern: RegExp,
): string => {
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    !pattern.test(value)
  ) {
    throw new Error(`Invalid ${fieldName}`);
  }

  return value;
};

const validateInstrument = (
  value: unknown,
  fieldName = 'recorded instrument',
): MarketInstrumentConfig => {
  if (
    !isRecord(value) ||
    typeof value.instId !== 'string' ||
    value.instId.trim().length === 0 ||
    (value.instType !== 'SPOT' && value.instType !== 'SWAP') ||
    value.quoteCurrency !== 'USDT' ||
    typeof value.baseUnitsPerSize !== 'number' ||
    !Number.isFinite(value.baseUnitsPerSize) ||
    value.baseUnitsPerSize <= 0
  ) {
    throw new Error(`Invalid ${fieldName}`);
  }

  return value as unknown as MarketInstrumentConfig;
};

const validateInstruments = (value: unknown): MarketInstrumentConfig[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Recording header must declare at least one instrument');
  }

  const instruments = value.map((instrument) =>
    validateInstrument(instrument, 'header instrument'),
  );
  const identifiers = new Set<string>();

  for (const instrument of instruments) {
    if (identifiers.has(instrument.instId)) {
      throw new Error(
        `Duplicate recording instrument declaration: ${instrument.instId}`,
      );
    }

    identifiers.add(instrument.instId);
  }

  return instruments;
};

const validateSubscriptions = (
  value: unknown,
): MarketRecordingHeaderRecord['subscriptions'] => {
  if (
    !isRecord(value) ||
    typeof value.orderBookChannel !== 'string' ||
    value.orderBookChannel.trim().length === 0 ||
    !Number.isSafeInteger(value.orderBookDepth) ||
    (value.orderBookDepth as number) <= 0 ||
    !Array.isArray(value.candleIntervals) ||
    value.candleIntervals.length === 0 ||
    value.candleIntervals.some(
      (interval) =>
        typeof interval !== 'string' || interval.trim().length === 0,
    )
  ) {
    throw new Error('Invalid recording subscription metadata');
  }

  const intervals = value.candleIntervals as string[];
  if (new Set(intervals).size !== intervals.length) {
    throw new Error('Duplicate declared candle interval');
  }

  return value as unknown as MarketRecordingHeaderRecord['subscriptions'];
};

const validateHeader = (
  value: Record<string, unknown>,
  now: number,
  futureAllowanceMs: number,
): MarketRecordingHeaderRecord => {
  if (value.schemaVersion !== MARKET_RECORDING_SCHEMA_VERSION) {
    throw new Error('Unsupported market recording schema version');
  }

  validateUtcEpochMilliseconds(
    value.recordedAt,
    'header.recordedAt',
    now,
    futureAllowanceMs,
  );
  validateUtcEpochMilliseconds(
    value.startedAt,
    'header.startedAt',
    now,
    futureAllowanceMs,
  );

  if (!isValidRuntimeSessionId(value.sourceSessionId)) {
    throw new Error('Invalid header sourceSessionId');
  }

  validateIdentifier(
    value.recordingId,
    'header recordingId',
    256,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/,
  );

  if (
    !isRecord(value.producer) ||
    typeof value.producer.name !== 'string' ||
    value.producer.name.trim().length === 0 ||
    typeof value.producer.version !== 'string' ||
    value.producer.version.trim().length === 0
  ) {
    throw new Error('Invalid recording producer metadata');
  }

  if (
    !isRecord(value.clockBasis) ||
    value.clockBasis.eventTime !== MARKET_RECORDING_CLOCK_BASIS.eventTime ||
    value.clockBasis.availabilityTime !==
      MARKET_RECORDING_CLOCK_BASIS.availabilityTime ||
    value.clockBasis.arrivalOrder !== MARKET_RECORDING_CLOCK_BASIS.arrivalOrder
  ) {
    throw new Error('Invalid recording clock-basis metadata');
  }

  validateInstruments(value.instruments);
  validateSubscriptions(value.subscriptions);

  return value as unknown as MarketRecordingHeaderRecord;
};

export const validateMarketRecordingHeaderRecord = (
  value: unknown,
  now = Date.now(),
  futureAllowanceMs = DEFAULT_FUTURE_ALLOWANCE_MS,
): MarketRecordingHeaderRecord => {
  if (!isRecord(value) || value.recordType !== 'header') {
    throw new Error('Invalid market recording header');
  }

  return validateHeader(value, now, futureAllowanceMs);
};

const validateOrderBookLevel = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every((part) => typeof part === 'string');

const validateDataRecord = (
  value: Record<string, unknown>,
  header: MarketRecordingHeaderRecord,
  now: number,
  futureAllowanceMs: number,
): MarketDataRecordingRecord => {
  validateUtcEpochMilliseconds(
    value.recordedAt,
    `${String(value.type)}.recordedAt`,
    now,
    futureAllowanceMs,
  );

  const declaredInstruments = new Map(
    header.instruments.map((instrument) => [instrument.instId, instrument]),
  );

  if (value.type === 'instrument') {
    const instrument = validateInstrument(value.instrument);
    const declared = declaredInstruments.get(instrument.instId);

    if (
      !declared ||
      declared.instType !== instrument.instType ||
      declared.quoteCurrency !== instrument.quoteCurrency ||
      declared.baseUnitsPerSize !== instrument.baseUnitsPerSize
    ) {
      throw new Error(
        `Instrument record does not match header: ${instrument.instId}`,
      );
    }

    return value as unknown as MarketDataRecordingRecord;
  }

  if (value.type === 'orderBook') {
    if (
      !isRecord(value.update) ||
      typeof value.update.instId !== 'string' ||
      !declaredInstruments.has(value.update.instId) ||
      (value.update.action !== 'snapshot' &&
        value.update.action !== 'update') ||
      !Array.isArray(value.update.bids) ||
      !value.update.bids.every(validateOrderBookLevel) ||
      !Array.isArray(value.update.asks) ||
      !value.update.asks.every(validateOrderBookLevel) ||
      !Number.isSafeInteger(value.update.seqId) ||
      !Number.isSafeInteger(value.update.prevSeqId)
    ) {
      throw new Error('Invalid versioned order-book record');
    }

    validateUtcEpochMilliseconds(
      value.update.timestamp,
      'orderBook.update.timestamp',
      now,
      futureAllowanceMs,
    );

    return value as unknown as MarketDataRecordingRecord;
  }

  if (value.type !== 'candle') {
    throw new Error('Invalid recording record type');
  }

  if (
    typeof value.interval !== 'string' ||
    !header.subscriptions.candleIntervals.includes(value.interval)
  ) {
    throw new Error('Candle interval was not declared in the header');
  }

  if (
    !isRecord(value.candle) ||
    typeof value.candle.instId !== 'string' ||
    !declaredInstruments.has(value.candle.instId) ||
    typeof value.candle.open !== 'number' ||
    !Number.isFinite(value.candle.open) ||
    typeof value.candle.high !== 'number' ||
    !Number.isFinite(value.candle.high) ||
    typeof value.candle.low !== 'number' ||
    !Number.isFinite(value.candle.low) ||
    typeof value.candle.close !== 'number' ||
    !Number.isFinite(value.candle.close) ||
    typeof value.candle.volume !== 'number' ||
    !Number.isFinite(value.candle.volume) ||
    typeof value.candle.volumeCurrency !== 'number' ||
    !Number.isFinite(value.candle.volumeCurrency) ||
    typeof value.candle.volumeCurrencyQuote !== 'number' ||
    !Number.isFinite(value.candle.volumeCurrencyQuote) ||
    typeof value.candle.confirm !== 'boolean'
  ) {
    throw new Error('Invalid versioned candle record');
  }

  validateUtcEpochMilliseconds(
    value.candle.timestamp,
    'candle.timestamp',
    now,
    futureAllowanceMs,
  );

  return value as unknown as MarketDataRecordingRecord;
};

const validateCounts = (value: unknown): MarketRecordingCounts => {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.instrumentRecords) ||
    (value.instrumentRecords as number) < 0 ||
    !Number.isSafeInteger(value.orderBookRecords) ||
    (value.orderBookRecords as number) < 0 ||
    !Number.isSafeInteger(value.candleRecords) ||
    (value.candleRecords as number) < 0
  ) {
    throw new Error('Invalid market recording footer counts');
  }

  return value as unknown as MarketRecordingCounts;
};

const validateSessionEnd = (
  value: Record<string, unknown>,
  header: MarketRecordingHeaderRecord,
  counts: MarketRecordingCounts,
  recordOrdinal: number,
  now: number,
  futureAllowanceMs: number,
): MarketRecordingSessionEndRecord => {
  if (
    value.schemaVersion !== MARKET_RECORDING_SCHEMA_VERSION ||
    value.sourceSessionId !== header.sourceSessionId ||
    value.recordingId !== header.recordingId ||
    value.status !== 'CLEAN'
  ) {
    throw new Error('Market recording footer does not match its header');
  }

  validateUtcEpochMilliseconds(
    value.recordedAt,
    'sessionEnd.recordedAt',
    now,
    futureAllowanceMs,
  );
  validateUtcEpochMilliseconds(
    value.endedAt,
    'sessionEnd.endedAt',
    now,
    futureAllowanceMs,
  );

  const footerCounts = validateCounts(value.counts);
  if (
    footerCounts.instrumentRecords !== counts.instrumentRecords ||
    footerCounts.orderBookRecords !== counts.orderBookRecords ||
    footerCounts.candleRecords !== counts.candleRecords
  ) {
    throw new Error('Market recording footer counts do not match the stream');
  }

  if (value.finalFileRecordCount !== recordOrdinal) {
    throw new Error('Market recording final file record count is invalid');
  }

  if (
    value.shutdownReason !== undefined &&
    (typeof value.shutdownReason !== 'string' ||
      value.shutdownReason.trim().length === 0)
  ) {
    throw new Error('Invalid market recording shutdown reason');
  }

  return value as unknown as MarketRecordingSessionEndRecord;
};

const parseJsonRecord = (line: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(line);

  if (!isRecord(value)) {
    throw new Error('Invalid recording record type');
  }

  return value;
};

const parseLegacyDataRecord = (
  value: Record<string, unknown>,
): LegacyRecordingRecord => {
  if (
    value.type !== 'instrument' &&
    value.type !== 'orderBook' &&
    value.type !== 'candle'
  ) {
    throw new Error('Invalid recording record type');
  }

  requireLegacyRecordedAt(value);

  if (value.type === 'instrument') {
    if (
      !isRecord(value.instrument) ||
      typeof value.instrument.instId !== 'string'
    ) {
      throw new Error('Invalid recorded instrument');
    }

    return value as unknown as LegacyRecordingRecord;
  }

  if (value.type === 'orderBook') {
    if (!isRecord(value.update) || typeof value.update.instId !== 'string') {
      throw new Error('Invalid recorded order-book update');
    }

    return value as unknown as LegacyRecordingRecord;
  }

  if (!isRecord(value.candle) || typeof value.candle.instId !== 'string') {
    throw new Error('Invalid recorded candle update');
  }

  return value as unknown as LegacyRecordingRecord;
};

/**
 * Stateless parsing retained for callers that consume legacy records one line
 * at a time. Versioned files must use MarketRecordingParser so header context
 * and footer integrity are enforced.
 */
export const parseRecordingRecord = (line: string): RecordingRecord => {
  const value = parseJsonRecord(line);

  if (value.recordType === 'header') {
    return validateHeader(value, Date.now(), DEFAULT_FUTURE_ALLOWANCE_MS);
  }

  if (value.recordType === 'sessionEnd') {
    throw new Error(
      'A market recording footer requires versioned header context',
    );
  }

  return parseLegacyDataRecord(value);
};

export interface MarketRecordingParserOptions {
  clock?: () => number;
  futureAllowanceMs?: number;
}

export class MarketRecordingParser {
  private readonly clock: () => number;
  private readonly futureAllowanceMs: number;
  private readonly counts: MarketRecordingCounts = {
    instrumentRecords: 0,
    orderBookRecords: 0,
    candleRecords: 0,
  };
  private readonly legacyInstruments = new Map<
    string,
    MarketInstrumentConfig
  >();
  private formatType?: MarketRecordingSummary['formatType'];
  private header?: MarketRecordingHeaderRecord;
  private footer?: MarketRecordingSessionEndRecord;
  private recordOrdinal = 0;

  public constructor(options: MarketRecordingParserOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.futureAllowanceMs =
      options.futureAllowanceMs ?? DEFAULT_FUTURE_ALLOWANCE_MS;
  }

  public parseLine(line: string): RecordingRecord {
    const value = parseJsonRecord(line);
    this.recordOrdinal += 1;

    if (this.footer) {
      if (value.recordType === 'sessionEnd') {
        throw new Error('Duplicate market recording footer');
      }

      throw new Error('Market recording contains records after its footer');
    }

    if (!this.formatType) {
      if (value.recordType === 'header') {
        this.header = validateHeader(
          value,
          this.clock(),
          this.futureAllowanceMs,
        );
        this.formatType = 'VERSIONED_V1';
        return this.header;
      }

      if (value.recordType !== undefined) {
        throw new Error('Versioned market recording header must be first');
      }

      this.formatType = 'LEGACY_UNVERSIONED';
      const record = parseLegacyDataRecord(value);
      this.recordLegacy(record);
      return record;
    }

    if (this.formatType === 'LEGACY_UNVERSIONED') {
      if (value.recordType === 'header') {
        throw new Error('Versioned market recording header must be first');
      }

      if (value.recordType !== undefined) {
        throw new Error('Legacy recording cannot contain a versioned footer');
      }

      const record = parseLegacyDataRecord(value);
      this.recordLegacy(record);
      return record;
    }

    if (value.recordType === 'header') {
      throw new Error('Duplicate market recording header');
    }

    if (value.recordType === 'sessionEnd') {
      this.footer = validateSessionEnd(
        value,
        this.requireHeader(),
        this.counts,
        this.recordOrdinal,
        this.clock(),
        this.futureAllowanceMs,
      );
      return this.footer;
    }

    if (value.recordType !== undefined) {
      throw new Error('Invalid versioned market recording record type');
    }

    const record = validateDataRecord(
      value,
      this.requireHeader(),
      this.clock(),
      this.futureAllowanceMs,
    );
    this.recordData(record);
    return record;
  }

  public finish(): MarketRecordingSummary {
    if (!this.formatType) {
      throw new Error('Market recording contains no records');
    }

    if (this.formatType === 'LEGACY_UNVERSIONED') {
      return {
        formatType: this.formatType,
        termination: 'INCOMPLETE',
        instruments: [...this.legacyInstruments.values()],
        counts: { ...this.counts },
        finalFileRecordCount: this.recordOrdinal,
      };
    }

    const header = this.requireHeader();
    return {
      formatType: this.formatType,
      schemaVersion: header.schemaVersion,
      sourceSessionId: header.sourceSessionId,
      recordingId: header.recordingId,
      startedAt: header.startedAt,
      endedAt: this.footer?.endedAt,
      termination: this.footer ? 'CLEAN' : 'INCOMPLETE',
      instruments: header.instruments.map((instrument) => ({ ...instrument })),
      subscriptions: {
        ...header.subscriptions,
        candleIntervals: [...header.subscriptions.candleIntervals],
      },
      counts: { ...this.counts },
      finalFileRecordCount: this.recordOrdinal,
    };
  }

  private requireHeader(): MarketRecordingHeaderRecord {
    if (!this.header) {
      throw new Error('Versioned market recording is missing its header');
    }

    return this.header;
  }

  private recordData(record: MarketDataRecordingRecord): void {
    if (record.type === 'instrument') {
      this.counts.instrumentRecords += 1;
    } else if (record.type === 'orderBook') {
      this.counts.orderBookRecords += 1;
    } else {
      this.counts.candleRecords += 1;
    }
  }

  private recordLegacy(record: LegacyRecordingRecord): void {
    if (record.type === 'instrument') {
      this.counts.instrumentRecords += 1;
      this.legacyInstruments.set(record.instrument.instId, record.instrument);
    } else if (record.type === 'orderBook') {
      this.counts.orderBookRecords += 1;
    } else {
      this.counts.candleRecords += 1;
    }
  }
}
