import {
  detectTimestampGaps,
  validateHistoricalMarketDataBatch,
  type DatasetIntegrityPolicy,
  type MarketDataGap,
} from './MarketDataIntegrity';
import type {
  HistoricalMarketDataBatch,
  ResearchMarketDataRecord,
} from './ResearchMarketData';
import type { ResearchStore } from '../storage/ResearchStore';

export type HistoricalStreamName =
  | 'TRADES'
  | 'ORDER_BOOK'
  | 'CANDLES'
  | 'OPEN_INTEREST'
  | 'FUNDING'
  | 'LIQUIDATIONS'
  | 'MARK_INDEX'
  | 'BEST_QUOTES'
  | 'VOLUME'
  | 'CONTRACT_METADATA';

export interface HistoricalPageResult {
  readonly records: readonly ResearchMarketDataRecord[];
  readonly nextCursor: string | null;
}

export interface HistoricalStreamCollector {
  readonly stream: HistoricalStreamName;
  readonly expectedIntervalMs: number | null;
  loadPage(cursor: string | null): Promise<HistoricalPageResult>;
  recoverGap?(gap: MarketDataGap): Promise<readonly ResearchMarketDataRecord[]>;
}

export interface HistoricalDataPipelinePolicy {
  readonly maximumPagesPerStream: number;
  readonly maximumRecoveryPasses: number;
  readonly gapToleranceMs: number;
  readonly integrity: DatasetIntegrityPolicy;
}

export interface StreamCollectionReport {
  readonly stream: HistoricalStreamName;
  readonly pageCount: number;
  readonly initialRecordCount: number;
  readonly recoveredRecordCount: number;
  readonly finalRecordCount: number;
  readonly recoveryPasses: number;
  readonly remainingGaps: readonly MarketDataGap[];
}

export interface HistoricalDatasetManifest {
  readonly datasetId: string;
  readonly instrumentId: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly createdAt: number;
  readonly recordCount: number;
  readonly streamReports: readonly StreamCollectionReport[];
  readonly status: 'PERSISTED' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

export const DEFAULT_HISTORICAL_DATA_PIPELINE_POLICY: HistoricalDataPipelinePolicy = {
  maximumPagesPerStream: 10_000,
  maximumRecoveryPasses: 3,
  gapToleranceMs: 5,
  integrity: {
    requireConfirmedCandles: true,
    rejectRecordsOutsideRange: true,
  },
};

const requireTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const recordIdentity = (record: ResearchMarketDataRecord): string => {
  switch (record.kind) {
    case 'TRADE':
      return `${record.kind}:${record.instrumentId}:${record.tradeId}`;
    case 'FUNDING':
      return `${record.kind}:${record.instrumentId}:${record.fundingTime}`;
    case 'ORDER_BOOK':
      return `${record.kind}:${record.instrumentId}:${record.observedAt}:${record.sequenceId ?? -1}`;
    case 'CANDLE':
      return `${record.kind}:${record.instrumentId}:${record.observedAt}:${record.intervalMs}`;
    case 'VOLUME':
      return `${record.kind}:${record.instrumentId}:${record.observedAt}:${record.windowMs}`;
    default:
      return `${record.kind}:${record.instrumentId}:${record.observedAt}`;
  }
};

const mergeUnique = (
  existing: readonly ResearchMarketDataRecord[],
  incoming: readonly ResearchMarketDataRecord[],
): readonly ResearchMarketDataRecord[] => {
  const records = new Map<string, ResearchMarketDataRecord>();
  for (const record of [...existing, ...incoming]) {
    const identity = recordIdentity(record);
    const previous = records.get(identity);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(record)) {
      throw new Error(`Conflicting duplicate market data record ${identity}`);
    }
    records.set(identity, record);
  }
  return [...records.values()].sort(
    (left, right) =>
      left.observedAt - right.observedAt ||
      recordIdentity(left).localeCompare(recordIdentity(right)),
  );
};

const timestamps = (
  records: readonly ResearchMarketDataRecord[],
): readonly number[] => records.map((record) => record.observedAt);

const collectStream = async (input: {
  readonly collector: HistoricalStreamCollector;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly policy: HistoricalDataPipelinePolicy;
}): Promise<{
  readonly records: readonly ResearchMarketDataRecord[];
  readonly report: StreamCollectionReport;
}> => {
  let cursor: string | null = null;
  let pageCount = 0;
  let records: readonly ResearchMarketDataRecord[] = [];
  const visitedCursors = new Set<string>();

  do {
    if (pageCount >= input.policy.maximumPagesPerStream) {
      throw new Error(
        `${input.collector.stream} exceeded maximumPagesPerStream=${input.policy.maximumPagesPerStream}`,
      );
    }
    const cursorKey = cursor ?? '<INITIAL>';
    if (visitedCursors.has(cursorKey)) {
      throw new Error(`${input.collector.stream} pagination cursor repeated`);
    }
    visitedCursors.add(cursorKey);
    const page = await input.collector.loadPage(cursor);
    records = mergeUnique(records, page.records);
    cursor = page.nextCursor;
    pageCount += 1;
  } while (cursor !== null);

  records = records.filter(
    (record) =>
      record.observedAt >= input.rangeStart &&
      record.observedAt <= input.rangeEnd,
  );
  const initialRecordCount = records.length;
  let recoveredRecordCount = 0;
  let recoveryPasses = 0;
  let remainingGaps: readonly MarketDataGap[] = [];

  if (input.collector.expectedIntervalMs !== null) {
    remainingGaps = detectTimestampGaps(timestamps(records), {
      expectedIntervalMs: input.collector.expectedIntervalMs,
      toleranceMs: input.policy.gapToleranceMs,
    });
    while (
      remainingGaps.length > 0 &&
      input.collector.recoverGap !== undefined &&
      recoveryPasses < input.policy.maximumRecoveryPasses
    ) {
      let recovered: readonly ResearchMarketDataRecord[] = [];
      for (const gap of remainingGaps) {
        recovered = mergeUnique(
          recovered,
          await input.collector.recoverGap(gap),
        );
      }
      const before = records.length;
      records = mergeUnique(records, recovered).filter(
        (record) =>
          record.observedAt >= input.rangeStart &&
          record.observedAt <= input.rangeEnd,
      );
      recoveredRecordCount += records.length - before;
      recoveryPasses += 1;
      remainingGaps = detectTimestampGaps(timestamps(records), {
        expectedIntervalMs: input.collector.expectedIntervalMs,
        toleranceMs: input.policy.gapToleranceMs,
      });
      if (records.length === before) {
        break;
      }
    }
  }

  return {
    records,
    report: {
      stream: input.collector.stream,
      pageCount,
      initialRecordCount,
      recoveredRecordCount,
      finalRecordCount: records.length,
      recoveryPasses,
      remainingGaps,
    },
  };
};

export class HistoricalDataPipeline {
  public constructor(
    private readonly store: ResearchStore,
    private readonly policy: HistoricalDataPipelinePolicy =
      DEFAULT_HISTORICAL_DATA_PIPELINE_POLICY,
  ) {}

  public async collect(input: {
    readonly datasetId: string;
    readonly instrumentId: string;
    readonly rangeStart: number;
    readonly rangeEnd: number;
    readonly createdAt: number;
    readonly collectors: readonly HistoricalStreamCollector[];
  }): Promise<HistoricalDatasetManifest> {
    if (input.datasetId.trim().length === 0) {
      throw new Error('datasetId must not be empty');
    }
    if (input.instrumentId.trim().length === 0) {
      throw new Error('instrumentId must not be empty');
    }
    requireTimestamp(input.rangeStart, 'rangeStart');
    requireTimestamp(input.rangeEnd, 'rangeEnd');
    requireTimestamp(input.createdAt, 'createdAt');
    if (input.rangeEnd < input.rangeStart) {
      throw new Error('rangeEnd must be greater than or equal to rangeStart');
    }
    const streamNames = new Set<HistoricalStreamName>();
    for (const collector of input.collectors) {
      if (streamNames.has(collector.stream)) {
        throw new Error(`Duplicate collector for ${collector.stream}`);
      }
      streamNames.add(collector.stream);
    }

    let records: readonly ResearchMarketDataRecord[] = [];
    const streamReports: StreamCollectionReport[] = [];
    for (const collector of input.collectors) {
      const result = await collectStream({
        collector,
        rangeStart: input.rangeStart,
        rangeEnd: input.rangeEnd,
        policy: this.policy,
      });
      records = mergeUnique(records, result.records);
      streamReports.push(result.report);
    }

    const rejectionReasons: string[] = [];
    for (const report of streamReports) {
      if (report.remainingGaps.length > 0) {
        rejectionReasons.push(`${report.stream}_GAPS_REMAIN`);
      }
    }
    const batch: HistoricalMarketDataBatch = {
      instrumentId: input.instrumentId,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      records,
    };
    const integrity = validateHistoricalMarketDataBatch(
      batch,
      this.policy.integrity,
    );
    rejectionReasons.push(
      ...integrity.issues.map((issue) => `${issue.code}:${issue.recordIndex ?? 'BATCH'}`),
    );

    if (rejectionReasons.length > 0) {
      return {
        datasetId: input.datasetId,
        instrumentId: input.instrumentId,
        rangeStart: input.rangeStart,
        rangeEnd: input.rangeEnd,
        createdAt: input.createdAt,
        recordCount: records.length,
        streamReports,
        status: 'REJECTED',
        rejectionReasons: [...new Set(rejectionReasons)],
        liveExecutionAllowed: false,
      };
    }

    await this.store.withTransaction(async (transaction) => {
      await transaction.appendMarketData(records);
    });
    return {
      datasetId: input.datasetId,
      instrumentId: input.instrumentId,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      createdAt: input.createdAt,
      recordCount: records.length,
      streamReports,
      status: 'PERSISTED',
      rejectionReasons: [],
      liveExecutionAllowed: false,
    };
  }
}
