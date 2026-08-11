import type {
  LiveMarketPriceObservation,
  LiveMarketPriceObserver,
} from '../market/MarketEngine';
import type { LivePriceSnapshot } from './liveEvidenceCollector';

export interface OKXStreamingPriceReaderOptions {
  clock?: () => number;
  maximumSnapshotAgeMs?: number;
  maximumSourceAgeMs?: number;
}

export class OKXStreamingPriceReader {
  private readonly snapshots = new Map<string, LivePriceSnapshot>();
  private readonly clock: () => number;
  private readonly maximumSnapshotAgeMs: number;
  private readonly maximumSourceAgeMs: number;

  public constructor(options: OKXStreamingPriceReaderOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.maximumSnapshotAgeMs = options.maximumSnapshotAgeMs ?? 10_000;
    this.maximumSourceAgeMs = options.maximumSourceAgeMs ?? 10_000;

    for (const [name, value] of [
      ['maximumSnapshotAgeMs', this.maximumSnapshotAgeMs],
      ['maximumSourceAgeMs', this.maximumSourceAgeMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative safe integer`);
      }
    }
  }

  public observe: LiveMarketPriceObserver = (
    observation: LiveMarketPriceObservation,
  ): void => {
    const instrumentId = observation.instrumentId.trim();
    if (instrumentId.length === 0) {
      throw new Error('instrumentId must not be empty');
    }
    if (
      !Number.isSafeInteger(observation.observedAt) ||
      observation.observedAt < 0 ||
      !Number.isSafeInteger(observation.sourceMarketTimestamp) ||
      observation.sourceMarketTimestamp < 0 ||
      !Number.isFinite(observation.price) ||
      observation.price <= 0
    ) {
      throw new Error('Live market price observation is invalid');
    }

    const sourceMarketAgeMs =
      observation.observedAt - observation.sourceMarketTimestamp;
    if (sourceMarketAgeMs < 0) {
      throw new Error(
        'Live market price source timestamp is in the future',
      );
    }
    if (sourceMarketAgeMs > this.maximumSourceAgeMs) {
      throw new Error('Live market price source timestamp is stale');
    }

    const existing = this.snapshots.get(instrumentId);
    if (
      existing !== undefined &&
      (existing.observedAt > observation.observedAt ||
        (existing.observedAt === observation.observedAt &&
          (existing.sourceMarketTimestamp ?? 0) >=
            observation.sourceMarketTimestamp))
    ) {
      return;
    }

    this.snapshots.set(
      instrumentId,
      Object.freeze({
        instrumentId,
        observedAt: observation.observedAt,
        sourceMarketTimestamp: observation.sourceMarketTimestamp,
        sourceMarketAgeMs,
        price: observation.price,
      }),
    );
  };

  public readPrice = async (
    instrumentId: string,
    dueAt: number,
  ): Promise<LivePriceSnapshot> => {
    const normalizedInstrumentId = instrumentId.trim();
    if (normalizedInstrumentId.length === 0) {
      throw new Error('instrumentId must not be empty');
    }
    if (!Number.isSafeInteger(dueAt) || dueAt < 0) {
      throw new Error('dueAt must be a non-negative safe integer');
    }

    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error('Local clock must return a non-negative safe integer');
    }
    if (now < dueAt) {
      throw new Error('Live market price was requested before the due time');
    }

    const snapshot = this.snapshots.get(normalizedInstrumentId);
    if (snapshot === undefined) {
      throw new Error(
        'No live order-book price is available for the instrument',
      );
    }
    if (snapshot.observedAt < dueAt) {
      throw new Error(
        'Latest live order-book price predates the requested due time',
      );
    }
    if (now - snapshot.observedAt > this.maximumSnapshotAgeMs) {
      throw new Error('Latest live order-book price is stale');
    }

    return snapshot;
  };
}
