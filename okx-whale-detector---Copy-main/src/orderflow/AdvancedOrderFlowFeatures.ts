import {
  requirePointInTimeSelection,
  selectPointInTimeRecords,
  type PointInTimeSelectionQuality,
} from '../data/PointInTimeRecords';
import type {
  FundingRateRecord,
  HistoricalTradeRecord,
  OpenInterestRecord,
  OrderBookDepthLevel,
  OrderBookSnapshotRecord,
} from '../data/ResearchMarketData';

export interface AdvancedOrderFlowPolicy {
  readonly depthLevels: number;
  readonly nearTouchWeightDecay: number;
  readonly deltaDivergenceThreshold: number;
  readonly absorptionAggressorFraction: number;
  readonly absorptionMaximumPriceDisplacementBps: number;
  readonly absorptionMinimumRemainingDepthFraction: number;
  readonly exhaustionVolumeFraction: number;
  readonly spoofingVisibleSizeMultiple: number;
  readonly spoofingMaximumLifetimeMs: number;
  readonly hiddenLiquidityExecutionMultiple: number;
}

export interface AdvancedOrderFlowDataPolicy {
  readonly tradeLookbackMs: number;
  readonly bookLookbackMs: number;
  readonly openInterestLookbackMs: number;
  readonly fundingLookbackMs: number;
  readonly maximumTradeAgeMs: number;
  readonly maximumBookAgeMs: number;
  readonly maximumOpenInterestAgeMs: number;
  readonly maximumFundingAgeMs: number;
}

export const DEFAULT_ADVANCED_ORDER_FLOW_POLICY: AdvancedOrderFlowPolicy = {
  depthLevels: 10,
  nearTouchWeightDecay: 0.75,
  deltaDivergenceThreshold: 0.2,
  absorptionAggressorFraction: 0.65,
  absorptionMaximumPriceDisplacementBps: 2,
  absorptionMinimumRemainingDepthFraction: 0.8,
  exhaustionVolumeFraction: 0.5,
  spoofingVisibleSizeMultiple: 4,
  spoofingMaximumLifetimeMs: 5_000,
  hiddenLiquidityExecutionMultiple: 2,
};

export const DEFAULT_ADVANCED_ORDER_FLOW_DATA_POLICY: AdvancedOrderFlowDataPolicy = {
  tradeLookbackMs: 15 * 60_000,
  bookLookbackMs: 60_000,
  openInterestLookbackMs: 24 * 60 * 60_000,
  fundingLookbackMs: 72 * 60 * 60_000,
  maximumTradeAgeMs: 5 * 60_000,
  maximumBookAgeMs: 5_000,
  maximumOpenInterestAgeMs: 30 * 60_000,
  maximumFundingAgeMs: 12 * 60 * 60_000,
};

export interface ResearchOnlyInference {
  readonly status: 'NOT_DETECTED' | 'INFERRED_WITH_LIMITATIONS';
  readonly side: 'BUY' | 'SELL' | null;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly limitations: readonly string[];
}

export interface AdvancedOrderFlowDataQuality {
  readonly status: 'PASSED';
  readonly trades: PointInTimeSelectionQuality;
  readonly books: PointInTimeSelectionQuality;
  readonly openInterest: PointInTimeSelectionQuality;
  readonly funding: PointInTimeSelectionQuality;
}

export interface AdvancedOrderFlowVector {
  readonly observedAt: number;
  readonly sourceMaxObservedAt: number;
  readonly sourceMaxReceivedAt: number;
  readonly multiLevelOrderBookImbalance: number;
  readonly queueImbalance: number | null;
  readonly liquidityImbalance: number;
  readonly aggressiveBuyContracts: number;
  readonly aggressiveSellContracts: number;
  readonly deltaContracts: number;
  readonly normalizedDelta: number;
  readonly cumulativeVolumeDelta: number;
  readonly deltaDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  readonly openInterestChangePercent: number;
  readonly openInterestState: 'EXPANSION' | 'CONTRACTION' | 'STABLE';
  readonly fundingAccelerationPerHour: number;
  readonly absorption: 'BUY_ABSORBED' | 'SELL_ABSORBED' | 'NONE';
  readonly exhaustion: 'BUY_EXHAUSTION' | 'SELL_EXHAUSTION' | 'NONE';
  readonly spoofingInference: ResearchOnlyInference;
  readonly hiddenLiquidityInference: ResearchOnlyInference;
  readonly dataQuality: AdvancedOrderFlowDataQuality;
  readonly directTradingSignalAllowed: false;
  readonly liveExecutionAllowed: false;
}

const average = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const sumContracts = (levels: readonly OrderBookDepthLevel[]): number =>
  levels.reduce((sum, level) => sum + level.contracts, 0);

const weightedDepth = (
  levels: readonly OrderBookDepthLevel[],
  decay: number,
): number =>
  levels.reduce(
    (sum, level, index) => sum + level.contracts * decay ** index,
    0,
  );

const imbalance = (bid: number, ask: number): number =>
  bid + ask === 0 ? 0 : (bid - ask) / (bid + ask);

const openInterestChange = (
  records: readonly OpenInterestRecord[],
): number => {
  const first = records[0]?.contracts;
  const last = records.at(-1)?.contracts;
  return first === undefined || last === undefined || first <= 0
    ? 0
    : ((last - first) / first) * 100;
};

const fundingAcceleration = (
  records: readonly FundingRateRecord[],
): number => {
  const first = records[0];
  const last = records.at(-1);
  if (first === undefined || last === undefined || first === last) {
    return 0;
  }
  const elapsedHours = (last.fundingTime - first.fundingTime) / 3_600_000;
  return elapsedHours <= 0
    ? 0
    : (last.fundingRate - first.fundingRate) / elapsedHours;
};

const inferSpoofing = (input: {
  readonly books: readonly OrderBookSnapshotRecord[];
  readonly trades: readonly HistoricalTradeRecord[];
  readonly policy: AdvancedOrderFlowPolicy;
}): ResearchOnlyInference => {
  const limitations = [
    'OKX public aggregated depth does not expose persistent order identifiers',
    'Cancellation, replacement, aggregation, and genuine risk reduction can look identical',
    'This inference must never be promoted without paired real-market validation',
  ];
  if (input.books.length < 2) {
    return {
      status: 'NOT_DETECTED',
      side: null,
      confidence: 0,
      evidence: [],
      limitations,
    };
  }

  for (let index = 0; index < input.books.length - 1; index += 1) {
    const current = input.books[index];
    const next = input.books[index + 1];
    if (current === undefined || next === undefined) {
      continue;
    }
    if (next.observedAt - current.observedAt > input.policy.spoofingMaximumLifetimeMs) {
      continue;
    }
    const visible = [...current.bids, ...current.asks]
      .slice(0, input.policy.depthLevels * 2)
      .map((level) => level.contracts);
    const baseline = Math.max(average(visible), Number.EPSILON);
    const sides = [
      ['BUY', current.bids, next.bids] as const,
      ['SELL', current.asks, next.asks] as const,
    ];
    for (const [side, before, after] of sides) {
      for (const level of before.slice(0, input.policy.depthLevels)) {
        if (level.contracts < baseline * input.policy.spoofingVisibleSizeMultiple) {
          continue;
        }
        const remaining = after.find((candidate) => candidate.price === level.price);
        const disappeared =
          remaining === undefined || remaining.contracts < level.contracts * 0.2;
        const executed = input.trades
          .filter(
            (trade) =>
              trade.observedAt >= current.observedAt &&
              trade.observedAt <= next.observedAt &&
              trade.price === level.price,
          )
          .reduce((sum, trade) => sum + trade.contracts, 0);
        if (disappeared && executed < level.contracts * 0.2) {
          return {
            status: 'INFERRED_WITH_LIMITATIONS',
            side,
            confidence: Math.min(0.8, level.contracts / (baseline * 10)),
            evidence: [
              `${side} depth ${level.contracts} at ${level.price} disappeared within ${next.observedAt - current.observedAt}ms`,
              `Only ${executed} contracts were observed trading at that price`,
            ],
            limitations,
          };
        }
      }
    }
  }
  return {
    status: 'NOT_DETECTED',
    side: null,
    confidence: 0,
    evidence: [],
    limitations,
  };
};

const inferHiddenLiquidity = (input: {
  readonly books: readonly OrderBookSnapshotRecord[];
  readonly trades: readonly HistoricalTradeRecord[];
  readonly policy: AdvancedOrderFlowPolicy;
}): ResearchOnlyInference => {
  const limitations = [
    'Displayed depth is aggregated and sampled rather than order-level',
    'Executed volume above displayed size may result from replenishment by multiple participants',
    'Inference is research-only and cannot establish a true iceberg order',
  ];
  const executionByPrice = new Map<number, { buy: number; sell: number }>();
  for (const trade of input.trades) {
    const current = executionByPrice.get(trade.price) ?? { buy: 0, sell: 0 };
    if (trade.side === 'BUY') {
      current.buy += trade.contracts;
    } else {
      current.sell += trade.contracts;
    }
    executionByPrice.set(trade.price, current);
  }
  for (const [price, execution] of executionByPrice) {
    const displayedAsk = Math.max(
      0,
      ...input.books.flatMap((book) =>
        book.asks
          .filter((level) => level.price === price)
          .map((level) => level.contracts),
      ),
    );
    const displayedBid = Math.max(
      0,
      ...input.books.flatMap((book) =>
        book.bids
          .filter((level) => level.price === price)
          .map((level) => level.contracts),
      ),
    );
    if (
      displayedAsk > 0 &&
      execution.buy >= displayedAsk * input.policy.hiddenLiquidityExecutionMultiple
    ) {
      return {
        status: 'INFERRED_WITH_LIMITATIONS',
        side: 'SELL',
        confidence: Math.min(0.75, execution.buy / (displayedAsk * 5)),
        evidence: [
          `${execution.buy} aggressive-buy contracts executed at ${price} versus maximum displayed ask ${displayedAsk}`,
        ],
        limitations,
      };
    }
    if (
      displayedBid > 0 &&
      execution.sell >= displayedBid * input.policy.hiddenLiquidityExecutionMultiple
    ) {
      return {
        status: 'INFERRED_WITH_LIMITATIONS',
        side: 'BUY',
        confidence: Math.min(0.75, execution.sell / (displayedBid * 5)),
        evidence: [
          `${execution.sell} aggressive-sell contracts executed at ${price} versus maximum displayed bid ${displayedBid}`,
        ],
        limitations,
      };
    }
  }
  return {
    status: 'NOT_DETECTED',
    side: null,
    confidence: 0,
    evidence: [],
    limitations,
  };
};

export const calculateAdvancedOrderFlowFeatures = (input: {
  readonly asOf: number;
  readonly trades: readonly HistoricalTradeRecord[];
  readonly books: readonly OrderBookSnapshotRecord[];
  readonly openInterest: readonly OpenInterestRecord[];
  readonly funding: readonly FundingRateRecord[];
  readonly priorCumulativeVolumeDelta?: number;
  readonly policy?: AdvancedOrderFlowPolicy;
  readonly dataPolicy?: Partial<AdvancedOrderFlowDataPolicy>;
}): AdvancedOrderFlowVector => {
  const policy = input.policy ?? DEFAULT_ADVANCED_ORDER_FLOW_POLICY;
  const dataPolicy: AdvancedOrderFlowDataPolicy = {
    ...DEFAULT_ADVANCED_ORDER_FLOW_DATA_POLICY,
    ...input.dataPolicy,
  };
  if (!Number.isSafeInteger(input.asOf) || input.asOf < 0) {
    throw new Error('asOf must be a non-negative safe integer');
  }
  if (
    !Number.isSafeInteger(policy.depthLevels) ||
    policy.depthLevels <= 0 ||
    policy.nearTouchWeightDecay <= 0 ||
    policy.nearTouchWeightDecay > 1
  ) {
    throw new Error('invalid order-flow depth policy');
  }
  const firstRecord = [
    ...input.trades,
    ...input.books,
    ...input.openInterest,
    ...input.funding,
  ][0];
  if (firstRecord === undefined) {
    throw new Error('advanced order flow requires market data');
  }
  const instrumentId = firstRecord.instrumentId;
  const tradeSelection = selectPointInTimeRecords({
    sourceName: 'advanced order flow trades',
    instrumentId,
    asOf: input.asOf,
    records: input.trades,
    policy: {
      lookbackMs: dataPolicy.tradeLookbackMs,
      maximumAgeMs: dataPolicy.maximumTradeAgeMs,
      minimumRecords: 1,
    },
  });
  const bookSelection = selectPointInTimeRecords({
    sourceName: 'advanced order flow books',
    instrumentId,
    asOf: input.asOf,
    records: input.books,
    policy: {
      lookbackMs: dataPolicy.bookLookbackMs,
      maximumAgeMs: dataPolicy.maximumBookAgeMs,
      minimumRecords: 1,
    },
  });
  const openInterestSelection = selectPointInTimeRecords({
    sourceName: 'advanced order flow open interest',
    instrumentId,
    asOf: input.asOf,
    records: input.openInterest,
    policy: {
      lookbackMs: dataPolicy.openInterestLookbackMs,
      maximumAgeMs: dataPolicy.maximumOpenInterestAgeMs,
      minimumRecords: 0,
    },
  });
  const fundingSelection = selectPointInTimeRecords({
    sourceName: 'advanced order flow funding',
    instrumentId,
    asOf: input.asOf,
    records: input.funding.filter((record) => record.fundingTime <= input.asOf),
    policy: {
      lookbackMs: dataPolicy.fundingLookbackMs,
      maximumAgeMs: dataPolicy.maximumFundingAgeMs,
      minimumRecords: 0,
    },
  });
  const trades = requirePointInTimeSelection(tradeSelection);
  const books = requirePointInTimeSelection(bookSelection);
  const openInterest = requirePointInTimeSelection(openInterestSelection);
  const funding = requirePointInTimeSelection(fundingSelection);
  const currentBook = books.at(-1);
  if (currentBook === undefined) {
    throw new Error('advanced order flow requires at least one order book');
  }
  const bids = currentBook.bids.slice(0, policy.depthLevels);
  const asks = currentBook.asks.slice(0, policy.depthLevels);
  const bidDepth = sumContracts(bids);
  const askDepth = sumContracts(asks);
  const weightedBid = weightedDepth(bids, policy.nearTouchWeightDecay);
  const weightedAsk = weightedDepth(asks, policy.nearTouchWeightDecay);
  const bidOrders = bids.flatMap((level) =>
    level.orderCount === null ? [] : [level.orderCount],
  );
  const askOrders = asks.flatMap((level) =>
    level.orderCount === null ? [] : [level.orderCount],
  );
  const aggressiveBuyContracts = trades
    .filter((trade) => trade.side === 'BUY')
    .reduce((sum, trade) => sum + trade.contracts, 0);
  const aggressiveSellContracts = trades
    .filter((trade) => trade.side === 'SELL')
    .reduce((sum, trade) => sum + trade.contracts, 0);
  const totalAggressive = aggressiveBuyContracts + aggressiveSellContracts;
  const deltaContracts = aggressiveBuyContracts - aggressiveSellContracts;
  const normalizedDelta =
    totalAggressive === 0 ? 0 : deltaContracts / totalAggressive;
  const firstTradePrice = trades[0]?.price ?? 0;
  const lastTradePrice = trades.at(-1)?.price ?? firstTradePrice;
  const priceChange = lastTradePrice - firstTradePrice;
  const deltaDivergence =
    normalizedDelta >= policy.deltaDivergenceThreshold && priceChange < 0
      ? 'BEARISH'
      : normalizedDelta <= -policy.deltaDivergenceThreshold && priceChange > 0
        ? 'BULLISH'
        : 'NONE';
  const oi = openInterestChange(openInterest);
  const openInterestState =
    oi > 0.1 ? 'EXPANSION' : oi < -0.1 ? 'CONTRACTION' : 'STABLE';

  const firstBook = books[0] ?? currentBook;
  const initialMid =
    ((firstBook.bids[0]?.price ?? 0) + (firstBook.asks[0]?.price ?? 0)) / 2;
  const currentMid =
    ((currentBook.bids[0]?.price ?? 0) + (currentBook.asks[0]?.price ?? 0)) / 2;
  const displacementBps =
    initialMid <= 0 ? 0 : (Math.abs(currentMid - initialMid) / initialMid) * 10_000;
  const buyFraction =
    totalAggressive === 0 ? 0 : aggressiveBuyContracts / totalAggressive;
  const sellFraction =
    totalAggressive === 0 ? 0 : aggressiveSellContracts / totalAggressive;
  const initialAskDepth = sumContracts(
    firstBook.asks.slice(0, policy.depthLevels),
  );
  const initialBidDepth = sumContracts(
    firstBook.bids.slice(0, policy.depthLevels),
  );
  const absorption =
    buyFraction >= policy.absorptionAggressorFraction &&
    displacementBps <= policy.absorptionMaximumPriceDisplacementBps &&
    askDepth >= initialAskDepth * policy.absorptionMinimumRemainingDepthFraction
      ? 'BUY_ABSORBED'
      : sellFraction >= policy.absorptionAggressorFraction &&
          displacementBps <= policy.absorptionMaximumPriceDisplacementBps &&
          bidDepth >=
            initialBidDepth * policy.absorptionMinimumRemainingDepthFraction
        ? 'SELL_ABSORBED'
        : 'NONE';

  const split = Math.floor(trades.length / 2);
  const early = trades.slice(0, split);
  const late = trades.slice(split);
  const earlyBuy = early
    .filter((trade) => trade.side === 'BUY')
    .reduce((sum, trade) => sum + trade.contracts, 0);
  const lateBuy = late
    .filter((trade) => trade.side === 'BUY')
    .reduce((sum, trade) => sum + trade.contracts, 0);
  const earlySell = early
    .filter((trade) => trade.side === 'SELL')
    .reduce((sum, trade) => sum + trade.contracts, 0);
  const lateSell = late
    .filter((trade) => trade.side === 'SELL')
    .reduce((sum, trade) => sum + trade.contracts, 0);
  const exhaustion =
    earlyBuy > 0 && lateBuy <= earlyBuy * policy.exhaustionVolumeFraction
      ? 'BUY_EXHAUSTION'
      : earlySell > 0 && lateSell <= earlySell * policy.exhaustionVolumeFraction
        ? 'SELL_EXHAUSTION'
        : 'NONE';
  const selectedRecords = [
    ...trades,
    ...books,
    ...openInterest,
    ...funding,
  ];
  const sourceMaxObservedAt = Math.max(
    ...selectedRecords.map((record) => record.observedAt),
  );
  const sourceMaxReceivedAt = Math.max(
    ...selectedRecords.map((record) => record.receivedAt),
  );

  return {
    observedAt: input.asOf,
    sourceMaxObservedAt,
    sourceMaxReceivedAt,
    multiLevelOrderBookImbalance: imbalance(bidDepth, askDepth),
    queueImbalance:
      bidOrders.length === bids.length && askOrders.length === asks.length
        ? imbalance(
            bidOrders.reduce((sum, value) => sum + value, 0),
            askOrders.reduce((sum, value) => sum + value, 0),
          )
        : null,
    liquidityImbalance: imbalance(weightedBid, weightedAsk),
    aggressiveBuyContracts,
    aggressiveSellContracts,
    deltaContracts,
    normalizedDelta,
    cumulativeVolumeDelta:
      (input.priorCumulativeVolumeDelta ?? 0) + deltaContracts,
    deltaDivergence,
    openInterestChangePercent: oi,
    openInterestState,
    fundingAccelerationPerHour: fundingAcceleration(funding),
    absorption,
    exhaustion,
    spoofingInference: inferSpoofing({ books, trades, policy }),
    hiddenLiquidityInference: inferHiddenLiquidity({ books, trades, policy }),
    dataQuality: {
      status: 'PASSED',
      trades: tradeSelection.quality,
      books: bookSelection.quality,
      openInterest: openInterestSelection.quality,
      funding: fundingSelection.quality,
    },
    directTradingSignalAllowed: false,
    liveExecutionAllowed: false,
  };
};
