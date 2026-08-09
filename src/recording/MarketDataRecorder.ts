import { randomUUID } from 'node:crypto';
import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import path from 'node:path';

import type { OKXCandle } from '../clients/okx/OKXCandleWebSocketClient';
import type { OKXOrderBookUpdate } from '../clients/okx/OKXWebSocketClient';
import { isValidRuntimeSessionId } from '../runtime/runtimeSession';
import type { MarketInstrumentConfig } from '../types/instrument';
import {
  MARKET_RECORDING_CLOCK_BASIS,
  MARKET_RECORDING_SCHEMA_VERSION,
  type MarketRecordingCounts,
  type MarketRecordingHeaderRecord,
  type MarketRecordingProducer,
  type MarketRecordingSessionEndRecord,
  type RecordingRecord,
} from './marketRecordingFormat';
import {
  validateMarketRecordingHeaderRecord,
  validateUtcEpochMilliseconds,
} from './recordingValidation';

export type { RecordingRecord } from './marketRecordingFormat';

export interface MarketDataRecordWriter {
  write(line: string): void;
  close(): Promise<void>;
}

export interface MarketDataRecorderOptions {
  sourceSessionId: string;
  recordingId?: string;
  startedAt?: number;
  clock?: () => number;
  orderBookChannel: string;
  orderBookDepth: number;
  candleIntervals: readonly string[];
  producer?: MarketRecordingProducer;
  writerFactory?: (filePath: string) => MarketDataRecordWriter;
}

const DEFAULT_PRODUCER: MarketRecordingProducer = {
  name: 'okx-whale-detector',
  version: '1.0.0',
};

const isValidRecordingId = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);

class StreamMarketDataRecordWriter implements MarketDataRecordWriter {
  private readonly stream: WriteStream;
  private failure?: Error;
  private closePromise?: Promise<void>;

  public constructor(filePath: string) {
    this.stream = createWriteStream(filePath, {
      flags: 'wx',
      encoding: 'utf8',
    });
    this.stream.on('error', (error) => {
      this.failure = error;
    });
  }

  public write(line: string): void {
    if (this.failure) {
      throw this.failure;
    }

    this.stream.write(line);
  }

  public close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    if (this.failure) {
      this.closePromise = Promise.reject(this.failure);
      return this.closePromise;
    }

    this.closePromise = new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onFinish = (): void => {
        cleanup();

        if (this.failure) {
          reject(this.failure);
        } else {
          resolve();
        }
      };
      const cleanup = (): void => {
        this.stream.off('error', onError);
        this.stream.off('finish', onFinish);
      };

      this.stream.once('error', onError);
      this.stream.once('finish', onFinish);
      this.stream.end();
    });

    return this.closePromise;
  }
}

export class MarketDataRecorder {
  public readonly filePath: string;
  public readonly sourceSessionId: string;
  public readonly recordingId: string;
  public readonly header: MarketRecordingHeaderRecord;

  private readonly writer: MarketDataRecordWriter;
  private readonly clock: () => number;
  private readonly declaredCandleIntervals: ReadonlySet<string>;
  private readonly counts: MarketRecordingCounts = {
    instrumentRecords: 0,
    orderBookRecords: 0,
    candleRecords: 0,
  };
  private closed = false;
  private closePromise?: Promise<void>;

  public constructor(
    directory: string,
    instruments: readonly MarketInstrumentConfig[],
    options: MarketDataRecorderOptions,
  ) {
    this.validateOptions(directory, instruments, options);

    this.clock = options.clock ?? Date.now;
    const startedAt = options.startedAt ?? this.clock();
    const headerRecordedAt = this.clock();
    this.sourceSessionId = options.sourceSessionId;
    this.recordingId =
      options.recordingId ??
      `market-recording:${this.sourceSessionId}:${randomUUID()}`;
    this.declaredCandleIntervals = new Set(options.candleIntervals);

    if (!isValidRecordingId(this.recordingId)) {
      throw new Error('recordingId must contain 1-256 identifier characters');
    }
    this.header = {
      recordType: 'header',
      schemaVersion: MARKET_RECORDING_SCHEMA_VERSION,
      recordedAt: headerRecordedAt,
      sourceSessionId: this.sourceSessionId,
      recordingId: this.recordingId,
      startedAt,
      producer: { ...(options.producer ?? DEFAULT_PRODUCER) },
      clockBasis: MARKET_RECORDING_CLOCK_BASIS,
      instruments: instruments.map((instrument) => ({ ...instrument })),
      subscriptions: {
        orderBookChannel: options.orderBookChannel,
        orderBookDepth: options.orderBookDepth,
        candleIntervals: [...options.candleIntervals],
      },
    };
    validateMarketRecordingHeaderRecord(this.header, headerRecordedAt);

    mkdirSync(directory, { recursive: true });

    const timestamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
    this.filePath = path.join(directory, `okx-session-${timestamp}.ndjson`);
    this.writer =
      options.writerFactory?.(this.filePath) ??
      new StreamMarketDataRecordWriter(this.filePath);

    this.writeRecord(this.header);

    for (const instrument of instruments) {
      this.writeRecord({
        type: 'instrument',
        recordedAt: headerRecordedAt,
        instrument: { ...instrument },
      });
      this.counts.instrumentRecords += 1;
    }
  }

  public recordOrderBook(update: OKXOrderBookUpdate): void {
    this.ensureOpen();
    this.writeRecord({
      type: 'orderBook',
      recordedAt: this.clock(),
      update,
    });
    this.counts.orderBookRecords += 1;
  }

  public recordCandle(candle: OKXCandle, interval: string): void {
    this.ensureOpen();

    if (!this.declaredCandleIntervals.has(interval)) {
      throw new Error(`Candle interval ${interval} was not declared`);
    }

    this.writeRecord({
      type: 'candle',
      recordedAt: this.clock(),
      interval,
      candle,
    });
    this.counts.candleRecords += 1;
  }

  public close(shutdownReason = 'APPLICATION_CLOSE'): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closed = true;

    try {
      const endedAt = this.clock();
      validateUtcEpochMilliseconds(endedAt, 'sessionEnd.endedAt', endedAt);
      const footer: MarketRecordingSessionEndRecord = {
        recordType: 'sessionEnd',
        schemaVersion: MARKET_RECORDING_SCHEMA_VERSION,
        recordedAt: endedAt,
        sourceSessionId: this.sourceSessionId,
        recordingId: this.recordingId,
        endedAt,
        status: 'CLEAN',
        counts: { ...this.counts },
        finalFileRecordCount:
          2 +
          this.counts.instrumentRecords +
          this.counts.orderBookRecords +
          this.counts.candleRecords,
        shutdownReason,
      };

      this.writeRecord(footer);
      this.closePromise = this.writer.close();
    } catch (error: unknown) {
      this.closePromise = this.writer.close().then(
        () => Promise.reject(error),
        (closeError: unknown) => Promise.reject(closeError),
      );
    }

    return this.closePromise;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('Market data recorder is already closed');
    }
  }

  private writeRecord(record: RecordingRecord): void {
    this.writer.write(`${JSON.stringify(record)}\n`);
  }

  private validateOptions(
    directory: string,
    instruments: readonly MarketInstrumentConfig[],
    options: MarketDataRecorderOptions,
  ): void {
    if (directory.trim().length === 0) {
      throw new Error('Market recording directory must not be empty');
    }

    if (!isValidRuntimeSessionId(options.sourceSessionId)) {
      throw new Error(
        'sourceSessionId must contain 1-128 URL-safe identifier characters',
      );
    }

    if (
      options.startedAt !== undefined &&
      (!Number.isSafeInteger(options.startedAt) || options.startedAt < 0)
    ) {
      throw new Error('startedAt must be UTC epoch milliseconds');
    }

    if (options.orderBookChannel.trim().length === 0) {
      throw new Error('orderBookChannel must not be empty');
    }

    if (
      !Number.isSafeInteger(options.orderBookDepth) ||
      options.orderBookDepth <= 0
    ) {
      throw new Error('orderBookDepth must be a positive safe integer');
    }

    if (options.candleIntervals.length === 0) {
      throw new Error('At least one candle interval must be declared');
    }

    const intervalSet = new Set(options.candleIntervals);
    if (
      intervalSet.size !== options.candleIntervals.length ||
      options.candleIntervals.some((interval) => interval.trim().length === 0)
    ) {
      throw new Error('Candle intervals must be unique non-empty strings');
    }

    const instrumentIds = new Set<string>();
    for (const instrument of instruments) {
      if (instrumentIds.has(instrument.instId)) {
        throw new Error(`Duplicate recording instrument: ${instrument.instId}`);
      }
      instrumentIds.add(instrument.instId);
    }
  }
}
