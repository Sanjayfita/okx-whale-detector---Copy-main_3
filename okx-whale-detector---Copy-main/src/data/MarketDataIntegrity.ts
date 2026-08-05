import type {
  CandleRecord,
  HistoricalMarketDataBatch,
  HistoricalTradeRecord,
  OrderBookDepthLevel,
  OrderBookSnapshotRecord,
  ResearchMarketDataRecord,
} from './ResearchMarketData';

export type MarketDataIntegrityIssueCode =
  | 'INVALID_RANGE'
  | 'INSTRUMENT_MISMATCH'
  | 'INVALID_TIMESTAMP'
  | 'RECEIVED_BEFORE_OBSERVED'
  | 'DUPLICATE_RECORD'
  | 'NON_FINITE_VALUE'
  | 'NON_POSITIVE_VALUE'
  | 'CROSSED_BOOK'
  | 'UNSORTED_BOOK'
  | 'INVALID_CANDLE'
  | 'UNCONFIRMED_CANDLE'
  | 'TIMESTAMP_OUTSIDE_RANGE';

export interface MarketDataIntegrityIssue {
  readonly code: MarketDataIntegrityIssueCode;
  readonly message: string;
  readonly recordIndex: number | null;
}

export interface MarketDataGap {
  readonly previousTimestamp: number;
  readonly nextTimestamp: number;
  readonly missingFrom: number;
  readonly missingTo: number;
  readonly estimatedMissingRecords: number;
}

export interface GapDetectionPolicy {
  readonly expectedIntervalMs: number;
  readonly toleranceMs: number;
}

export interface DatasetIntegrityPolicy {
  readonly requireConfirmedCandles: boolean;
  readonly rejectRecordsOutsideRange: boolean;
}

export interface DatasetIntegrityResult {
  readonly status: 'VALID' | 'REJECTED';
  readonly issues: readonly MarketDataIntegrityIssue[];
}

export const DEFAULT_DATASET_INTEGRITY_POLICY: DatasetIntegrityPolicy = {
  requireConfirmedCandles: true,
  rejectRecordsOutsideRange: true,
};

const isSafeTimestamp = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const isFinitePositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

const isFiniteNonNegative = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

const validateDepth = (
  levels: readonly OrderBookDepthLevel[],
  side: 'BID' | 'ASK',
): readonly MarketDataIntegrityIssue[] => {
  const issues: MarketDataIntegrityIssue[] = [];
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    if (level === undefined) {
      continue;
    }
    if (!isFinitePositive(level.price) || !isFiniteNonNegative(level.contracts)) {
      issues.push({
        code: !Number.isFinite(level.price) || !Number.isFinite(level.contracts)
          ? 'NON_FINITE_VALUE'
          : 'NON_POSITIVE_VALUE',
        message: `${side} depth level ${index} has invalid price or contracts`,
        recordIndex: null,
      });
    }
    const next = levels[index + 1];
    if (
      next !== undefined &&
      ((side === 'BID' && next.price >= level.price) ||
        (side === 'ASK' && next.price <= level.price))
    ) {
      issues.push({
        code: 'UNSORTED_BOOK',
        message: `${side} depth is not strictly price sorted`,
        recordIndex: null,
      });
      break;
    }
  }
  return issues;
};

const recordIdentity = (record: ResearchMarketDataRecord): string => {
  if (record.kind === 'TRADE') {
    return `${record.kind}:${record.instrumentId}:${record.tradeId}`;
  }
  if (record.kind === 'FUNDING') {
    return `${record.kind}:${record.instrumentId}:${record.fundingTime}`;
  }
  return `${record.kind}:${record.instrumentId}:${record.observedAt}`;
};

const validateRecord = (
  record: ResearchMarketDataRecord,
  index: number,
  batch: HistoricalMarketDataBatch,
  policy: DatasetIntegrityPolicy,
): readonly MarketDataIntegrityIssue[] => {
  const issues: MarketDataIntegrityIssue[] = [];
  if (record.instrumentId !== batch.instrumentId) {
    issues.push({
      code: 'INSTRUMENT_MISMATCH',
      message: `Record instrument ${record.instrumentId} does not match ${batch.instrumentId}`,
      recordIndex: index,
    });
  }
  if (!isSafeTimestamp(record.observedAt) || !isSafeTimestamp(record.receivedAt)) {
    issues.push({
      code: 'INVALID_TIMESTAMP',
      message: 'Record timestamps must be non-negative safe integers',
      recordIndex: index,
    });
  }
  if (record.receivedAt < record.observedAt) {
    issues.push({
      code: 'RECEIVED_BEFORE_OBSERVED',
      message: 'receivedAt cannot precede observedAt',
      recordIndex: index,
    });
  }
  if (
    policy.rejectRecordsOutsideRange &&
    (record.observedAt < batch.rangeStart || record.observedAt > batch.rangeEnd)
  ) {
    issues.push({
      code: 'TIMESTAMP_OUTSIDE_RANGE',
      message: 'Record timestamp is outside the declared batch range',
      recordIndex: index,
    });
  }

  switch (record.kind) {
    case 'TRADE':
      if (!isFinitePositive(record.price) || !isFinitePositive(record.contracts)) {
        issues.push({
          code: 'NON_POSITIVE_VALUE',
          message: 'Trade price and contracts must be positive',
          recordIndex: index,
        });
      }
      break;
    case 'ORDER_BOOK': {
      issues.push(
        ...validateDepth(record.bids, 'BID').map((issue) => ({
          ...issue,
          recordIndex: index,
        })),
        ...validateDepth(record.asks, 'ASK').map((issue) => ({
          ...issue,
          recordIndex: index,
        })),
      );
      const bestBid = record.bids[0]?.price;
      const bestAsk = record.asks[0]?.price;
      if (bestBid !== undefined && bestAsk !== undefined && bestBid >= bestAsk) {
        issues.push({
          code: 'CROSSED_BOOK',
          message: 'Order book best bid must be below best ask',
          recordIndex: index,
        });
      }
      break;
    }
    case 'CANDLE':
      if (
        !isFinitePositive(record.open) ||
        !isFinitePositive(record.high) ||
        !isFinitePositive(record.low) ||
        !isFinitePositive(record.close) ||
        record.high < Math.max(record.open, record.close) ||
        record.low > Math.min(record.open, record.close) ||
        record.low > record.high ||
        !isFiniteNonNegative(record.contractVolume)
      ) {
        issues.push({
          code: 'INVALID_CANDLE',
          message: 'Candle OHLCV relationships are invalid',
          recordIndex: index,
        });
      }
      if (policy.requireConfirmedCandles && !record.confirmed) {
        issues.push({
          code: 'UNCONFIRMED_CANDLE',
          message: 'Unconfirmed candles are not allowed by policy',
          recordIndex: index,
        });
      }
      break;
    case 'OPEN_INTEREST':
      if (!isFiniteNonNegative(record.contracts)) {
        issues.push({
          code: 'NON_POSITIVE_VALUE',
          message: 'Open interest contracts must be non-negative',
          recordIndex: index,
        });
      }
      break;
    case 'FUNDING':
      if (!Number.isFinite(record.fundingRate) || !isSafeTimestamp(record.fundingTime)) {
        issues.push({
          code: 'NON_FINITE_VALUE',
          message: 'Funding rate and funding time must be valid',
          recordIndex: index,
        });
      }
      break;
    case 'LIQUIDATION':
      if (!isFinitePositive(record.price) || !isFinitePositive(record.contracts)) {
        issues.push({
          code: 'NON_POSITIVE_VALUE',
          message: 'Liquidation price and contracts must be positive',
          recordIndex: index,
        });
      }
      break;
    case 'MARK_INDEX':
      if (!isFinitePositive(record.markPrice) || !isFinitePositive(record.indexPrice)) {
        issues.push({
          code: 'NON_POSITIVE_VALUE',
          message: 'Mark and index prices must be positive',
          recordIndex: index,
        });
      }
      break;
    case 'BEST_QUOTE':
      if (
        !isFinitePositive(record.bestBid) ||
        !isFinitePositive(record.bestAsk) ||
        record.bestBid >= record.bestAsk
      ) {
        issues.push({
          code: 'CROSSED_BOOK',
          message: 'Best quote is invalid or crossed',
          recordIndex: index,
        });
      }
      break;
    case 'VOLUME':
      if (!isFiniteNonNegative(record.contractVolume) || record.windowMs <= 0) {
        issues.push({
          code: 'NON_POSITIVE_VALUE',
          message: 'Volume window and values must be valid',
          recordIndex: index,
        });
      }
      break;
    case 'CONTRACT_METADATA':
      if (
        !isFinitePositive(record.contractValue) ||
        !isFinitePositive(record.tickSize) ||
        !isFinitePositive(record.lotSize) ||
        !isFinitePositive(record.minimumContracts)
      ) {
        issues.push({
          code: 'NON_POSITIVE_VALUE',
          message: 'Contract metadata precision and sizing values must be positive',
          recordIndex: index,
        });
      }
      break;
  }

  return issues;
};

export const validateHistoricalMarketDataBatch = (
  batch: HistoricalMarketDataBatch,
  policy: DatasetIntegrityPolicy = DEFAULT_DATASET_INTEGRITY_POLICY,
): DatasetIntegrityResult => {
  const issues: MarketDataIntegrityIssue[] = [];
  if (
    !isSafeTimestamp(batch.rangeStart) ||
    !isSafeTimestamp(batch.rangeEnd) ||
    batch.rangeEnd < batch.rangeStart
  ) {
    issues.push({
      code: 'INVALID_RANGE',
      message: 'Batch range must contain valid ascending millisecond timestamps',
      recordIndex: null,
    });
  }

  const seen = new Set<string>();
  batch.records.forEach((record, index) => {
    const identity = recordIdentity(record);
    if (seen.has(identity)) {
      issues.push({
        code: 'DUPLICATE_RECORD',
        message: `Duplicate record identity ${identity}`,
        recordIndex: index,
      });
    } else {
      seen.add(identity);
    }
    issues.push(...validateRecord(record, index, batch, policy));
  });

  return {
    status: issues.length === 0 ? 'VALID' : 'REJECTED',
    issues,
  };
};

export const detectTimestampGaps = (
  timestamps: readonly number[],
  policy: GapDetectionPolicy,
): readonly MarketDataGap[] => {
  if (!Number.isSafeInteger(policy.expectedIntervalMs) || policy.expectedIntervalMs <= 0) {
    throw new Error('expectedIntervalMs must be a positive safe integer');
  }
  if (!Number.isSafeInteger(policy.toleranceMs) || policy.toleranceMs < 0) {
    throw new Error('toleranceMs must be a non-negative safe integer');
  }

  const sortedUnique = [...new Set(timestamps)].sort((left, right) => left - right);
  const gaps: MarketDataGap[] = [];
  for (let index = 1; index < sortedUnique.length; index += 1) {
    const previousTimestamp = sortedUnique[index - 1];
    const nextTimestamp = sortedUnique[index];
    if (previousTimestamp === undefined || nextTimestamp === undefined) {
      continue;
    }
    const difference = nextTimestamp - previousTimestamp;
    if (difference <= policy.expectedIntervalMs + policy.toleranceMs) {
      continue;
    }
    const estimatedMissingRecords = Math.max(
      1,
      Math.floor(difference / policy.expectedIntervalMs) - 1,
    );
    gaps.push({
      previousTimestamp,
      nextTimestamp,
      missingFrom: previousTimestamp + policy.expectedIntervalMs,
      missingTo: nextTimestamp - policy.expectedIntervalMs,
      estimatedMissingRecords,
    });
  }
  return gaps;
};

export const extractTradeTimestamps = (
  trades: readonly HistoricalTradeRecord[],
): readonly number[] => trades.map((trade) => trade.observedAt);

export const extractBookTimestamps = (
  books: readonly OrderBookSnapshotRecord[],
): readonly number[] => books.map((book) => book.observedAt);

export const extractCandleTimestamps = (
  candles: readonly CandleRecord[],
): readonly number[] => candles.map((candle) => candle.observedAt);
