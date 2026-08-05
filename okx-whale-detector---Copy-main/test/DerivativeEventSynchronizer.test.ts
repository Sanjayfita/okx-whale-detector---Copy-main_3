import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DERIVATIVE_FRESHNESS_POLICY,
  type DerivativeSnapshotSources,
  synchronizeDerivativeSnapshot,
} from '../src/derivatives/DerivativeEventSynchronizer';

const at = 1_700_000_000_000;

const source = <T>(value: T, observedAt = at) => ({
  observedAt,
  receivedAt: observedAt + 10,
  value,
});

const validSources = (): DerivativeSnapshotSources => ({
  instrumentId: 'BTC-USDT-SWAP',
  book: source({ bestBid: 99.99, bestAsk: 100.01 }),
  markIndex: source({ markPrice: 100, indexPrice: 100 }),
  openInterest: source({
    priceChangePercent: 0.2,
    openInterestChangePercent: 0.1,
  }),
  funding: source({ fundingRatePercent: 0.01 }),
  tradeFlow: source({
    aggressiveDeltaNormalized: 0.4,
    cvdSlopeNormalized: 0.3,
    orderBookImbalance: 0.2,
  }),
  liquidation: source({ liquidationImbalance: 0.1 }),
  technical: source({
    atrPercent: 1,
    trendEfficiency: 0.6,
    trendAlignment: 0.7,
    volumeRatio: 1.4,
    vwapDeviationAtr: 0.5,
    marketStructure: 'BULLISH_BREAK',
  }),
  whale: null,
});

describe('synchronizeDerivativeSnapshot', () => {
  it('builds an immutable point-in-time snapshot from fresh sources', () => {
    const result = synchronizeDerivativeSnapshot({
      asOf: at + 100,
      sources: validSources(),
    });

    expect(result.status).toBe('SYNCHRONIZED');
    expect(result.snapshot).toMatchObject({
      instrumentId: 'BTC-USDT-SWAP',
      markPrice: 100,
      openInterestChangePercent: 0.1,
      whaleAuthenticity: null,
    });
    expect(result.liveExecutionAllowed).toBe(false);
  });

  it('rejects stale and excessively skewed sources', () => {
    const sources = validSources();
    const staleObservedAt =
      at - DEFAULT_DERIVATIVE_FRESHNESS_POLICY.maxAgeMs.book - 1;

    const result = synchronizeDerivativeSnapshot({
      asOf: at,
      sources: {
        ...sources,
        book: source({ bestBid: 99.99, bestAsk: 100.01 }, staleObservedAt),
      },
    });

    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReasons).toContain('SOURCE_STALE');
    expect(result.rejectionReasons).toContain('SOURCE_SKEW_TOO_LARGE');
  });

  it('rejects future leakage beyond the configured tolerance', () => {
    const sources = validSources();
    const result = synchronizeDerivativeSnapshot({
      asOf: at,
      sources: {
        ...sources,
        funding: source(
          { fundingRatePercent: 0.01 },
          at + DEFAULT_DERIVATIVE_FRESHNESS_POLICY.maxFutureSkewMs + 1,
        ),
      },
    });

    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReasons).toContain('SOURCE_FROM_FUTURE');
  });

  it('rejects malformed crossed-book snapshots after synchronization', () => {
    const sources = validSources();
    const result = synchronizeDerivativeSnapshot({
      asOf: at,
      sources: {
        ...sources,
        book: source({ bestBid: 100.01, bestAsk: 99.99 }),
      },
    });

    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReasons).toEqual(['INVALID_SNAPSHOT']);
  });
});
