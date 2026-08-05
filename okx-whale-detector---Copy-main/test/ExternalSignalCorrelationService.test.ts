import { beforeEach, describe, expect, it } from 'vitest';

import { ExternalSignalCorrelationService } from '../src/external/core/ExternalSignalCorrelationService';
import type { ExternalWhaleSignal } from '../src/external/types/ExternalWhaleSignal';
import type { MarketSignal } from '../src/types/signal';

const createMarketSignal = (
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

const createExternalSignal = (
  overrides: Partial<ExternalWhaleSignal> = {},
): ExternalWhaleSignal => ({
  id: 'signal-1',
  underlyingEventId: 'event-1',
  provider: 'POLYMARKET',
  category: 'PREDICTION_POSITION',
  direction: 'BULLISH',
  occurredAt: 1_000,
  receivedAt: 1_050,
  confidence: 80,
  asset: 'BTC',
  description: 'BTC Polymarket signal',
  evidence: [{ provider: 'POLYMARKET', receivedAt: 1_050 }],
  ...overrides,
});

describe('ExternalSignalCorrelationService', () => {
  let service: ExternalSignalCorrelationService;

  beforeEach(() => {
    service = new ExternalSignalCorrelationService();
  });

  it('correlates bullish OKX and bullish Polymarket as AGREEMENT', () => {
    service.addSignal(createExternalSignal(), 1_100);

    const evaluation = service.correlateMarketSignal(
      'BTC-USDT',
      createMarketSignal('BULLISH'),
      1_100,
    );

    expect(evaluation.correlatedSignal?.agreement).toBe('AGREEMENT');
    expect(evaluation.correlatedSignal?.externalBias).toBe('BULLISH');
  });

  it('correlates bullish OKX and bearish Polymarket as CONTRADICTION', () => {
    service.addSignal(createExternalSignal({ direction: 'BEARISH' }), 1_100);

    const evaluation = service.correlateMarketSignal(
      'BTC-USDT',
      createMarketSignal('BULLISH'),
      1_100,
    );

    expect(evaluation.correlatedSignal?.agreement).toBe('CONTRADICTION');
    expect(evaluation.correlatedSignal?.externalBias).toBe('BEARISH');
  });

  it('uses external evidence when OKX is neutral', () => {
    service.addSignal(createExternalSignal(), 1_100);

    const evaluation = service.correlateMarketSignal(
      'BTC-USDT',
      createMarketSignal('NEUTRAL', 0),
      1_100,
    );

    expect(evaluation.correlatedSignal?.agreement).toBe('EXTERNAL_ONLY');
    expect(evaluation.correlatedSignal?.bias).toBe('BULLISH');
  });

  it('ignores stale Polymarket signals', () => {
    const staleSignal = createExternalSignal({
      occurredAt: 1_000,
      receivedAt: 1_050,
    });
    const staleService = new ExternalSignalCorrelationService({
      categoryMaximumAgeMs: { PREDICTION_POSITION: 1 },
    });

    staleService.addSignal(staleSignal, 1_050);

    const evaluation = staleService.correlateMarketSignal(
      'BTC-USDT',
      createMarketSignal('BULLISH'),
      2_000,
    );

    expect(evaluation.correlatedSignal?.consideredSignals).toBe(0);
    expect(evaluation.correlatedSignal?.ignoredSignals).toBe(1);
  });

  it('treats ETH Polymarket signals as irrelevant to BTC-USDT', () => {
    service.addSignal(createExternalSignal({ asset: 'ETH' }), 1_100);

    const evaluation = service.correlateMarketSignal(
      'BTC-USDT',
      createMarketSignal('BULLISH'),
      1_100,
    );

    expect(evaluation.correlatedSignal?.consideredSignals).toBe(0);
    expect(evaluation.correlatedSignal?.ignoredSignals).toBe(1);
  });

  it('preserves the existing OKX result when no external signals are present', () => {
    const evaluation = service.correlateMarketSignal(
      'BTC-USDT',
      createMarketSignal('BULLISH'),
      1_100,
    );

    expect(evaluation.marketSignal.bias).toBe('BULLISH');
    expect(evaluation.marketSignal.confidence).toBe(60);
    expect(evaluation.correlatedSignal?.agreement).toBe('OKX_ONLY');
  });

  it('combines multiple fresh external signals correctly', () => {
    service.addSignal(
      createExternalSignal({ id: 'bull', underlyingEventId: 'bull' }),
      1_100,
    );
    service.addSignal(
      createExternalSignal({
        id: 'bear',
        underlyingEventId: 'bear',
        direction: 'BEARISH',
        asset: 'BTC',
      }),
      1_100,
    );

    const evaluation = service.correlateMarketSignal(
      'BTC-USDT',
      createMarketSignal('NEUTRAL', 0),
      1_100,
    );

    expect(evaluation.correlatedSignal?.consideredSignals).toBe(2);
    expect(evaluation.correlatedSignal?.externalBias).toBe('NEUTRAL');
    expect(evaluation.correlatedSignal?.agreement).toBe('NEUTRAL');
  });

  it('accepts BTC signals for both BTC-USDT and BTC-USDT-SWAP', () => {
    service.addSignal(createExternalSignal(), 1_100);

    const spotEvaluation = service.correlateMarketSignal(
      'BTC-USDT',
      createMarketSignal('NEUTRAL', 0),
      1_100,
    );
    const swapEvaluation = service.correlateMarketSignal(
      'BTC-USDT-SWAP',
      createMarketSignal('NEUTRAL', 0),
      1_100,
    );

    expect(spotEvaluation.correlatedSignal?.consideredSignals).toBe(1);
    expect(swapEvaluation.correlatedSignal?.consideredSignals).toBe(1);
  });
});
