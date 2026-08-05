import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type {
  MarketRecordingHeaderRecord,
  MarketRecordingSessionEndRecord,
  OrderBookRecordingRecord,
} from '../recording/marketRecordingFormat';
import {
  MarketRecordingParser,
  type MarketRecordingParserOptions,
} from '../recording/recordingValidation';
import type { AlignmentConfigurationV1 } from './alignmentConfiguration';
import { DEFAULT_ALIGNMENT_CONFIGURATION } from './alignmentConfiguration';
import {
  AlignmentReason,
  alignmentFailure,
  alignmentSuccess,
  type AlignmentValidationFailure,
  type AlignmentValidationResult,
  type InstrumentKey,
} from './alignmentTypes';
import {
  createInstrumentKey,
  validateTimestampOrdering,
} from './alignmentValidation';

export interface NormalizedBookLevel {
  price: number;
  size: number;
  liquidatedOrders?: number;
  orderCount?: number;
}

export interface NormalizedOrderBookRecord {
  instrument: InstrumentKey;
  action: 'snapshot' | 'update';
  bids: readonly NormalizedBookLevel[];
  asks: readonly NormalizedBookLevel[];
  eventTimestamp: number;
  availabilityTimestamp: number;
  recordedAt: number;
  seqId: number;
  prevSeqId: number;
  recordOrdinal: number;
  sourceSessionId: string;
  recordingId: string;
}

export interface InvalidNormalizedOrderBookRecord {
  valid: false;
  instrument: InstrumentKey | null;
  action: 'snapshot' | 'update';
  eventTimestamp: number | null;
  availabilityTimestamp: number | null;
  seqId: number | null;
  prevSeqId: number | null;
  recordOrdinal: number;
  failure: AlignmentValidationFailure;
}

export interface ValidNormalizedOrderBookRecord {
  valid: true;
  record: NormalizedOrderBookRecord;
}

export type NormalizedOrderBookEntry =
  ValidNormalizedOrderBookRecord | InvalidNormalizedOrderBookRecord;

export interface NormalizedOrderBookRecording {
  header: MarketRecordingHeaderRecord;
  footer: MarketRecordingSessionEndRecord | null;
  termination: 'CLEAN' | 'TRUNCATED';
  entries: readonly NormalizedOrderBookEntry[];
  records: readonly NormalizedOrderBookRecord[];
  finalFileRecordCount: number;
}

export interface OrderBookNormalizationOptions {
  configuration?: AlignmentConfigurationV1;
  now?: number;
  parserOptions?: MarketRecordingParserOptions;
}

const normalizeLevel = (
  level: readonly string[],
): AlignmentValidationResult<NormalizedBookLevel> => {
  const price = Number(level[0]);
  const size = Number(level[1]);
  const liquidatedOrders = Number(level[2]);
  const orderCount = Number(level[3]);

  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(size) ||
    size < 0 ||
    !Number.isFinite(liquidatedOrders) ||
    liquidatedOrders < 0 ||
    !Number.isFinite(orderCount) ||
    orderCount < 0
  ) {
    return alignmentFailure(AlignmentReason.BOOK_INVALID);
  }

  return alignmentSuccess({
    price,
    size,
    liquidatedOrders,
    orderCount,
  });
};

const normalizeLevels = (
  levels: readonly (readonly string[])[],
): AlignmentValidationResult<readonly NormalizedBookLevel[]> => {
  const normalized: NormalizedBookLevel[] = [];

  for (const level of levels) {
    const result = normalizeLevel(level);
    if (!result.valid) {
      return result;
    }
    normalized.push(result.value);
  }

  return alignmentSuccess(Object.freeze(normalized));
};

const invalidEntry = (
  record: OrderBookRecordingRecord,
  recordOrdinal: number,
  instrument: InstrumentKey | null,
  failure: AlignmentValidationFailure,
): InvalidNormalizedOrderBookRecord => ({
  valid: false,
  instrument,
  action: record.update.action,
  eventTimestamp: Number.isSafeInteger(record.update.timestamp)
    ? record.update.timestamp
    : null,
  availabilityTimestamp: Number.isSafeInteger(record.recordedAt)
    ? record.recordedAt
    : null,
  seqId: Number.isSafeInteger(record.update.seqId) ? record.update.seqId : null,
  prevSeqId: Number.isSafeInteger(record.update.prevSeqId)
    ? record.update.prevSeqId
    : null,
  recordOrdinal,
  failure,
});

const normalizeRecord = (
  record: OrderBookRecordingRecord,
  recordOrdinal: number,
  header: MarketRecordingHeaderRecord,
  configuration: AlignmentConfigurationV1,
  now: number,
): NormalizedOrderBookEntry => {
  const matching = header.instruments.filter(
    (instrument) => instrument.instId === record.update.instId,
  );
  if (matching.length === 0) {
    return invalidEntry(
      record,
      recordOrdinal,
      null,
      alignmentFailure(AlignmentReason.INSTRUMENT_MISMATCH, 'MISSING'),
    );
  }
  if (matching.length > 1) {
    return invalidEntry(
      record,
      recordOrdinal,
      null,
      alignmentFailure(
        AlignmentReason.INSTRUMENT_METADATA_CONFLICT,
        'AMBIGUOUS',
      ),
    );
  }

  const metadata = matching[0];
  if (!metadata) {
    return invalidEntry(
      record,
      recordOrdinal,
      null,
      alignmentFailure(AlignmentReason.INSTRUMENT_METADATA_MISSING),
    );
  }
  const instrument = createInstrumentKey(metadata.instId, metadata.instType);
  const timestampResult = validateTimestampOrdering(
    record.update.timestamp,
    record.recordedAt,
    configuration,
    now,
  );
  if (!timestampResult.valid) {
    return invalidEntry(record, recordOrdinal, instrument, timestampResult);
  }

  if (
    !Number.isSafeInteger(record.update.seqId) ||
    record.update.seqId < 0 ||
    !Number.isSafeInteger(record.update.prevSeqId) ||
    record.update.prevSeqId < -1 ||
    (record.update.action === 'update' && record.update.prevSeqId < 0)
  ) {
    return invalidEntry(
      record,
      recordOrdinal,
      instrument,
      alignmentFailure(AlignmentReason.EVENT_TIME_OUT_OF_ORDER),
    );
  }

  const bidsResult = normalizeLevels(record.update.bids);
  if (!bidsResult.valid) {
    return invalidEntry(record, recordOrdinal, instrument, bidsResult);
  }
  const asksResult = normalizeLevels(record.update.asks);
  if (!asksResult.valid) {
    return invalidEntry(record, recordOrdinal, instrument, asksResult);
  }

  return {
    valid: true,
    record: Object.freeze({
      instrument,
      action: record.update.action,
      bids: bidsResult.value,
      asks: asksResult.value,
      eventTimestamp: timestampResult.value.eventTimestamp,
      availabilityTimestamp: timestampResult.value.availabilityTimestamp,
      recordedAt: timestampResult.value.availabilityTimestamp,
      seqId: record.update.seqId,
      prevSeqId: record.update.prevSeqId,
      recordOrdinal,
      sourceSessionId: header.sourceSessionId,
      recordingId: header.recordingId,
    }),
  };
};

const mapParserError = (error: unknown): AlignmentValidationFailure => {
  const message = error instanceof Error ? error.message : String(error);

  if (/after its footer|Duplicate market recording footer/i.test(message)) {
    return alignmentFailure(AlignmentReason.EVENT_TIME_OUT_OF_ORDER);
  }
  if (/instrument/i.test(message)) {
    return alignmentFailure(AlignmentReason.INSTRUMENT_METADATA_CONFLICT);
  }
  if (/timestamp|future/i.test(message)) {
    return alignmentFailure(AlignmentReason.TIMESTAMP_RANGE_INVALID);
  }
  if (/header|session|recordingId|footer/i.test(message)) {
    return alignmentFailure(AlignmentReason.NO_MATCHING_MARKET_SESSION);
  }

  return alignmentFailure(AlignmentReason.BOOK_INVALID);
};

export const normalizeVersionedOrderBookRecordingLines = (
  lines: Iterable<string>,
  options: OrderBookNormalizationOptions = {},
): AlignmentValidationResult<NormalizedOrderBookRecording> => {
  const configuration =
    options.configuration ?? DEFAULT_ALIGNMENT_CONFIGURATION;
  const now = options.now ?? Date.now();
  const parser = new MarketRecordingParser({
    clock: () => now,
    ...options.parserOptions,
  });
  const entries: NormalizedOrderBookEntry[] = [];
  let header: MarketRecordingHeaderRecord | undefined;
  let footer: MarketRecordingSessionEndRecord | undefined;
  let recordOrdinal = 0;

  try {
    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      recordOrdinal += 1;
      const raw: unknown = JSON.parse(line);
      const rawUpdate =
        typeof raw === 'object' &&
        raw !== null &&
        'update' in raw &&
        typeof raw.update === 'object' &&
        raw.update !== null
          ? raw.update
          : undefined;
      const rawInstrumentId =
        rawUpdate &&
        'instId' in rawUpdate &&
        typeof rawUpdate.instId === 'string'
          ? rawUpdate.instId
          : undefined;
      if (
        header &&
        typeof raw === 'object' &&
        raw !== null &&
        'type' in raw &&
        raw.type === 'orderBook' &&
        rawInstrumentId !== undefined &&
        !header.instruments.some(
          (instrument) => instrument.instId === rawInstrumentId,
        )
      ) {
        return alignmentFailure(AlignmentReason.INSTRUMENT_MISMATCH, 'MISSING');
      }
      const parsed = parser.parseLine(line);

      if (recordOrdinal === 1 && !('recordType' in parsed)) {
        return alignmentFailure(
          AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
          'MISSING',
        );
      }
      if ('recordType' in parsed && parsed.recordType === 'header') {
        header = parsed;
        continue;
      }
      if ('recordType' in parsed && parsed.recordType === 'sessionEnd') {
        footer = parsed;
        continue;
      }
      if (parsed.type !== 'orderBook') {
        continue;
      }
      if (!header) {
        return alignmentFailure(
          AlignmentReason.NO_MATCHING_MARKET_SESSION,
          'MISSING',
        );
      }

      entries.push(
        normalizeRecord(parsed, recordOrdinal, header, configuration, now),
      );
    }

    const summary = parser.finish();
    if (summary.formatType !== 'VERSIONED_V1' || !header) {
      return alignmentFailure(
        AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
        'MISSING',
      );
    }

    if (
      footer &&
      entries.some(
        (entry) =>
          entry.valid && entry.record.availabilityTimestamp > footer!.endedAt,
      )
    ) {
      return alignmentFailure(AlignmentReason.EVENT_TIME_OUT_OF_ORDER);
    }

    return alignmentSuccess({
      header,
      footer: footer ?? null,
      termination: footer ? 'CLEAN' : 'TRUNCATED',
      entries: Object.freeze(entries),
      records: Object.freeze(
        entries
          .filter(
            (entry): entry is ValidNormalizedOrderBookRecord => entry.valid,
          )
          .map((entry) => entry.record),
      ),
      finalFileRecordCount: summary.finalFileRecordCount,
    });
  } catch (error: unknown) {
    return mapParserError(error);
  }
};

export class OrderBookRecordingReader {
  public async read(
    filePath: string,
    options: OrderBookNormalizationOptions = {},
  ): Promise<AlignmentValidationResult<NormalizedOrderBookRecording>> {
    const input = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    const lines: string[] = [];

    for await (const line of input) {
      lines.push(line);
    }

    return normalizeVersionedOrderBookRecordingLines(lines, options);
  }
}
