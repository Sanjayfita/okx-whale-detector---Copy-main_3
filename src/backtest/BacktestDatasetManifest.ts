import type {
  HistoricalBacktestCandle,
  PlatformBacktestFundingEvent,
} from './PlatformBacktestEngine';

export interface BacktestDatasetManifest {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly instrumentId: string;
  readonly sourceSha256: string;
  readonly createdAt: number;
  readonly expectedCandleIntervalMs: number | null;
  readonly firstCandleAt: number | null;
  readonly lastCandleAt: number | null;
  readonly coverageDurationMs: number;
  readonly confirmedCandleCount: number;
  readonly fundingEventCount: number;
  readonly gapCount: number;
  readonly estimatedMissingCandleCount: number;
  readonly irregularIntervalCount: number;
  readonly qualityStatus: 'VERIFIED' | 'FAILED' | 'UNVERIFIED_INTERVAL';
  readonly researchEligible: boolean;
  readonly liveExecutionAllowed: false;
}

const requireNonEmpty = (value: string, name: string): void => {
  if (value.trim().length === 0) throw new Error(`${name} must not be empty`);
};

export const createBacktestDatasetManifest = (input: {
  readonly datasetId: string;
  readonly instrumentId: string;
  readonly sourceSha256: string;
  readonly createdAt: number;
  readonly expectedCandleIntervalMs: number | null;
  readonly candles: readonly HistoricalBacktestCandle[];
  readonly fundingEvents: readonly PlatformBacktestFundingEvent[];
}): BacktestDatasetManifest => {
  requireNonEmpty(input.datasetId, 'datasetId');
  requireNonEmpty(input.instrumentId, 'instrumentId');
  if (!/^[a-f0-9]{64}$/u.test(input.sourceSha256)) {
    throw new Error('sourceSha256 must be a lowercase SHA-256 digest');
  }
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('createdAt must be a non-negative safe integer');
  }
  if (
    input.expectedCandleIntervalMs !== null &&
    (!Number.isSafeInteger(input.expectedCandleIntervalMs) ||
      input.expectedCandleIntervalMs <= 0)
  ) {
    throw new Error(
      'expectedCandleIntervalMs must be null or a positive integer',
    );
  }

  const candles = input.candles
    .filter((candle) => candle.confirm)
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp);
  const seenCandleTimestamps = new Set<number>();
  for (const candle of candles) {
    if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp < 0) {
      throw new Error('candle timestamps must be non-negative safe integers');
    }
    if (seenCandleTimestamps.has(candle.timestamp)) {
      throw new Error(`duplicate candle timestamp ${candle.timestamp}`);
    }
    seenCandleTimestamps.add(candle.timestamp);
  }
  const fundingIds = new Set<string>();
  for (const event of input.fundingEvents) {
    requireNonEmpty(event.eventId, 'funding.eventId');
    if (fundingIds.has(event.eventId)) {
      throw new Error(`duplicate funding event ${event.eventId}`);
    }
    fundingIds.add(event.eventId);
  }

  let gapCount = 0;
  let estimatedMissingCandleCount = 0;
  let irregularIntervalCount = 0;
  if (input.expectedCandleIntervalMs !== null) {
    for (let index = 1; index < candles.length; index += 1) {
      const previous = candles[index - 1];
      const current = candles[index];
      if (previous === undefined || current === undefined) continue;
      const difference = current.timestamp - previous.timestamp;
      if (difference === input.expectedCandleIntervalMs) continue;
      if (
        difference > input.expectedCandleIntervalMs &&
        difference % input.expectedCandleIntervalMs === 0
      ) {
        gapCount += 1;
        estimatedMissingCandleCount +=
          difference / input.expectedCandleIntervalMs - 1;
      } else {
        irregularIntervalCount += 1;
      }
    }
  }

  const firstCandleAt = candles[0]?.timestamp ?? null;
  const lastCandleAt = candles[candles.length - 1]?.timestamp ?? null;
  const qualityStatus =
    input.expectedCandleIntervalMs === null
      ? 'UNVERIFIED_INTERVAL'
      : gapCount > 0 || irregularIntervalCount > 0
        ? 'FAILED'
        : 'VERIFIED';

  return {
    schemaVersion: 1,
    datasetId: input.datasetId,
    instrumentId: input.instrumentId,
    sourceSha256: input.sourceSha256,
    createdAt: input.createdAt,
    expectedCandleIntervalMs: input.expectedCandleIntervalMs,
    firstCandleAt,
    lastCandleAt,
    coverageDurationMs:
      firstCandleAt === null || lastCandleAt === null
        ? 0
        : lastCandleAt - firstCandleAt,
    confirmedCandleCount: candles.length,
    fundingEventCount: input.fundingEvents.length,
    gapCount,
    estimatedMissingCandleCount,
    irregularIntervalCount,
    qualityStatus,
    researchEligible: qualityStatus === 'VERIFIED' && candles.length >= 2,
    liveExecutionAllowed: false,
  };
};
