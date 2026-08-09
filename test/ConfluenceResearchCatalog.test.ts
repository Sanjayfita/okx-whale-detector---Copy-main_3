import { describe, expect, it } from 'vitest';

import { assessConfluenceReadiness } from '../src/research/ConfluenceResearchCatalog';

describe('assessConfluenceReadiness', () => {
  it('marks testable features ready only when their data prerequisites exist', () => {
    const decisions = assessConfluenceReadiness({
      availableCapabilities: [
        'CONFIRMED_CANDLES',
        'PUBLIC_TRADES',
        'BEST_BID_AND_ASK',
      ],
    });

    expect(
      decisions.find(
        (decision) => decision.featureName === 'cumulative_volume_delta',
      )?.status,
    ).toBe('READY_FOR_ABLATION');
    expect(
      decisions.find((decision) => decision.featureName === 'spread_filter')
        ?.status,
    ).toBe('READY_FOR_ABLATION');
    expect(
      decisions.find((decision) => decision.featureName === 'liquidity_sweep')
        ?.status,
    ).toBe('BLOCKED_MISSING_DATA');
    expect(
      decisions.find((decision) => decision.featureName === 'liquidity_sweep')
        ?.missingCapabilities,
    ).toContain('SEQUENCE_COMPLETE_DEPTH');
  });

  it('keeps unsupported iceberg, positioning, and news features out of strategies', () => {
    const decisions = assessConfluenceReadiness({
      availableCapabilities: [
        'PUBLIC_TRADES',
        'SEQUENCE_COMPLETE_DEPTH',
        'CONFIRMED_CANDLES',
      ],
    });

    for (const featureName of [
      'iceberg_inference',
      'positioning_long_short_imbalance',
      'news_event_blackout',
    ]) {
      const decision = decisions.find(
        (candidate) => candidate.featureName === featureName,
      );
      expect(decision?.status).toBe(
        'UNSUPPORTED_WITH_CURRENT_PUBLIC_DATA',
      );
      expect(decision?.retainedInStrategy).toBe(false);
    }
  });
});
