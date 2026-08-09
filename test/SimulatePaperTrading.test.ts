import { describe, expect, it, vi } from 'vitest';

import { runPaperTradingSimulation } from '../src/tools/simulatePaperTrading';

describe('paper trading simulation', () => {
  it('runs deterministically across portfolio, valuation, and risk controls', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const first = runPaperTradingSimulation();
    const second = runPaperTradingSimulation();

    expect(second).toEqual(first);
    expect(first.fillCount).toBe(3);
    expect(first.openPositionCount).toBe(2);
    expect(first.allowedStatus).toBe('ALLOWED');
    expect(first.warningStatus).toBe('WARNING');
    expect(first.blockedStatus).toBe('BLOCKED');
    expect(Number.isFinite(first.equity)).toBe(true);
    expect(Number.isFinite(first.realizedPnl)).toBe(true);
    expect(Number.isFinite(first.unrealizedPnl)).toBe(true);

    log.mockRestore();
  });
});
