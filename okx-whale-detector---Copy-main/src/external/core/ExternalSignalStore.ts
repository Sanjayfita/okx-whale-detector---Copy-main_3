import { ExternalSignalDeduplicator } from './ExternalSignalDeduplicator';
import type { ExternalWhaleSignal } from '../types/ExternalWhaleSignal';

export interface ExternalSignalStoreConfig {
  maximumSignals: number;
  retentionMs: number;
}

const DEFAULT_CONFIG: ExternalSignalStoreConfig = {
  maximumSignals: 10_000,
  retentionMs: 24 * 60 * 60 * 1_000,
};

export interface ExternalSignalAddResult {
  added: boolean;
  merged: boolean;
  signal: ExternalWhaleSignal;
}

export class ExternalSignalStore {
  private readonly signals = new Map<string, ExternalWhaleSignal>();
  private readonly config: ExternalSignalStoreConfig;
  private readonly deduplicator = new ExternalSignalDeduplicator();

  public constructor(config: Partial<ExternalSignalStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (
      !Number.isInteger(this.config.maximumSignals) ||
      this.config.maximumSignals <= 0
    ) {
      throw new Error('maximumSignals must be a positive integer');
    }

    if (
      !Number.isFinite(this.config.retentionMs) ||
      this.config.retentionMs <= 0
    ) {
      throw new Error('retentionMs must be greater than zero');
    }
  }

  public add(
    signal: ExternalWhaleSignal,
    now = Date.now(),
  ): ExternalSignalAddResult {
    this.prune(now);

    const existing = this.signals.get(signal.underlyingEventId);

    if (existing) {
      const merged = this.deduplicator.merge(existing, signal);
      this.signals.set(signal.underlyingEventId, merged);
      return { added: false, merged: true, signal: merged };
    }

    this.signals.set(signal.underlyingEventId, signal);
    this.enforceMaximumSize();

    return { added: true, merged: false, signal };
  }

  public getAll(now = Date.now()): ExternalWhaleSignal[] {
    this.prune(now);
    return [...this.signals.values()].sort(
      (left, right) => right.occurredAt - left.occurredAt,
    );
  }

  public getByAsset(asset: string, now = Date.now()): ExternalWhaleSignal[] {
    const normalizedAsset = asset.toUpperCase();
    return this.getAll(now).filter(
      (signal) => signal.asset?.toUpperCase() === normalizedAsset,
    );
  }

  public getSize(now = Date.now()): number {
    this.prune(now);
    return this.signals.size;
  }

  public getStoredSize(): number {
    return this.signals.size;
  }

  public clear(): void {
    this.signals.clear();
  }

  public prune(now = Date.now()): void {
    const cutoff = now - this.config.retentionMs;

    for (const [key, signal] of this.signals) {
      if (signal.occurredAt < cutoff) {
        this.signals.delete(key);
      }
    }
  }

  private enforceMaximumSize(): void {
    if (this.signals.size <= this.config.maximumSignals) {
      return;
    }

    const oldest = [...this.signals.entries()].sort(
      ([, left], [, right]) => left.occurredAt - right.occurredAt,
    );

    const removeCount = this.signals.size - this.config.maximumSignals;
    for (let index = 0; index < removeCount; index += 1) {
      const entry = oldest[index];
      if (entry) {
        this.signals.delete(entry[0]);
      }
    }
  }
}
