import { describe, expect, it } from 'vitest';

import { ExternalSignalRelevanceEngine } from '../src/external/core/ExternalSignalRelevanceEngine';
import type { ExternalWhaleSignal } from '../src/external/types/ExternalWhaleSignal';

const signal: ExternalWhaleSignal = {
  id: 'signal-1',
  underlyingEventId: 'tx:abc',
  provider: 'WHALE_ALERT',
  category: 'EXCHANGE_INFLOW',
  direction: 'BEARISH',
  occurredAt: 1_000,
  receivedAt: 1_100,
  confidence: 80,
  asset: 'BTC',
  description: 'BTC moved to an exchange',
  evidence: [
    {
      provider: 'WHALE_ALERT',
      receivedAt: 1_100,
    },
  ],
};

describe('ExternalSignalRelevanceEngine', () => {
  it('gives an exact symbol match full relevance', () => {
    const engine = new ExternalSignalRelevanceEngine();
    const result = engine.evaluate(
      { ...signal, symbol: 'BTC-USDT' },
      'BTC-USDT',
      1_000,
    );

    expect(result.relevance).toBe(1);
    expect(result.effectiveConfidence).toBe(80);
  });

  it('matches an asset to its market', () => {
    const engine = new ExternalSignalRelevanceEngine();
    const result = engine.evaluate(signal, 'BTC-USDT', 1_000);

    expect(result.relevance).toBe(0.9);
    expect(result.effectiveConfidence).toBe(72);
  });

  it('applies category freshness decay', () => {
    const engine = new ExternalSignalRelevanceEngine({
      categoryMaximumAgeMs: {
        EXCHANGE_INFLOW: 1_000,
      },
    });
    const result = engine.evaluate(signal, 'BTC-USDT', 1_500);

    expect(result.freshness).toBe(0.5);
    expect(result.effectiveConfidence).toBe(36);
  });

  it('does not apply an unrelated asset signal', () => {
    const engine = new ExternalSignalRelevanceEngine();
    const result = engine.evaluate(signal, 'XAU-USDT-SWAP', 1_000);

    expect(result.relevance).toBe(0);
    expect(result.effectiveConfidence).toBe(0);
  });
});
