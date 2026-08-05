import {
  AlignmentReason,
  type AlignmentCompleteness,
  type InstrumentKey,
  type PriceObservation,
  type ValidityGapReason,
} from './alignmentTypes';
import {
  type InvalidNormalizedOrderBookRecord,
  type NormalizedBookLevel,
  type NormalizedOrderBookEntry,
  type NormalizedOrderBookRecord,
  type NormalizedOrderBookRecording,
} from './orderBookNormalization';
import { serializeInstrumentKey } from './alignmentValidation';

export type OrderBookTransportState =
  'UNINITIALIZED' | 'SYNCHRONIZED' | 'GAP_DETECTED' | 'INVALID';

export type OrderBookPriceValidity =
  'VALID' | 'EMPTY_SIDE' | 'CROSSED' | 'INVALID_LEVELS';

export interface OrderBookValidityGap {
  instrument: InstrumentKey;
  startTimestamp: number;
  endTimestamp?: number;
  reason: ValidityGapReason;
}

export interface OrderBookReconstructionIssue {
  instrument: InstrumentKey;
  startTimestamp: number;
  endTimestamp?: number;
  reason: AlignmentReason;
  completeness: Exclude<AlignmentCompleteness, 'COMPLETE'>;
  recordOrdinal: number;
}

export interface OrderBookInstrumentState {
  instrument: InstrumentKey;
  transportState: OrderBookTransportState;
  priceValidity: OrderBookPriceValidity;
  lastSeqId: number | null;
  lastEventTimestamp: number | null;
  sawValidSnapshot: boolean;
  retainedBidLevels: number;
  retainedAskLevels: number;
}

export interface ReconstructedOrderBookRecording {
  recording: NormalizedOrderBookRecording;
  observations: readonly PriceObservation[];
  validityGaps: readonly OrderBookValidityGap[];
  issues: readonly OrderBookReconstructionIssue[];
  finalStates: readonly OrderBookInstrumentState[];
  exactDuplicateCount: number;
}

interface MutableInstrumentState {
  instrument: InstrumentKey;
  bids: Map<number, number>;
  asks: Map<number, number>;
  transportState: OrderBookTransportState;
  priceValidity: OrderBookPriceValidity;
  lastSeqId: number | null;
  lastEventTimestamp: number | null;
  sawValidSnapshot: boolean;
  activeGap?: {
    startTimestamp: number;
    reason: ValidityGapReason;
  };
  activeIssue?: {
    startTimestamp: number;
    reason: AlignmentReason;
    completeness: Exclude<AlignmentCompleteness, 'COMPLETE'>;
    recordOrdinal: number;
  };
  seenSequences: Map<string, string>;
}

const stateKey = (instrument: InstrumentKey): string =>
  serializeInstrumentKey(instrument);

const sequenceIdentity = (record: NormalizedOrderBookRecord): string =>
  `${record.action}\u001f${record.seqId}\u001f${record.prevSeqId}`;

const levelSignature = (levels: readonly NormalizedBookLevel[]): string =>
  [...levels]
    .sort(
      (left, right) =>
        left.price - right.price ||
        left.size - right.size ||
        (left.liquidatedOrders ?? 0) - (right.liquidatedOrders ?? 0) ||
        (left.orderCount ?? 0) - (right.orderCount ?? 0),
    )
    .map(
      (level) =>
        `${level.price}:${level.size}:${level.liquidatedOrders ?? ''}:${level.orderCount ?? ''}`,
    )
    .join(',');

const recordSignature = (record: NormalizedOrderBookRecord): string =>
  [
    record.eventTimestamp,
    levelSignature(record.bids),
    levelSignature(record.asks),
  ].join('\u001f');

const createState = (instrument: InstrumentKey): MutableInstrumentState => ({
  instrument,
  bids: new Map(),
  asks: new Map(),
  transportState: 'UNINITIALIZED',
  priceValidity: 'EMPTY_SIDE',
  lastSeqId: null,
  lastEventTimestamp: null,
  sawValidSnapshot: false,
  seenSequences: new Map(),
});

const applyLevels = (
  side: Map<number, number>,
  levels: readonly NormalizedBookLevel[],
): void => {
  for (const level of levels) {
    if (level.size === 0) {
      side.delete(level.price);
    } else {
      side.set(level.price, level.size);
    }
  }
};

const bestBid = (bids: ReadonlyMap<number, number>): number | undefined => {
  let best: number | undefined;
  for (const price of bids.keys()) {
    if (best === undefined || price > best) {
      best = price;
    }
  }
  return best;
};

const bestAsk = (asks: ReadonlyMap<number, number>): number | undefined => {
  let best: number | undefined;
  for (const price of asks.keys()) {
    if (best === undefined || price < best) {
      best = price;
    }
  }
  return best;
};

export class OfflineOrderBookReconstructor {
  private readonly states = new Map<string, MutableInstrumentState>();
  private readonly observations: PriceObservation[] = [];
  private readonly validityGaps: OrderBookValidityGap[] = [];
  private readonly issues: OrderBookReconstructionIssue[] = [];
  private exactDuplicateCount = 0;

  public reconstruct(
    recording: NormalizedOrderBookRecording,
  ): ReconstructedOrderBookRecording {
    this.states.clear();
    this.observations.length = 0;
    this.validityGaps.length = 0;
    this.issues.length = 0;
    this.exactDuplicateCount = 0;

    for (const instrument of recording.header.instruments) {
      const key = {
        instId: instrument.instId,
        instType: instrument.instType,
      } as const;
      this.states.set(stateKey(key), createState(key));
    }

    for (const entry of recording.entries) {
      this.applyEntry(entry);
    }

    for (const state of this.states.values()) {
      if (recording.termination === 'TRUNCATED' && !state.activeGap) {
        const base = state.lastEventTimestamp ?? recording.header.startedAt;
        this.openGap(
          state,
          Number.isSafeInteger(base + 1) ? base + 1 : base,
          AlignmentReason.RECORDING_TRUNCATED,
        );
      }
      this.finishOpenState(state);
    }

    return {
      recording,
      observations: Object.freeze(
        [...this.observations].sort(
          (left, right) =>
            left.eventTimestamp - right.eventTimestamp ||
            left.availabilityTimestamp - right.availabilityTimestamp ||
            left.recordOrdinal - right.recordOrdinal ||
            left.source.localeCompare(right.source),
        ),
      ),
      validityGaps: Object.freeze(
        [...this.validityGaps].sort(
          (left, right) =>
            left.startTimestamp - right.startTimestamp ||
            serializeInstrumentKey(left.instrument).localeCompare(
              serializeInstrumentKey(right.instrument),
            ) ||
            left.reason.localeCompare(right.reason),
        ),
      ),
      issues: Object.freeze(
        [...this.issues].sort(
          (left, right) =>
            left.startTimestamp - right.startTimestamp ||
            left.recordOrdinal - right.recordOrdinal ||
            left.reason.localeCompare(right.reason),
        ),
      ),
      finalStates: Object.freeze(
        [...this.states.values()]
          .map((state): OrderBookInstrumentState => ({
            instrument: state.instrument,
            transportState: state.transportState,
            priceValidity: state.priceValidity,
            lastSeqId: state.lastSeqId,
            lastEventTimestamp: state.lastEventTimestamp,
            sawValidSnapshot: state.sawValidSnapshot,
            retainedBidLevels: state.bids.size,
            retainedAskLevels: state.asks.size,
          }))
          .sort((left, right) =>
            serializeInstrumentKey(left.instrument).localeCompare(
              serializeInstrumentKey(right.instrument),
            ),
          ),
      ),
      exactDuplicateCount: this.exactDuplicateCount,
    };
  }

  private applyEntry(entry: NormalizedOrderBookEntry): void {
    if (!entry.valid) {
      this.applyInvalidEntry(entry);
      return;
    }

    const record = entry.record;
    const state = this.states.get(stateKey(record.instrument));
    if (!state) {
      return;
    }

    const identity = sequenceIdentity(record);
    const signature = recordSignature(record);
    const previousSignature = state.seenSequences.get(identity);
    if (previousSignature !== undefined) {
      if (previousSignature === signature) {
        this.exactDuplicateCount += 1;
        return;
      }

      state.transportState = 'INVALID';
      this.openGap(state, record.eventTimestamp, AlignmentReason.BOOK_INVALID);
      this.openIssue(
        state,
        record.eventTimestamp,
        AlignmentReason.CONFLICTING_DUPLICATE,
        'AMBIGUOUS',
        record.recordOrdinal,
      );
      return;
    }
    state.seenSequences.set(identity, signature);

    if (record.action === 'snapshot') {
      this.applySnapshot(state, record);
    } else {
      this.applyDelta(state, record);
    }
  }

  private applyInvalidEntry(entry: InvalidNormalizedOrderBookRecord): void {
    if (!entry.instrument) {
      return;
    }
    const state = this.states.get(stateKey(entry.instrument));
    if (!state) {
      return;
    }
    const timestamp =
      entry.eventTimestamp ??
      entry.availabilityTimestamp ??
      state.lastEventTimestamp ??
      0;

    state.transportState = 'INVALID';
    state.priceValidity = 'INVALID_LEVELS';
    this.openGap(state, timestamp, AlignmentReason.BOOK_INVALID);
    this.openIssue(
      state,
      timestamp,
      entry.failure.primaryReason,
      entry.failure.completeness,
      entry.recordOrdinal,
    );
  }

  private applySnapshot(
    state: MutableInstrumentState,
    record: NormalizedOrderBookRecord,
  ): void {
    if (
      state.lastEventTimestamp !== null &&
      record.eventTimestamp < state.lastEventTimestamp
    ) {
      state.transportState = 'GAP_DETECTED';
      this.openGap(
        state,
        record.eventTimestamp,
        AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
      );
      return;
    }

    this.closeRecovery(state, record.eventTimestamp);
    state.bids = new Map();
    state.asks = new Map();
    applyLevels(state.bids, record.bids);
    applyLevels(state.asks, record.asks);
    state.transportState = 'SYNCHRONIZED';
    state.lastSeqId = record.seqId;
    state.lastEventTimestamp = record.eventTimestamp;
    state.sawValidSnapshot = true;
    this.emitIfValid(state, record);
  }

  private applyDelta(
    state: MutableInstrumentState,
    record: NormalizedOrderBookRecord,
  ): void {
    if (state.transportState === 'UNINITIALIZED' || state.lastSeqId === null) {
      this.openIssue(
        state,
        record.eventTimestamp,
        AlignmentReason.NO_INITIAL_SNAPSHOT,
        'MISSING',
        record.recordOrdinal,
      );
      return;
    }
    if (state.transportState !== 'SYNCHRONIZED') {
      return;
    }
    if (
      state.lastEventTimestamp !== null &&
      record.eventTimestamp < state.lastEventTimestamp
    ) {
      state.transportState = 'GAP_DETECTED';
      this.openGap(
        state,
        record.eventTimestamp,
        AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
      );
      return;
    }
    if (
      record.seqId <= state.lastSeqId ||
      record.prevSeqId !== state.lastSeqId
    ) {
      state.transportState = 'GAP_DETECTED';
      const reason =
        record.seqId <= state.lastSeqId
          ? AlignmentReason.EVENT_TIME_OUT_OF_ORDER
          : AlignmentReason.SEQUENCE_GAP;
      this.openGap(state, record.eventTimestamp, reason);
      return;
    }

    applyLevels(state.bids, record.bids);
    applyLevels(state.asks, record.asks);
    state.lastSeqId = record.seqId;
    state.lastEventTimestamp = record.eventTimestamp;
    this.emitIfValid(state, record);
  }

  private emitIfValid(
    state: MutableInstrumentState,
    record: NormalizedOrderBookRecord,
  ): void {
    const bid = bestBid(state.bids);
    const ask = bestAsk(state.asks);

    if (bid === undefined || ask === undefined) {
      state.priceValidity = 'EMPTY_SIDE';
      this.openGap(state, record.eventTimestamp, AlignmentReason.BOOK_INVALID);
      return;
    }
    if (ask < bid) {
      state.priceValidity = 'CROSSED';
      this.openGap(state, record.eventTimestamp, AlignmentReason.BOOK_INVALID);
      return;
    }

    state.priceValidity = 'VALID';
    if (state.activeGap?.reason === AlignmentReason.BOOK_INVALID) {
      this.closeGap(state, record.eventTimestamp);
    }

    const common = {
      instrument: state.instrument,
      eventTimestamp: record.eventTimestamp,
      availabilityTimestamp: record.availabilityTimestamp,
      recordOrdinal: record.recordOrdinal,
      recordingId: record.recordingId,
      sourceSessionId: record.sourceSessionId,
    };
    this.observations.push(
      {
        ...common,
        source: 'ORDER_BOOK_MIDPOINT',
        midpoint: (bid + ask) / 2,
      },
      {
        ...common,
        source: 'ORDER_BOOK_BID_ASK',
        bestBid: bid,
        bestAsk: ask,
      },
    );
  }

  private openGap(
    state: MutableInstrumentState,
    startTimestamp: number,
    reason: ValidityGapReason,
  ): void {
    if (state.activeGap?.reason === reason) {
      return;
    }
    if (state.activeGap) {
      this.closeGap(state, startTimestamp);
    }
    state.activeGap = { startTimestamp, reason };
  }

  private closeGap(state: MutableInstrumentState, endTimestamp: number): void {
    const gap = state.activeGap;
    if (!gap) {
      return;
    }
    if (endTimestamp > gap.startTimestamp) {
      this.validityGaps.push({
        instrument: state.instrument,
        startTimestamp: gap.startTimestamp,
        endTimestamp,
        reason: gap.reason,
      });
    }
    state.activeGap = undefined;
  }

  private openIssue(
    state: MutableInstrumentState,
    startTimestamp: number,
    reason: AlignmentReason,
    completeness: Exclude<AlignmentCompleteness, 'COMPLETE'>,
    recordOrdinal: number,
  ): void {
    if (state.activeIssue) {
      return;
    }
    state.activeIssue = {
      startTimestamp,
      reason,
      completeness,
      recordOrdinal,
    };
  }

  private closeRecovery(
    state: MutableInstrumentState,
    endTimestamp: number,
  ): void {
    this.closeGap(state, endTimestamp);
    if (state.activeIssue) {
      this.issues.push({
        instrument: state.instrument,
        ...state.activeIssue,
        endTimestamp,
      });
      state.activeIssue = undefined;
    }
  }

  private finishOpenState(state: MutableInstrumentState): void {
    if (state.activeGap) {
      this.validityGaps.push({
        instrument: state.instrument,
        ...state.activeGap,
      });
      state.activeGap = undefined;
    }
    if (state.activeIssue) {
      this.issues.push({
        instrument: state.instrument,
        ...state.activeIssue,
      });
      state.activeIssue = undefined;
    }
  }
}

export const reconstructOrderBooks = (
  recording: NormalizedOrderBookRecording,
): ReconstructedOrderBookRecording =>
  new OfflineOrderBookReconstructor().reconstruct(recording);
