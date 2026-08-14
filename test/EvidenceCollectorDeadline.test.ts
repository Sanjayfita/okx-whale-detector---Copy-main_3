import { describe, expect, it } from 'vitest';

import { THIRTY_DAYS_MS } from '../src/research/evidenceCollectorCheckpoint';
import {
  EVIDENCE_COLLECTOR_DEADLINE_POLL_MS,
  planEvidenceCollectorDeadline,
} from '../src/research/evidenceCollectorDeadline';

describe('30-day evidence collector deadline planning', () => {
  it('never passes the full 30-day delay directly to a Node timer', () => {
    const now = 1_700_000_000_000;
    const plan = planEvidenceCollectorDeadline(now, now + THIRTY_DAYS_MS);

    expect(THIRTY_DAYS_MS).toBeGreaterThan(2_147_483_647);
    expect(plan).toEqual({
      reached: false,
      delayMs: EVIDENCE_COLLECTOR_DEADLINE_POLL_MS,
    });
    expect(plan.delayMs).toBeLessThan(2_147_483_647);
  });

  it('uses the exact remaining delay inside the final polling interval', () => {
    const now = 1_700_000_000_000;

    expect(planEvidenceCollectorDeadline(now, now + 15_000)).toEqual({
      reached: false,
      delayMs: 15_000,
    });
  });

  it('marks the target reached instead of arming another timer', () => {
    const target = 1_700_000_000_000;

    expect(planEvidenceCollectorDeadline(target, target)).toEqual({
      reached: true,
      delayMs: 0,
    });
    expect(planEvidenceCollectorDeadline(target + 1, target)).toEqual({
      reached: true,
      delayMs: 0,
    });
  });

  it('rejects invalid timestamps', () => {
    expect(() => planEvidenceCollectorDeadline(Number.NaN, 1)).toThrow();
    expect(() => planEvidenceCollectorDeadline(1, -1)).toThrow();
  });
});
