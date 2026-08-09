import { describe, expect, it } from 'vitest';

import { CorrelatedAlertEngine } from '../src/alerts/CorrelatedAlertEngine';
import { ExternalSignalCorrelationEngine } from '../src/external/core/ExternalSignalCorrelationEngine';

import type { EffectiveExternalSignal } from '../src/external/types/ExternalWhaleSignal';
import type { MarketSignal } from '../src/types/signal';

const createMarketSignal = (
  bias: MarketSignal['bias'],
  confidence: number,
): MarketSignal => ({
  bias,
  confidence,
  reason: 'Production reachability test',
  bidPressure: bias === 'BULLISH' ? 100 : 0,
  askPressure: bias === 'BEARISH' ? 100 : 0,
  netPressure: bias === 'BULLISH' ? 100 : bias === 'BEARISH' ? -100 : 0,
  timestamp: 1_000,
});

const createExternalSignal = (
  direction: 'BULLISH' | 'BEARISH',
  effectiveConfidence: number,
  relevance = 1,
): EffectiveExternalSignal => ({
  signal: {
    id: `production-${direction}`,
    underlyingEventId: `production-${direction}`,
    provider: 'POLYMARKET',
    category: 'PREDICTION_POSITION',
    direction,
    occurredAt: 1_000,
    receivedAt: 1_000,
    confidence: effectiveConfidence,
    symbol: 'BTC-USDT',
    description: 'Production reachability test',
    evidence: [{ provider: 'POLYMARKET', receivedAt: 1_000 }],
  },
  relevance,
  freshness: 1,
  effectiveConfidence,
});

describe('production correlated alert reachability', () => {
  it('emits maximum agreement under current production defaults', () => {
    const marketSignal = createMarketSignal('BULLISH', 100);
    const correlatedSignal = new ExternalSignalCorrelationEngine().correlate(
      'BTC-USDT',
      marketSignal,
      [createExternalSignal('BULLISH', 100)],
      1_000,
    );

    expect(correlatedSignal).toMatchObject({
      agreement: 'AGREEMENT',
      confidence: 100,
    });
    expect(
      new CorrelatedAlertEngine({
        clock: () => 2_000,
        sourceSessionId: 'production-reachability-test',
      }).evaluate({
        marketSignal,
        correlatedSignal,
      }),
    ).toMatchObject({
      relationship: 'AGREEMENT',
      severity: 'CRITICAL',
    });
  });

  it('emits strong contradiction while preserving low directional confidence', () => {
    const marketSignal = createMarketSignal('BULLISH', 100);
    const correlatedSignal = new ExternalSignalCorrelationEngine().correlate(
      'BTC-USDT',
      marketSignal,
      [createExternalSignal('BEARISH', 100)],
      1_000,
    );

    expect(correlatedSignal).toMatchObject({
      agreement: 'CONTRADICTION',
      confidence: 25,
      alertImportance: 100,
    });
    expect(
      new CorrelatedAlertEngine({
        clock: () => 2_000,
        sourceSessionId: 'production-reachability-test',
      }).evaluate({
        marketSignal,
        correlatedSignal,
      }),
    ).toMatchObject({
      relationship: 'CONTRADICTION',
      combinedConfidence: 25,
      alertImportance: 100,
      severity: 'CRITICAL',
    });
  });

  it('does not emit weak agreement or weak contradiction', () => {
    const correlationEngine = new ExternalSignalCorrelationEngine();
    const alertEngine = new CorrelatedAlertEngine({
      clock: () => 2_000,
      sourceSessionId: 'production-reachability-test',
    });
    const weakAgreementMarket = createMarketSignal('BULLISH', 20);
    const weakAgreement = correlationEngine.correlate(
      'BTC-USDT',
      weakAgreementMarket,
      [createExternalSignal('BULLISH', 100)],
      1_000,
    );
    const weakContradictionMarket = createMarketSignal('BULLISH', 100);
    const weakContradiction = correlationEngine.correlate(
      'ETH-USDT',
      weakContradictionMarket,
      [createExternalSignal('BEARISH', 40)],
      1_000,
    );

    expect(weakAgreement).toMatchObject({
      agreement: 'AGREEMENT',
      alertImportance: 52,
    });
    expect(
      alertEngine.evaluate({
        marketSignal: weakAgreementMarket,
        correlatedSignal: weakAgreement,
      }),
    ).toBeUndefined();
    expect(weakContradiction).toMatchObject({
      agreement: 'CONTRADICTION',
      alertImportance: 40,
    });
    expect(
      alertEngine.evaluate({
        marketSignal: weakContradictionMarket,
        correlatedSignal: weakContradiction,
      }),
    ).toBeUndefined();
  });

  it('keeps OKX-only, filtered-external, and external-only results suppressed', () => {
    const correlationEngine = new ExternalSignalCorrelationEngine();
    const alertEngine = new CorrelatedAlertEngine({
      clock: () => 2_000,
      sourceSessionId: 'production-reachability-test',
    });
    const strongMarket = createMarketSignal('BULLISH', 100);
    const neutralMarket = createMarketSignal('NEUTRAL', 0);
    const cases = [
      correlationEngine.correlate('BTC-USDT', strongMarket, [], 1_000),
      correlationEngine.correlate(
        'BTC-USDT',
        strongMarket,
        [createExternalSignal('BEARISH', 100, 0)],
        1_000,
      ),
      correlationEngine.correlate(
        'BTC-USDT',
        neutralMarket,
        [createExternalSignal('BULLISH', 100)],
        1_000,
      ),
    ];

    expect(cases.map((result) => result.agreement)).toEqual([
      'OKX_ONLY',
      'OKX_ONLY',
      'EXTERNAL_ONLY',
    ]);

    for (const correlatedSignal of cases) {
      expect(
        alertEngine.evaluate({
          marketSignal:
            correlatedSignal.agreement === 'EXTERNAL_ONLY'
              ? neutralMarket
              : strongMarket,
          correlatedSignal,
        }),
      ).toBeUndefined();
    }
  });

  it.each([
    [60, 30, 'WATCH'],
    [70, 40, 'STRONG'],
    [90, 50, 'CRITICAL'],
  ] as const)(
    'reaches production-emitted severity %s/%s as %s',
    (okxConfidence, externalConfidence, severity) => {
      const marketSignal = createMarketSignal('BULLISH', okxConfidence);
      const correlatedSignal = new ExternalSignalCorrelationEngine().correlate(
        'BTC-USDT',
        marketSignal,
        [createExternalSignal('BULLISH', externalConfidence)],
        1_000,
      );

      expect(
        new CorrelatedAlertEngine({
          clock: () => 2_000,
          sourceSessionId: 'production-reachability-test',
        }).evaluate({
          marketSignal,
          correlatedSignal,
        }),
      ).toMatchObject({ severity });
    },
  );
});
