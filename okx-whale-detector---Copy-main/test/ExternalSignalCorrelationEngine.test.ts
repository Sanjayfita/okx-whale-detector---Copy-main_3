import { describe, expect, it } from 'vitest';

import { ExternalSignalCorrelationEngine } from '../src/external/core/ExternalSignalCorrelationEngine';
import type { EffectiveExternalSignal } from '../src/external/types/ExternalWhaleSignal';
import type { MarketSignal } from '../src/types/signal';

const okxSignal = (
  bias: MarketSignal['bias'],
  confidence = 60,
): MarketSignal => ({
  bias,
  confidence,
  reason: 'Test OKX signal',
  bidPressure: bias === 'BULLISH' ? 70 : 30,
  askPressure: bias === 'BEARISH' ? 70 : 30,
  netPressure: bias === 'BULLISH' ? 40 : bias === 'BEARISH' ? -40 : 0,
  timestamp: 1_000,
});

const externalSignal = (
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN',
  effectiveConfidence: number,
  id = direction,
): EffectiveExternalSignal => ({
  signal: {
    id,
    underlyingEventId: `event-${id}`,
    provider: 'WHALE_ALERT',
    category: 'EXCHANGE_INFLOW',
    direction,
    occurredAt: 900,
    receivedAt: 950,
    confidence: effectiveConfidence,
    asset: 'BTC',
    description: `${direction} external signal`,
    evidence: [{ provider: 'WHALE_ALERT', receivedAt: 950 }],
  },
  relevance: 1,
  freshness: 1,
  effectiveConfidence,
});

describe('ExternalSignalCorrelationEngine', () => {
  it('raises confidence when OKX and external evidence agree', () => {
    const engine = new ExternalSignalCorrelationEngine();
    const result = engine.correlate(
      'BTC-USDT',
      okxSignal('BULLISH'),
      [externalSignal('BULLISH', 60)],
      1_000,
    );

    expect(result.bias).toBe('BULLISH');
    expect(result.agreement).toBe('AGREEMENT');
    expect(result.confidence).toBeGreaterThan(60);
    expect(result.alertImportance).toBe(result.confidence);
    expect(result.consideredSignals).toBe(1);
  });

  it('reduces confidence when external evidence contradicts OKX', () => {
    const engine = new ExternalSignalCorrelationEngine();
    const result = engine.correlate(
      'BTC-USDT',
      okxSignal('BULLISH'),
      [externalSignal('BEARISH', 60)],
      1_000,
    );

    expect(result.agreement).toBe('CONTRADICTION');
    expect(result.confidence).toBeLessThan(60);
    expect(result.alertImportance).toBe(60);
    expect(result.reason).toContain('conflicts');
  });

  it('allows external evidence to provide direction when OKX is neutral', () => {
    const engine = new ExternalSignalCorrelationEngine();
    const result = engine.correlate(
      'BTC-USDT',
      okxSignal('NEUTRAL', 0),
      [externalSignal('BEARISH', 80)],
      1_000,
    );

    expect(result.bias).toBe('BEARISH');
    expect(result.agreement).toBe('EXTERNAL_ONLY');
    expect(result.externalConfidence).toBe(80);
    expect(result.alertImportance).toBe(80);
  });

  it('does not let neutral or unknown evidence vote directionally', () => {
    const engine = new ExternalSignalCorrelationEngine();
    const result = engine.correlate(
      'BTC-USDT',
      okxSignal('BULLISH'),
      [externalSignal('NEUTRAL', 80), externalSignal('UNKNOWN', 90)],
      1_000,
    );

    expect(result.bias).toBe('BULLISH');
    expect(result.agreement).toBe('OKX_ONLY');
    expect(result.alertImportance).toBe(60);
    expect(result.neutralExternalSignals).toBe(2);
    expect(result.externalConfidence).toBe(0);
  });

  it('ignores weak, stale, or irrelevant external evidence', () => {
    const engine = new ExternalSignalCorrelationEngine({
      minimumEffectiveConfidence: 10,
    });
    const weak = externalSignal('BEARISH', 5);
    const irrelevant = {
      ...externalSignal('BEARISH', 70, 'irrelevant'),
      relevance: 0,
      effectiveConfidence: 0,
    };
    const stale = {
      ...externalSignal('BEARISH', 70, 'stale'),
      freshness: 0,
      effectiveConfidence: 0,
    };

    const result = engine.correlate(
      'BTC-USDT',
      okxSignal('BULLISH'),
      [weak, irrelevant, stale],
      1_000,
    );

    expect(result.agreement).toBe('OKX_ONLY');
    expect(result.consideredSignals).toBe(0);
    expect(result.ignoredSignals).toBe(3);
  });

  it('balances opposing external evidence instead of counting signal volume', () => {
    const engine = new ExternalSignalCorrelationEngine();
    const result = engine.correlate(
      'BTC-USDT',
      okxSignal('NEUTRAL', 0),
      [
        externalSignal('BULLISH', 70, 'bull'),
        externalSignal('BEARISH', 70, 'bear'),
      ],
      1_000,
    );

    expect(result.externalBias).toBe('NEUTRAL');
    expect(result.externalConfidence).toBe(0);
    expect(result.bias).toBe('NEUTRAL');
  });

  it('rejects invalid correlation weights', () => {
    expect(
      () =>
        new ExternalSignalCorrelationEngine({
          okxWeight: 0,
          externalWeight: 0,
        }),
    ).toThrow('weights');
  });

  it('rejects non-finite and out-of-range confidence configuration', () => {
    expect(
      () =>
        new ExternalSignalCorrelationEngine({
          contradictionPenalty: Number.NaN,
        }),
    ).toThrow('confidence settings');
    expect(
      () =>
        new ExternalSignalCorrelationEngine({
          maximumConfidence: 101,
        }),
    ).toThrow('confidence settings');
  });
});
