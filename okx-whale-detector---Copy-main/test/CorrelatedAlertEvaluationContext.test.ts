import { describe, expect, it } from 'vitest';

import {
  createCorrelatedAlertEvaluationContext,
  createCorrelatedAlertSemanticFingerprint,
} from '../src/recording/correlatedAlertEvaluationContext';
import type { CorrelatedMarketSignal } from '../src/external/core/ExternalSignalCorrelationEngine';
import type { VersionedCorrelatedAlert } from '../src/types/correlatedAlert';
import type { MarketInstrumentConfig } from '../src/types/instrument';

const TIMESTAMP = Date.UTC(2026, 6, 29, 12, 0, 0);

const createSignal = (
  overrides: Partial<CorrelatedMarketSignal> = {},
): CorrelatedMarketSignal => ({
  symbol: 'BTC-USDT',
  bias: 'BULLISH',
  confidence: 70,
  alertImportance: 75,
  okxBias: 'BULLISH',
  okxConfidence: 80,
  externalBias: 'BULLISH',
  externalConfidence: 60,
  agreement: 'AGREEMENT',
  bullishExternalScore: 60,
  bearishExternalScore: 0,
  neutralExternalSignals: 0,
  consideredSignals: 1,
  ignoredSignals: 0,
  contributions: [
    {
      signalId: 'signal-1',
      underlyingEventId: 'event-1',
      provider: 'POLYMARKET',
      category: 'PREDICTION_POSITION',
      direction: 'BULLISH',
      effectiveConfidence: 60,
      signedScore: 60,
      description: 'Bullish signal',
    },
  ],
  reason: 'Sources agree.',
  timestamp: TIMESTAMP,
  ...overrides,
});

const createInstrument = (
  overrides: Partial<MarketInstrumentConfig> = {},
): MarketInstrumentConfig => ({
  instId: 'BTC-USDT',
  instType: 'SPOT',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
  ...overrides,
});

const createContext = (
  overrides: {
    instrument?: MarketInstrumentConfig;
    signal?: CorrelatedMarketSignal;
    sourceMarketTimestamp?: number;
    referenceTimestamp?: number;
    referenceMidpoint?: number;
    referenceBestBid?: number;
    referenceBestAsk?: number;
  } = {},
) =>
  createCorrelatedAlertEvaluationContext({
    instrument: overrides.instrument ?? createInstrument(),
    correlatedSignal: overrides.signal ?? createSignal(),
    sourceMarketTimestamp: overrides.sourceMarketTimestamp ?? TIMESTAMP,
    referenceTimestamp: overrides.referenceTimestamp ?? TIMESTAMP,
    referenceMidpoint: overrides.referenceMidpoint ?? 100.5,
    referenceBestBid: overrides.referenceBestBid ?? 100,
    referenceBestAsk: overrides.referenceBestAsk ?? 101,
  });

const createAlert = (
  overrides: Partial<VersionedCorrelatedAlert> = {},
): VersionedCorrelatedAlert => ({
  id: 'correlated-alert:test-session:1',
  sourceSessionId: 'test-session',
  alertSequence: 1,
  symbol: 'BTC-USDT',
  severity: 'STRONG',
  eventType: 'AGREEMENT',
  bias: 'BULLISH',
  relationship: 'AGREEMENT',
  combinedConfidence: 70,
  alertImportance: 75,
  okxConfidence: 80,
  externalEffectiveConfidence: 60,
  externalSignalsUsed: 1,
  ignoredExternalSignals: 0,
  reason: 'Sources agree.',
  createdAt: TIMESTAMP,
  ...overrides,
});

describe('correlated alert evaluation context', () => {
  it('captures a valid SPOT book with separate source biases', () => {
    expect(createContext()).toEqual({
      instId: 'BTC-USDT',
      instType: 'SPOT',
      okxBias: 'BULLISH',
      externalBias: 'BULLISH',
      sourceSignalTimestamp: TIMESTAMP,
      sourceMarketTimestamp: TIMESTAMP,
      referenceTimestamp: TIMESTAMP,
      referenceMidpoint: 100.5,
      referenceBestBid: 100,
      referenceBestAsk: 101,
      referenceSpread: 1,
      referenceSpreadPercent: (1 / 100.5) * 100,
      sourceSignalIds: ['signal-1'],
    });
  });

  it('uses authoritative SWAP instrument metadata', () => {
    const context = createContext({
      instrument: createInstrument({
        instId: 'BTC-USDT-SWAP',
        instType: 'SWAP',
      }),
      signal: createSignal({ symbol: 'BTC-USDT-SWAP' }),
    });

    expect(context).toMatchObject({
      instId: 'BTC-USDT-SWAP',
      instType: 'SWAP',
    });
  });

  it.each([
    ['AGREEMENT', 'BULLISH', 'BULLISH'],
    ['CONTRADICTION', 'BULLISH', 'BEARISH'],
    ['EXTERNAL_ONLY', 'NEUTRAL', 'BEARISH'],
  ] as const)(
    'captures %s OKX and external biases',
    (agreement, okxBias, externalBias) => {
      const context = createContext({
        signal: createSignal({ agreement, okxBias, externalBias }),
      });

      expect(context).toMatchObject({ okxBias, externalBias });
    },
  );

  it.each([
    ['invalid bid', { referenceBestBid: 0 }],
    ['invalid ask', { referenceBestAsk: Number.NaN }],
    ['crossed book', { referenceBestBid: 102, referenceBestAsk: 101 }],
    ['invalid midpoint', { referenceMidpoint: 100.6 }],
    ['invalid market timestamp', { sourceMarketTimestamp: -1 }],
    ['invalid reference timestamp', { referenceTimestamp: 1.5 }],
  ])('rejects %s', (_name, overrides) => {
    expect(createContext(overrides)).toBeUndefined();
  });

  it('rejects an invalid source signal timestamp', () => {
    expect(
      createContext({
        signal: createSignal({ timestamp: Number.NaN }),
      }),
    ).toBeUndefined();
  });

  it('does not leak later contribution mutations into captured context', () => {
    const signal = createSignal();
    const context = createContext({ signal });

    signal.contributions.push({
      ...signal.contributions[0]!,
      signalId: 'later-signal',
    });

    expect(context?.sourceSignalIds).toEqual(['signal-1']);
  });

  it('produces a stable semantic fingerprint', () => {
    const alert = createAlert();
    const context = createContext();

    expect(context).toBeDefined();
    expect(createCorrelatedAlertSemanticFingerprint(alert, context!)).toBe(
      createCorrelatedAlertSemanticFingerprint(alert, context!),
    );
  });

  it('changes the fingerprint when a meaningful field changes', () => {
    const context = createContext();
    const agreement = createAlert();
    const contradiction = createAlert({
      eventType: 'CONTRADICTION',
      relationship: 'CONTRADICTION',
    });

    expect(context).toBeDefined();
    expect(
      createCorrelatedAlertSemanticFingerprint(agreement, context!),
    ).not.toBe(
      createCorrelatedAlertSemanticFingerprint(contradiction, context!),
    );
  });
});
