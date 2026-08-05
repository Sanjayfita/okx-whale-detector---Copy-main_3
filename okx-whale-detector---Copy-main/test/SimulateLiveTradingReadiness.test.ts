import { describe, expect, it } from 'vitest';

import {
  runSimulateLiveTradingReadinessCli,
  simulateLiveTradingReadiness,
} from '../src/tools/simulateLiveTradingReadiness';

describe('live trading readiness simulation', () => {
  it('produces deterministic safety scenarios without authorizing orders', () => {
    const first = simulateLiveTradingReadiness();
    const second = simulateLiveTradingReadiness();

    expect(second).toEqual(first);
    expect(first.map((result) => result.status)).toEqual([
      'NOT_READY',
      'REVIEW_REQUIRED',
      'READY_FOR_MANUAL_REVIEW',
    ]);
    expect(first.every((result) => result.orderExecutionAuthorized === false)).toBe(true);
    expect(first[0]?.missingChecks).toEqual([
      'emergencyStopImplemented',
      'duplicateOrderProtectionImplemented',
    ]);
    expect(first[2]?.missingChecks).toEqual([]);
  });

  it('prints a deterministic offline report', () => {
    const messages: string[] = [];

    expect(runSimulateLiveTradingReadinessCli((message) => messages.push(message))).toBe(0);
    expect(messages[0]).toBe('LIVE TRADING READINESS SIMULATION');
    expect(messages).toContain(
      'all-checks-complete | status=READY_FOR_MANUAL_REVIEW | checks=11/11 | missing=none | orderExecutionAuthorized=false',
    );
    expect(messages.at(-1)).toBe(
      'Simulation complete. Real-order execution remains disabled.',
    );
  });
});
