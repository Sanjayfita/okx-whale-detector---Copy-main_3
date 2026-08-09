import { describe, expect, it } from 'vitest';

import { simulateLiveTradingReadinessTrendComparison } from '../src/tools/simulateLiveTradingReadinessTrendComparison';

describe('simulateLiveTradingReadinessTrendComparison', () => {
  it('deterministically covers improved, unchanged, and worsened outcomes', () => {
    const first = simulateLiveTradingReadinessTrendComparison();
    const second = simulateLiveTradingReadinessTrendComparison();

    expect(first).toEqual(second);
    expect(first.outcomes).toEqual(['IMPROVED', 'UNCHANGED', 'WORSENED']);
    expect(first.orderExecutionAuthorized).toBe(false);
  });
});
