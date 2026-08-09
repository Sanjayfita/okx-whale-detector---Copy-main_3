import { describe, expect, it } from 'vitest';

import {
  OrderBookObservationIndex,
  serializeOrderBookObservations,
} from '../src/evaluation/orderBookObservationIndex';
import type { ReconstructedOrderBookRecording } from '../src/evaluation/orderBookReconstructor';
import type { PriceObservation } from '../src/evaluation/alignmentTypes';
import { createInstrumentKey } from '../src/evaluation/alignmentValidation';

const NOW = Date.UTC(2026, 6, 29, 12);
const SPOT = createInstrumentKey('BTC-USDT', 'SPOT');
const SWAP = createInstrumentKey('BTC-USDT-SWAP', 'SWAP');

const observation = (
  eventTimestamp: number,
  recordOrdinal: number,
  overrides: Partial<PriceObservation> = {},
): PriceObservation => ({
  instrument: SPOT,
  source: 'ORDER_BOOK_MIDPOINT',
  eventTimestamp,
  availabilityTimestamp: eventTimestamp,
  recordOrdinal,
  midpoint: 100.5,
  recordingId: 'recording-one',
  sourceSessionId: 'session-one',
  ...overrides,
});

const index = (observations: PriceObservation[]) =>
  new OrderBookObservationIndex({
    observations,
  } as ReconstructedOrderBookRecording);

describe('OrderBookObservationIndex', () => {
  it('selects exact targets and the first observation after target', () => {
    const first = observation(NOW, 1);
    const second = observation(NOW + 1_000, 2);
    const subject = index([second, first]);

    expect(
      subject.findFirstAtOrAfter(SPOT, 'ORDER_BOOK_MIDPOINT', NOW),
    ).toEqual({ valid: true, value: first });
    expect(
      subject.findFirstAtOrAfter(SPOT, 'ORDER_BOOK_MIDPOINT', NOW + 1),
    ).toEqual({ valid: true, value: second });
  });

  it('returns deterministic inclusive ranges', () => {
    const first = observation(NOW, 1);
    const second = observation(NOW + 1_000, 2);
    const third = observation(NOW + 2_000, 3);
    const subject = index([third, first, second]);

    expect(
      subject.findRange(SPOT, 'ORDER_BOOK_MIDPOINT', NOW + 1, NOW + 2_000),
    ).toEqual({ valid: true, value: [second, third] });
  });

  it('keeps midpoint and bid/ask sources separate', () => {
    const midpoint = observation(NOW, 1);
    const bidAsk = observation(NOW, 1, {
      source: 'ORDER_BOOK_BID_ASK',
      midpoint: undefined,
      bestBid: 100,
      bestAsk: 101,
    });
    const subject = index([bidAsk, midpoint]);

    expect(
      subject.findFirstAtOrAfter(SPOT, 'ORDER_BOOK_MIDPOINT', NOW),
    ).toEqual({ valid: true, value: midpoint });
    expect(subject.findFirstAtOrAfter(SPOT, 'ORDER_BOOK_BID_ASK', NOW)).toEqual(
      { valid: true, value: bidAsk },
    );
  });

  it('keeps SPOT and SWAP instruments separate', () => {
    const swap = observation(NOW, 1, { instrument: SWAP });
    const subject = index([swap]);

    expect(
      subject.findFirstAtOrAfter(SPOT, 'ORDER_BOOK_MIDPOINT', NOW),
    ).toEqual({ valid: true, value: undefined });
    expect(
      subject.findFirstAtOrAfter(SWAP, 'ORDER_BOOK_MIDPOINT', NOW),
    ).toEqual({ valid: true, value: swap });
  });

  it('serializes observations deterministically by Phase A ordering', () => {
    const first = observation(NOW, 1);
    const second = observation(NOW + 1_000, 2);

    expect(serializeOrderBookObservations([second, first])).toBe(
      serializeOrderBookObservations([first, second]),
    );
  });
});
