import { createHash } from 'node:crypto';

import type { ResearchMarketDataRecord } from './ResearchMarketData';

export interface ContinuousCollectionCheckpoint {
  readonly sourceId: string;
  readonly cursor: string | null;
  readonly lastObservedAt: number | null;
  readonly lastSequenceId: number | null;
  readonly updatedAt: number;
}

export interface ContinuousCollectionBatch {
  readonly records: readonly ResearchMarketDataRecord[];
  readonly nextCursor: string | null;
  readonly sourceWatermark: number;
}

export interface ContinuousCollectionSource {
  readonly sourceId: string;
  readonly instrumentId: string;
  readonly expectedIntervalMs: number | null;
  load(checkpoint: ContinuousCollectionCheckpoint | null): Promise<ContinuousCollectionBatch>;
  recover?(input: {
    readonly fromObservedAt: number;
    readonly toObservedAt: number;
    readonly checkpoint: ContinuousCollectionCheckpoint | null;
  }): Promise<readonly ResearchMarketDataRecord[]>;
}

export interface ContinuousCollectionManifest {
  readonly sourceId: string;
  readonly instrumentId: string;
  readonly cycleStartedAt: number;
  readonly cycleCompletedAt: number;
  readonly rangeStart: number | null;
  readonly rangeEnd: number | null;
  readonly recordCount: number;
  readonly recoveredRecordCount: number;
  readonly datasetFingerprint: string;
  readonly status: 'PERSISTED' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

export interface ContinuousCollectionStore {
  loadCheckpoint(sourceId: string): Promise<ContinuousCollectionCheckpoint | null>;
  persist(input: {
    readonly records: readonly ResearchMarketDataRecord[];
    readonly checkpoint: ContinuousCollectionCheckpoint;
    readonly manifest: ContinuousCollectionManifest;
  }): Promise<void>;
  persistRejectedManifest(manifest: ContinuousCollectionManifest): Promise<void>;
}

export interface ContinuousCollectionPolicy {
  readonly maximumFutureSkewMs: number;
  readonly maximumReceiveLagMs: number;
  readonly gapToleranceMs: number;
  readonly rejectSyntheticData: boolean;
}

export const DEFAULT_CONTINUOUS_COLLECTION_POLICY: ContinuousCollectionPolicy = {
  maximumFutureSkewMs: 1_000,
  maximumReceiveLagMs: 60_000,
  gapToleranceMs: 5,
  rejectSyntheticData: true,
};

const requireTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const identity = (record: ResearchMarketDataRecord): string => {
  switch (record.kind) {
    case 'TRADE':
      return `${record.kind}:${record.instrumentId}:${record.tradeId}`;
    case 'ORDER_BOOK':
      return `${record.kind}:${record.instrumentId}:${record.observedAt}:${record.sequenceId ?? -1}`;
    case 'CANDLE':
      return `${record.kind}:${record.instrumentId}:${record.observedAt}:${record.intervalMs}`;
    case 'FUNDING':
      return `${record.kind}:${record.instrumentId}:${record.fundingTime}`;
    case 'VOLUME':
      return `${record.kind}:${record.instrumentId}:${record.observedAt}:${record.windowMs}`;
    default:
      return `${record.kind}:${record.instrumentId}:${record.observedAt}`;
  }
};

const mergeUnique = (
  records: readonly ResearchMarketDataRecord[],
): readonly ResearchMarketDataRecord[] => {
  const byIdentity = new Map<string, ResearchMarketDataRecord>();
  for (const record of records) {
    const key = identity(record);
    const previous = byIdentity.get(key);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(record)) {
      throw new Error(`Conflicting duplicate continuous record ${key}`);
    }
    byIdentity.set(key, record);
  }
  return [...byIdentity.values()].sort(
    (left, right) =>
      left.observedAt - right.observedAt || identity(left).localeCompare(identity(right)),
  );
};

const fingerprint = (records: readonly ResearchMarketDataRecord[]): string =>
  createHash('sha256').update(JSON.stringify(records)).digest('hex');

const findTimestampGap = (input: {
  readonly records: readonly ResearchMarketDataRecord[];
  readonly previousObservedAt: number | null;
  readonly expectedIntervalMs: number;
  readonly toleranceMs: number;
}): Readonly<{ fromObservedAt: number; toObservedAt: number }> | null => {
  const timestamps = [
    ...(input.previousObservedAt === null ? [] : [input.previousObservedAt]),
    ...input.records.map((record) => record.observedAt),
  ].sort((left, right) => left - right);
  for (let index = 1; index < timestamps.length; index += 1) {
    const previous = timestamps[index - 1];
    const current = timestamps[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (current - previous > input.expectedIntervalMs + input.toleranceMs) {
      return {
        fromObservedAt: previous + input.expectedIntervalMs,
        toObservedAt: current - input.expectedIntervalMs,
      };
    }
  }
  return null;
};

const validateRecords = (input: {
  readonly source: ContinuousCollectionSource;
  readonly records: readonly ResearchMarketDataRecord[];
  readonly now: number;
  readonly checkpoint: ContinuousCollectionCheckpoint | null;
  readonly policy: ContinuousCollectionPolicy;
}): readonly string[] => {
  const reasons: string[] = [];
  let previousObservedAt = input.checkpoint?.lastObservedAt ?? null;
  let previousSequenceId = input.checkpoint?.lastSequenceId ?? null;

  for (const record of input.records) {
    if (record.instrumentId !== input.source.instrumentId) {
      reasons.push('INSTRUMENT_MISMATCH');
    }
    if (input.policy.rejectSyntheticData && record.source === 'SYNTHETIC_TEST') {
      reasons.push('SYNTHETIC_DATA_REJECTED');
    }
    if (
      !Number.isSafeInteger(record.observedAt) ||
      !Number.isSafeInteger(record.receivedAt) ||
      record.observedAt < 0 ||
      record.receivedAt < 0
    ) {
      reasons.push('INVALID_TIMESTAMP');
      continue;
    }
    if (record.observedAt > input.now + input.policy.maximumFutureSkewMs) {
      reasons.push('FUTURE_EXCHANGE_TIMESTAMP');
    }
    if (record.receivedAt - record.observedAt > input.policy.maximumReceiveLagMs) {
      reasons.push('RECEIVE_LAG_EXCEEDED');
    }
    if (previousObservedAt !== null && record.observedAt < previousObservedAt) {
      reasons.push('OBSERVED_TIME_REGRESSION');
    }
    previousObservedAt = Math.max(previousObservedAt ?? 0, record.observedAt);

    if (record.kind === 'ORDER_BOOK' && record.sequenceId !== null) {
      if (previousSequenceId !== null && record.sequenceId <= previousSequenceId) {
        reasons.push('ORDER_BOOK_SEQUENCE_REGRESSION');
      }
      previousSequenceId = record.sequenceId;
    }
  }
  return [...new Set(reasons)];
};

export class ContinuousDerivativesCollector {
  public constructor(
    private readonly store: ContinuousCollectionStore,
    private readonly policy: ContinuousCollectionPolicy =
      DEFAULT_CONTINUOUS_COLLECTION_POLICY,
  ) {}

  public async runCycle(input: {
    readonly source: ContinuousCollectionSource;
    readonly cycleStartedAt: number;
    readonly cycleCompletedAt: number;
  }): Promise<ContinuousCollectionManifest> {
    requireTimestamp(input.cycleStartedAt, 'cycleStartedAt');
    requireTimestamp(input.cycleCompletedAt, 'cycleCompletedAt');
    if (input.cycleCompletedAt < input.cycleStartedAt) {
      throw new Error('cycleCompletedAt must not precede cycleStartedAt');
    }
    if (input.source.sourceId.trim().length === 0) {
      throw new Error('sourceId must not be empty');
    }

    const checkpoint = await this.store.loadCheckpoint(input.source.sourceId);
    const loaded = await input.source.load(checkpoint);
    requireTimestamp(loaded.sourceWatermark, 'sourceWatermark');

    let recoveredRecordCount = 0;
    let records = mergeUnique(loaded.records);
    if (input.source.expectedIntervalMs !== null) {
      const gap = findTimestampGap({
        records,
        previousObservedAt: checkpoint?.lastObservedAt ?? null,
        expectedIntervalMs: input.source.expectedIntervalMs,
        toleranceMs: this.policy.gapToleranceMs,
      });
      if (gap !== null && input.source.recover !== undefined) {
        const recovered = await input.source.recover({ ...gap, checkpoint });
        recoveredRecordCount = recovered.length;
        records = mergeUnique([...records, ...recovered]);
      }
    }

    const rejectionReasons = [...validateRecords({
      source: input.source,
      records,
      now: input.cycleCompletedAt,
      checkpoint,
      policy: this.policy,
    })];

    if (input.source.expectedIntervalMs !== null) {
      const remainingGap = findTimestampGap({
        records,
        previousObservedAt: checkpoint?.lastObservedAt ?? null,
        expectedIntervalMs: input.source.expectedIntervalMs,
        toleranceMs: this.policy.gapToleranceMs,
      });
      if (remainingGap !== null) {
        rejectionReasons.push('UNRESOLVED_TIMESTAMP_GAP');
      }
    }

    const rangeStart = records[0]?.observedAt ?? null;
    const rangeEnd = records[records.length - 1]?.observedAt ?? null;
    const baseManifest = {
      sourceId: input.source.sourceId,
      instrumentId: input.source.instrumentId,
      cycleStartedAt: input.cycleStartedAt,
      cycleCompletedAt: input.cycleCompletedAt,
      rangeStart,
      rangeEnd,
      recordCount: records.length,
      recoveredRecordCount,
      datasetFingerprint: fingerprint(records),
      liveExecutionAllowed: false as const,
    };

    if (rejectionReasons.length > 0) {
      const manifest: ContinuousCollectionManifest = {
        ...baseManifest,
        status: 'REJECTED',
        rejectionReasons: [...new Set(rejectionReasons)],
      };
      await this.store.persistRejectedManifest(manifest);
      return manifest;
    }

    const lastBook = records
      .filter(
        (record): record is Extract<ResearchMarketDataRecord, { kind: 'ORDER_BOOK' }> =>
          record.kind === 'ORDER_BOOK' && record.sequenceId !== null,
      )
      .at(-1);
    const nextCheckpoint: ContinuousCollectionCheckpoint = {
      sourceId: input.source.sourceId,
      cursor: loaded.nextCursor,
      lastObservedAt: rangeEnd ?? checkpoint?.lastObservedAt ?? null,
      lastSequenceId:
        lastBook?.sequenceId ?? checkpoint?.lastSequenceId ?? null,
      updatedAt: input.cycleCompletedAt,
    };
    const manifest: ContinuousCollectionManifest = {
      ...baseManifest,
      status: 'PERSISTED',
      rejectionReasons: [],
    };
    await this.store.persist({
      records,
      checkpoint: nextCheckpoint,
      manifest,
    });
    return manifest;
  }
}
