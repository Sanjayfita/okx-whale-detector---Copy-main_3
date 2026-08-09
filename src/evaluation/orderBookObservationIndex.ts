import {
  AlignmentReason,
  alignmentFailure,
  alignmentSuccess,
  type AlignmentValidationResult,
  type InstrumentKey,
  type PriceObservation,
  type PriceSource,
} from './alignmentTypes';
import {
  comparePriceObservations,
  sortPriceObservations,
} from './alignmentOrdering';
import type { ReconstructedOrderBookRecording } from './orderBookReconstructor';
import {
  serializeInstrumentKey,
  validateInstrumentKey,
} from './alignmentValidation';

export type OrderBookPriceSource = 'ORDER_BOOK_MIDPOINT' | 'ORDER_BOOK_BID_ASK';

const sourceIsOrderBook = (
  source: PriceSource,
): source is OrderBookPriceSource =>
  source === 'ORDER_BOOK_MIDPOINT' || source === 'ORDER_BOOK_BID_ASK';

const indexKey = (
  instrument: InstrumentKey,
  source: OrderBookPriceSource,
): string => `${serializeInstrumentKey(instrument)}\u001f${source}`;

export class OrderBookObservationIndex {
  private readonly observationsByKey = new Map<
    string,
    readonly PriceObservation[]
  >();

  public constructor(reconstruction: ReconstructedOrderBookRecording) {
    const mutable = new Map<string, PriceObservation[]>();

    for (const observation of reconstruction.observations) {
      if (!sourceIsOrderBook(observation.source)) {
        continue;
      }
      const key = indexKey(observation.instrument, observation.source);
      const observations = mutable.get(key);
      if (observations) {
        observations.push(observation);
      } else {
        mutable.set(key, [observation]);
      }
    }

    for (const [key, observations] of mutable) {
      this.observationsByKey.set(
        key,
        Object.freeze(sortPriceObservations(observations)),
      );
    }
  }

  public findFirstAtOrAfter(
    instrument: InstrumentKey,
    source: OrderBookPriceSource,
    targetTimestamp: number,
  ): AlignmentValidationResult<PriceObservation | undefined> {
    const candidatesResult = this.getCandidates(
      instrument,
      source,
      targetTimestamp,
    );
    if (!candidatesResult.valid) {
      return candidatesResult;
    }
    return alignmentSuccess(candidatesResult.value[0]);
  }

  public findRange(
    instrument: InstrumentKey,
    source: OrderBookPriceSource,
    startTimestamp: number,
    endTimestamp: number,
  ): AlignmentValidationResult<readonly PriceObservation[]> {
    if (!Number.isSafeInteger(endTimestamp) || endTimestamp < startTimestamp) {
      return alignmentFailure(AlignmentReason.TIMESTAMP_RANGE_INVALID);
    }
    const candidatesResult = this.getCandidates(
      instrument,
      source,
      startTimestamp,
    );
    if (!candidatesResult.valid) {
      return candidatesResult;
    }

    return alignmentSuccess(
      Object.freeze(
        candidatesResult.value.filter(
          (observation) => observation.eventTimestamp <= endTimestamp,
        ),
      ),
    );
  }

  public getCandidates(
    instrument: InstrumentKey,
    source: OrderBookPriceSource,
    targetTimestamp: number,
  ): AlignmentValidationResult<readonly PriceObservation[]> {
    const instrumentResult = validateInstrumentKey(instrument);
    if (!instrumentResult.valid) {
      return instrumentResult;
    }
    if (!Number.isSafeInteger(targetTimestamp) || targetTimestamp < 0) {
      return alignmentFailure(AlignmentReason.TIMESTAMP_UNIT_INVALID);
    }

    const observations =
      this.observationsByKey.get(indexKey(instrument, source)) ?? [];
    let lower = 0;
    let upper = observations.length;

    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      const observation = observations[middle];
      if (observation && observation.eventTimestamp < targetTimestamp) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }

    return alignmentSuccess(observations.slice(lower));
  }
}

export const serializeOrderBookObservations = (
  observations: readonly PriceObservation[],
): string => JSON.stringify([...observations].sort(comparePriceObservations));
