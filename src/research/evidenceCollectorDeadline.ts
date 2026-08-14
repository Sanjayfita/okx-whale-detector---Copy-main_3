export const EVIDENCE_COLLECTOR_DEADLINE_POLL_MS = 60_000 as const;

export interface EvidenceCollectorDeadlinePlan {
  readonly reached: boolean;
  readonly delayMs: number;
}

const requireTimestamp = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${label} must be a non-negative safe-integer UTC epoch millisecond timestamp`,
    );
  }
};

export const planEvidenceCollectorDeadline = (
  now: number,
  targetEndAt: number,
): EvidenceCollectorDeadlinePlan => {
  requireTimestamp(now, 'now');
  requireTimestamp(targetEndAt, 'targetEndAt');

  const remainingMs = targetEndAt - now;
  if (remainingMs <= 0) {
    return Object.freeze({ reached: true, delayMs: 0 });
  }

  return Object.freeze({
    reached: false,
    delayMs: Math.min(remainingMs, EVIDENCE_COLLECTOR_DEADLINE_POLL_MS),
  });
};
