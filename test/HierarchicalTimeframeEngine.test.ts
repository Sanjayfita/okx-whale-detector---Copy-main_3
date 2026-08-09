import { describe, expect, it } from 'vitest';

import {
  evaluateTimeframeHierarchy,
  type TimeframeState,
} from '../src/timeframe/HierarchicalTimeframeEngine';

const AS_OF = 1_700_000_000_000;

const state = (
  timeframeId: string,
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  confidence = 0.8,
): TimeframeState => ({
  timeframeId,
  observedAt: AS_OF,
  direction,
  confidence,
  confirmed: true,
  context: [`${timeframeId}:${direction}`],
});

describe('evaluateTimeframeHierarchy', () => {
  it('allows an entry only when the configurable hierarchy aligns', () => {
    const decision = evaluateTimeframeHierarchy({
      asOf: AS_OF,
      states: [
        state('1D', 'BULLISH'),
        state('4H', 'BULLISH'),
        state('1H', 'BULLISH'),
        state('15M', 'BULLISH'),
        state('5M', 'BULLISH', 0.75),
        state('1M', 'BULLISH'),
      ],
    });

    expect(decision.macroBias).toBe('BULLISH');
    expect(decision.entryAllowed).toBe(true);
    expect(decision.alignmentScore).toBe(1);
    expect(decision.precisionConfirmed).toBe(true);
    expect(decision.rejectionReasons).toEqual([]);
    expect(decision.explanations.join(' ')).toContain('Resolved macro bias');
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('blocks lower-timeframe entries when higher timeframes conflict', () => {
    const decision = evaluateTimeframeHierarchy({
      asOf: AS_OF,
      states: [
        state('1D', 'BULLISH'),
        state('4H', 'BEARISH'),
        state('1H', 'BULLISH'),
        state('15M', 'BULLISH'),
        state('5M', 'BULLISH'),
      ],
    });

    expect(decision.macroBias).toBe('NEUTRAL');
    expect(decision.entryAllowed).toBe(false);
    expect(decision.rejectionReasons).toContain(
      'HIGHER_TIMEFRAME_BIAS_UNRESOLVED',
    );
  });

  it('rejects stale required timeframe states', () => {
    const staleDaily: TimeframeState = {
      ...state('1D', 'BULLISH'),
      observedAt: AS_OF - 3 * 24 * 60 * 60 * 1_000,
    };
    const decision = evaluateTimeframeHierarchy({
      asOf: AS_OF,
      states: [
        staleDaily,
        state('4H', 'BULLISH'),
        state('1H', 'BULLISH'),
        state('15M', 'BULLISH'),
        state('5M', 'BULLISH'),
      ],
    });

    expect(decision.entryAllowed).toBe(false);
    expect(decision.rejectionReasons).toContain('STALE_TIMEFRAME:1D');
  });
});
