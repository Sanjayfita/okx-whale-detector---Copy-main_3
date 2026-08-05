import { describe, expect, it, vi } from 'vitest';

import {
  runSimulateReleaseQualificationCli,
  simulateReleaseQualification,
} from '../src/tools/simulateReleaseQualification';

describe('simulateReleaseQualification', () => {
  it('covers qualified, incomplete, and blocked outcomes deterministically', () => {
    const first = simulateReleaseQualification();
    const second = simulateReleaseQualification();

    expect(first).toEqual(second);
    expect(first.qualified.outcome).toBe('QUALIFIED_FOR_TESTNET_REVIEW');
    expect(first.incomplete.outcome).toBe('MORE_EVIDENCE_REQUIRED');
    expect(first.blocked.outcome).toBe('BLOCKED');
    expect(first.deterministic).toBe(true);
    expect(first.testnetExecutionAuthorized).toBe(false);
    expect(first.orderExecutionAuthorized).toBe(false);
  });

  it('prints the safety results and returns zero', () => {
    const log = vi.fn();

    const exitCode = runSimulateReleaseQualificationCli(log);

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith(
      'Qualified scenario: QUALIFIED_FOR_TESTNET_REVIEW',
    );
    expect(log).toHaveBeenCalledWith('Incomplete scenario: MORE_EVIDENCE_REQUIRED');
    expect(log).toHaveBeenCalledWith('Blocked scenario: BLOCKED');
    expect(log).toHaveBeenCalledWith('Deterministic: true');
    expect(log).toHaveBeenCalledWith('Testnet execution authorized: false');
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
  });
});
