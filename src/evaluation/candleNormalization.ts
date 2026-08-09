import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type {
  MarketRecordingHeaderRecord,
  MarketRecordingSessionEndRecord,
  VersionedCandleRecordingRecord,
} from '../recording/marketRecordingFormat';
import {
  MarketRecordingParser,
  type MarketRecordingParserOptions,
} from '../recording/recordingValidation';
import type { MarketInstrumentConfig } from '../types/instrument';
import type { AlignmentConfigurationV1 } from './alignmentConfiguration';
import { DEFAULT_ALIGNMENT_CONFIGURATION } from './alignmentConfiguration';
import {
  AlignmentReason,
  alignmentFailure,
  alignmentSuccess,
  type AlignmentValidationResult,
  type InstrumentKey,
  type PriceObservation,
} from './alignmentTypes';
import {
  createInstrumentKey,
  serializeInstrumentKey,
  validateAlignmentTimestamp,
} from './alignmentValidation';

export const CONFIRMED_CANDLE_INTERVALS = {
  '1m': 60_000,
} as const;

export type SupportedConfirmedCandleInterval =
  keyof typeof CONFIRMED_CANDLE_INTERVALS;

export interface ParsedConfirmedCandleInterval {
  interval: SupportedConfirmedCandleInterval;
  durationMs: number;
}

export interface NormalizedConfirmedCandle {
  instrument: InstrumentKey;
  interval: SupportedConfirmedCandleInterval;
  intervalStart: number;
  intervalEnd: number;
  /** Candle market event time; always equal to intervalEnd. */
  eventTimestamp: number;
  /** First valid availability: max(recordedAt, intervalEnd). */
  availabilityTimestamp: number;
  recordedAt: number;
  recordOrdinal: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  sourceSessionId: string;
  recordingId: string;
}

export interface ConfirmedCandleDuplicateGroup {
  instrument: InstrumentKey;
  interval: SupportedConfirmedCandleInterval;
  intervalStart: number;
  firstRecordOrdinal: number;
  identicalDuplicateCount: number;
  conflictingRecordOrdinals: readonly number[];
}

export interface NormalizedCandleRecording {
  header: MarketRecordingHeaderRecord;
  footer: MarketRecordingSessionEndRecord | null;
  termination: 'CLEAN' | 'TRUNCATED';
  confirmedCandles: readonly NormalizedConfirmedCandle[];
  formingCandleCount: number;
  identicalDuplicateCount: number;
  duplicateGroups: readonly ConfirmedCandleDuplicateGroup[];
  finalFileRecordCount: number;
}

export interface CandleNormalizationOptions {
  configuration?: AlignmentConfigurationV1;
  now?: number;
  parserOptions?: MarketRecordingParserOptions;
}

export const parseConfirmedCandleInterval = (
  value: unknown,
): AlignmentValidationResult<ParsedConfirmedCandleInterval> => {
  if (typeof value !== 'string' || !/^[1-9]\d*[a-zA-Z]+$/.test(value)) {
    return alignmentFailure(AlignmentReason.CANDLE_INTERVAL_UNKNOWN);
  }

  if (!(value in CONFIRMED_CANDLE_INTERVALS)) {
    return alignmentFailure(AlignmentReason.CANDLE_INTERVAL_UNKNOWN);
  }

  const interval = value as SupportedConfirmedCandleInterval;
  const durationMs = CONFIRMED_CANDLE_INTERVALS[interval];

  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    return alignmentFailure(AlignmentReason.CANDLE_INTERVAL_UNKNOWN);
  }

  return alignmentSuccess({ interval, durationMs });
};

const isPositiveFinite = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

const normalizeConfirmedCandle = (
  record: VersionedCandleRecordingRecord,
  recordOrdinal: number,
  header: MarketRecordingHeaderRecord,
  configuration: AlignmentConfigurationV1,
  now: number,
): AlignmentValidationResult<NormalizedConfirmedCandle | null> => {
  const intervalResult = parseConfirmedCandleInterval(record.interval);
  if (!intervalResult.valid) {
    return intervalResult;
  }

  if (!header.subscriptions.candleIntervals.includes(record.interval)) {
    return alignmentFailure(AlignmentReason.CANDLE_INTERVAL_UNKNOWN, 'MISSING');
  }

  const matchingInstruments = header.instruments.filter(
    (instrument) => instrument.instId === record.candle.instId,
  );
  if (matchingInstruments.length === 0) {
    return alignmentFailure(AlignmentReason.INSTRUMENT_MISMATCH, 'MISSING');
  }
  if (matchingInstruments.length > 1) {
    return alignmentFailure(
      AlignmentReason.INSTRUMENT_METADATA_CONFLICT,
      'AMBIGUOUS',
    );
  }

  const instrument = matchingInstruments[0];
  if (!instrument) {
    return alignmentFailure(AlignmentReason.INSTRUMENT_METADATA_MISSING);
  }

  const intervalStartResult = validateAlignmentTimestamp(
    record.candle.timestamp,
    configuration,
    now,
  );
  if (!intervalStartResult.valid) {
    return intervalStartResult;
  }
  const recordedAtResult = validateAlignmentTimestamp(
    record.recordedAt,
    configuration,
    now,
  );
  if (!recordedAtResult.valid) {
    return recordedAtResult;
  }

  const intervalEnd =
    intervalStartResult.value + intervalResult.value.durationMs;
  if (
    !Number.isSafeInteger(intervalEnd) ||
    intervalEnd <= intervalStartResult.value
  ) {
    return alignmentFailure(AlignmentReason.TIMESTAMP_RANGE_INVALID);
  }

  const intervalEndResult = validateAlignmentTimestamp(
    intervalEnd,
    configuration,
    now,
  );
  if (!intervalEndResult.valid) {
    return intervalEndResult;
  }

  if (
    !isPositiveFinite(record.candle.open) ||
    !isPositiveFinite(record.candle.high) ||
    !isPositiveFinite(record.candle.low) ||
    !isPositiveFinite(record.candle.close) ||
    record.candle.high < record.candle.open ||
    record.candle.high < record.candle.low ||
    record.candle.high < record.candle.close ||
    record.candle.low > record.candle.open ||
    record.candle.low > record.candle.high ||
    record.candle.low > record.candle.close
  ) {
    return alignmentFailure(AlignmentReason.BOOK_INVALID);
  }

  if (!record.candle.confirm) {
    return alignmentSuccess(null);
  }

  const normalized: NormalizedConfirmedCandle = {
    instrument: createInstrumentKey(instrument.instId, instrument.instType),
    interval: intervalResult.value.interval,
    intervalStart: intervalStartResult.value,
    intervalEnd: intervalEndResult.value,
    eventTimestamp: intervalEndResult.value,
    availabilityTimestamp: Math.max(
      recordedAtResult.value,
      intervalEndResult.value,
    ),
    recordedAt: recordedAtResult.value,
    recordOrdinal,
    open: record.candle.open,
    high: record.candle.high,
    low: record.candle.low,
    close: record.candle.close,
    volume: Number.isFinite(record.candle.volume)
      ? record.candle.volume
      : undefined,
    sourceSessionId: header.sourceSessionId,
    recordingId: header.recordingId,
  };

  return alignmentSuccess(Object.freeze(normalized));
};

const marketValuesEqual = (
  left: NormalizedConfirmedCandle,
  right: NormalizedConfirmedCandle,
): boolean =>
  left.open === right.open &&
  left.high === right.high &&
  left.low === right.low &&
  left.close === right.close &&
  left.volume === right.volume;

export const createConfirmedCandleIdentity = (
  candle: Pick<
    NormalizedConfirmedCandle,
    'instrument' | 'interval' | 'intervalStart'
  >,
): string =>
  `${serializeInstrumentKey(candle.instrument)}\u001f${candle.interval}\u001f${candle.intervalStart}`;

const mapParserError = (
  error: unknown,
): ReturnType<typeof alignmentFailure> => {
  const message = error instanceof Error ? error.message : String(error);

  if (/interval/i.test(message)) {
    return alignmentFailure(AlignmentReason.CANDLE_INTERVAL_UNKNOWN);
  }
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

export const normalizeVersionedCandleRecordingLines = (
  lines: Iterable<string>,
  options: CandleNormalizationOptions = {},
): AlignmentValidationResult<NormalizedCandleRecording> => {
  const configuration =
    options.configuration ?? DEFAULT_ALIGNMENT_CONFIGURATION;
  const now = options.now ?? Date.now();
  const parser = new MarketRecordingParser({
    clock: () => now,
    ...options.parserOptions,
  });
  const confirmedByIdentity = new Map<string, NormalizedConfirmedCandle>();
  const duplicateState = new Map<
    string,
    {
      candle: NormalizedConfirmedCandle;
      identicalDuplicateCount: number;
      conflictingRecordOrdinals: number[];
    }
  >();
  let header: MarketRecordingHeaderRecord | undefined;
  let footer: MarketRecordingSessionEndRecord | undefined;
  let formingCandleCount = 0;
  let identicalDuplicateCount = 0;
  let recordOrdinal = 0;

  try {
    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      recordOrdinal += 1;
      const record = parser.parseLine(line);

      if (recordOrdinal === 1 && !('recordType' in record)) {
        return alignmentFailure(
          AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
          'MISSING',
        );
      }

      if ('recordType' in record && record.recordType === 'header') {
        header = record;
        continue;
      }
      if ('recordType' in record && record.recordType === 'sessionEnd') {
        footer = record;
        continue;
      }
      if (record.type !== 'candle') {
        continue;
      }
      if (!header || !('interval' in record)) {
        return alignmentFailure(
          AlignmentReason.CANDLE_INTERVAL_UNKNOWN,
          'MISSING',
        );
      }

      const normalizedResult = normalizeConfirmedCandle(
        record,
        recordOrdinal,
        header,
        configuration,
        now,
      );
      if (!normalizedResult.valid) {
        return normalizedResult;
      }
      if (!normalizedResult.value) {
        formingCandleCount += 1;
        continue;
      }

      const normalized = normalizedResult.value;
      const identity = createConfirmedCandleIdentity(normalized);
      const existing = duplicateState.get(identity);

      if (!existing) {
        confirmedByIdentity.set(identity, normalized);
        duplicateState.set(identity, {
          candle: normalized,
          identicalDuplicateCount: 0,
          conflictingRecordOrdinals: [],
        });
        continue;
      }

      if (marketValuesEqual(existing.candle, normalized)) {
        existing.identicalDuplicateCount += 1;
        identicalDuplicateCount += 1;
      } else {
        existing.conflictingRecordOrdinals.push(normalized.recordOrdinal);
      }
    }

    const summary = parser.finish();
    if (summary.formatType !== 'VERSIONED_V1' || !header) {
      return alignmentFailure(
        AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
        'MISSING',
      );
    }

    const recordingEndedAt = footer?.endedAt;
    if (
      recordingEndedAt !== undefined &&
      (recordingEndedAt < header.startedAt ||
        [...confirmedByIdentity.values()].some(
          (candle) => candle.availabilityTimestamp > recordingEndedAt,
        ))
    ) {
      return alignmentFailure(AlignmentReason.EVENT_TIME_OUT_OF_ORDER);
    }

    const confirmedCandles = [...confirmedByIdentity.values()].sort(
      (left, right) =>
        left.eventTimestamp - right.eventTimestamp ||
        left.availabilityTimestamp - right.availabilityTimestamp ||
        left.recordOrdinal - right.recordOrdinal,
    );
    const duplicateGroups = [...duplicateState.values()]
      .filter(
        (state) =>
          state.identicalDuplicateCount > 0 ||
          state.conflictingRecordOrdinals.length > 0,
      )
      .map((state): ConfirmedCandleDuplicateGroup => ({
        instrument: state.candle.instrument,
        interval: state.candle.interval,
        intervalStart: state.candle.intervalStart,
        firstRecordOrdinal: state.candle.recordOrdinal,
        identicalDuplicateCount: state.identicalDuplicateCount,
        conflictingRecordOrdinals: Object.freeze([
          ...state.conflictingRecordOrdinals,
        ]),
      }))
      .sort(
        (left, right) =>
          left.intervalStart - right.intervalStart ||
          serializeInstrumentKey(left.instrument).localeCompare(
            serializeInstrumentKey(right.instrument),
          ) ||
          left.interval.localeCompare(right.interval),
      );

    return alignmentSuccess({
      header,
      footer: footer ?? null,
      termination: footer ? 'CLEAN' : 'TRUNCATED',
      confirmedCandles: Object.freeze(confirmedCandles),
      formingCandleCount,
      identicalDuplicateCount,
      duplicateGroups: Object.freeze(duplicateGroups),
      finalFileRecordCount: summary.finalFileRecordCount,
    });
  } catch (error: unknown) {
    return mapParserError(error);
  }
};

export class ConfirmedCandleRecordingReader {
  public async read(
    filePath: string,
    options: CandleNormalizationOptions = {},
  ): Promise<AlignmentValidationResult<NormalizedCandleRecording>> {
    const input = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    const lines: string[] = [];

    for await (const line of input) {
      lines.push(line);
    }

    return normalizeVersionedCandleRecordingLines(lines, options);
  }
}

export const toConfirmedCandlePriceObservation = (
  candle: NormalizedConfirmedCandle,
): PriceObservation => ({
  instrument: candle.instrument,
  source: 'CONFIRMED_CANDLE_CLOSE',
  eventTimestamp: candle.eventTimestamp,
  availabilityTimestamp: candle.availabilityTimestamp,
  recordOrdinal: candle.recordOrdinal,
  close: candle.close,
  intervalStart: candle.intervalStart,
  intervalEnd: candle.intervalEnd,
  recordingId: candle.recordingId,
  sourceSessionId: candle.sourceSessionId,
});

export const findHeaderInstrument = (
  header: MarketRecordingHeaderRecord,
  instrument: InstrumentKey,
): MarketInstrumentConfig | undefined =>
  header.instruments.find(
    (candidate) =>
      candidate.instId === instrument.instId &&
      candidate.instType === instrument.instType,
  );
