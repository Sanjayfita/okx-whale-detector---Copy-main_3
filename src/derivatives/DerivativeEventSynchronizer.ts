import {
  type DerivativeMarketSnapshot,
  type MarketStructureState,
  validateDerivativeMarketSnapshot,
} from './DerivativeMarketSnapshot';

export interface TimestampedDerivativeValue<T> {
  readonly observedAt: number;
  readonly receivedAt: number;
  readonly value: T;
}

export interface DerivativeSnapshotSources {
  readonly instrumentId: string;
  readonly book: TimestampedDerivativeValue<{
    readonly bestBid: number;
    readonly bestAsk: number;
  }>;
  readonly markIndex: TimestampedDerivativeValue<{
    readonly markPrice: number;
    readonly indexPrice: number;
  }>;
  readonly openInterest: TimestampedDerivativeValue<{
    readonly priceChangePercent: number;
    readonly openInterestChangePercent: number;
  }>;
  readonly funding: TimestampedDerivativeValue<{
    readonly fundingRatePercent: number;
  }>;
  readonly tradeFlow: TimestampedDerivativeValue<{
    readonly aggressiveDeltaNormalized: number;
    readonly cvdSlopeNormalized: number;
    readonly orderBookImbalance: number;
  }>;
  readonly liquidation: TimestampedDerivativeValue<{
    readonly liquidationImbalance: number;
  }>;
  readonly technical: TimestampedDerivativeValue<{
    readonly atrPercent: number;
    readonly trendEfficiency: number;
    readonly trendAlignment: number;
    readonly volumeRatio: number;
    readonly vwapDeviationAtr: number;
    readonly marketStructure: MarketStructureState;
  }>;
  readonly whale: TimestampedDerivativeValue<{
    readonly whaleDirectionalBias: number;
    readonly whaleAuthenticity: number;
  }> | null;
}

export interface DerivativeFreshnessPolicy {
  readonly maxFutureSkewMs: number;
  readonly maxSourceSkewMs: number;
  readonly maxAgeMs: Readonly<{
    book: number;
    markIndex: number;
    openInterest: number;
    funding: number;
    tradeFlow: number;
    liquidation: number;
    technical: number;
    whale: number;
  }>;
}

export const DEFAULT_DERIVATIVE_FRESHNESS_POLICY: DerivativeFreshnessPolicy = {
  maxFutureSkewMs: 250,
  maxSourceSkewMs: 5_000,
  maxAgeMs: {
    book: 1_000,
    markIndex: 2_000,
    openInterest: 15_000,
    funding: 60_000,
    tradeFlow: 2_000,
    liquidation: 5_000,
    technical: 60_000,
    whale: 5_000,
  },
};

export type DerivativeSynchronizationRejectionReason =
  | 'INVALID_AS_OF'
  | 'INVALID_SOURCE_TIMESTAMP'
  | 'SOURCE_FROM_FUTURE'
  | 'SOURCE_STALE'
  | 'SOURCE_SKEW_TOO_LARGE'
  | 'INVALID_SNAPSHOT';

export interface DerivativeSynchronizationResult {
  readonly status: 'SYNCHRONIZED' | 'REJECTED';
  readonly snapshot: DerivativeMarketSnapshot | null;
  readonly rejectionReasons: readonly DerivativeSynchronizationRejectionReason[];
  readonly sourceAgesMs: Readonly<Record<string, number>>;
  readonly liveExecutionAllowed: false;
}

interface NamedSource {
  readonly name: keyof DerivativeFreshnessPolicy['maxAgeMs'];
  readonly observedAt: number;
  readonly receivedAt: number;
}

const isValidTimestamp = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const toNamedSources = (
  sources: DerivativeSnapshotSources,
): readonly NamedSource[] => {
  const required: NamedSource[] = [
    { name: 'book', ...sources.book },
    { name: 'markIndex', ...sources.markIndex },
    { name: 'openInterest', ...sources.openInterest },
    { name: 'funding', ...sources.funding },
    { name: 'tradeFlow', ...sources.tradeFlow },
    { name: 'liquidation', ...sources.liquidation },
    { name: 'technical', ...sources.technical },
  ];

  if (sources.whale !== null) {
    required.push({ name: 'whale', ...sources.whale });
  }

  return required;
};

const uniqueReasons = (
  reasons: readonly DerivativeSynchronizationRejectionReason[],
): readonly DerivativeSynchronizationRejectionReason[] => [...new Set(reasons)];

export const synchronizeDerivativeSnapshot = (input: {
  readonly asOf: number;
  readonly sources: DerivativeSnapshotSources;
  readonly policy?: DerivativeFreshnessPolicy;
}): DerivativeSynchronizationResult => {
  const policy = input.policy ?? DEFAULT_DERIVATIVE_FRESHNESS_POLICY;
  const rejectionReasons: DerivativeSynchronizationRejectionReason[] = [];
  const sourceAgesMs: Record<string, number> = {};

  if (!isValidTimestamp(input.asOf)) {
    return {
      status: 'REJECTED',
      snapshot: null,
      rejectionReasons: ['INVALID_AS_OF'],
      sourceAgesMs,
      liveExecutionAllowed: false,
    };
  }

  const namedSources = toNamedSources(input.sources);
  const observedTimes: number[] = [];

  for (const source of namedSources) {
    if (
      !isValidTimestamp(source.observedAt) ||
      !isValidTimestamp(source.receivedAt) ||
      source.receivedAt < source.observedAt
    ) {
      rejectionReasons.push('INVALID_SOURCE_TIMESTAMP');
      continue;
    }

    const ageMs = input.asOf - source.observedAt;
    sourceAgesMs[source.name] = ageMs;
    observedTimes.push(source.observedAt);

    if (ageMs < -policy.maxFutureSkewMs) {
      rejectionReasons.push('SOURCE_FROM_FUTURE');
    }
    if (ageMs > policy.maxAgeMs[source.name]) {
      rejectionReasons.push('SOURCE_STALE');
    }
  }

  if (observedTimes.length > 1) {
    const oldest = Math.min(...observedTimes);
    const newest = Math.max(...observedTimes);
    if (newest - oldest > policy.maxSourceSkewMs) {
      rejectionReasons.push('SOURCE_SKEW_TOO_LARGE');
    }
  }

  if (rejectionReasons.length > 0) {
    return {
      status: 'REJECTED',
      snapshot: null,
      rejectionReasons: uniqueReasons(rejectionReasons),
      sourceAgesMs,
      liveExecutionAllowed: false,
    };
  }

  const snapshot: DerivativeMarketSnapshot = {
    instrumentId: input.sources.instrumentId,
    observedAt: input.asOf,
    markPrice: input.sources.markIndex.value.markPrice,
    indexPrice: input.sources.markIndex.value.indexPrice,
    bestBid: input.sources.book.value.bestBid,
    bestAsk: input.sources.book.value.bestAsk,
    atrPercent: input.sources.technical.value.atrPercent,
    trendEfficiency: input.sources.technical.value.trendEfficiency,
    trendAlignment: input.sources.technical.value.trendAlignment,
    volumeRatio: input.sources.technical.value.volumeRatio,
    priceChangePercent: input.sources.openInterest.value.priceChangePercent,
    openInterestChangePercent:
      input.sources.openInterest.value.openInterestChangePercent,
    aggressiveDeltaNormalized:
      input.sources.tradeFlow.value.aggressiveDeltaNormalized,
    cvdSlopeNormalized: input.sources.tradeFlow.value.cvdSlopeNormalized,
    orderBookImbalance: input.sources.tradeFlow.value.orderBookImbalance,
    liquidationImbalance:
      input.sources.liquidation.value.liquidationImbalance,
    fundingRatePercent: input.sources.funding.value.fundingRatePercent,
    vwapDeviationAtr: input.sources.technical.value.vwapDeviationAtr,
    marketStructure: input.sources.technical.value.marketStructure,
    whaleDirectionalBias:
      input.sources.whale?.value.whaleDirectionalBias ?? null,
    whaleAuthenticity: input.sources.whale?.value.whaleAuthenticity ?? null,
  };

  try {
    validateDerivativeMarketSnapshot(snapshot);
  } catch {
    return {
      status: 'REJECTED',
      snapshot: null,
      rejectionReasons: ['INVALID_SNAPSHOT'],
      sourceAgesMs,
      liveExecutionAllowed: false,
    };
  }

  return {
    status: 'SYNCHRONIZED',
    snapshot,
    rejectionReasons: [],
    sourceAgesMs,
    liveExecutionAllowed: false,
  };
};
