export interface PointInTimeRecord {
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly receivedAt: number;
}

export interface PointInTimeSelectionPolicy {
  readonly lookbackMs: number;
  readonly maximumAgeMs: number;
  readonly minimumRecords: number;
}

export type PointInTimeSelectionRejectionReason =
  | 'INSUFFICIENT_POINT_IN_TIME_RECORDS'
  | 'LATEST_RECORD_TOO_STALE';

export interface PointInTimeSelectionQuality {
  readonly sourceName: string;
  readonly inputCount: number;
  readonly selectedCount: number;
  readonly excludedFutureObservationCount: number;
  readonly excludedUnavailableAtDecisionCount: number;
  readonly excludedOutsideLookbackCount: number;
  readonly latestObservedAt: number | null;
  readonly latestReceivedAt: number | null;
  readonly ageMs: number | null;
  readonly status: 'PASSED' | 'REJECTED';
  readonly rejectionReasons: readonly PointInTimeSelectionRejectionReason[];
}

export interface PointInTimeSelection<T extends PointInTimeRecord> {
  readonly records: readonly T[];
  readonly quality: PointInTimeSelectionQuality;
}

const requireTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const validatePolicy = (policy: PointInTimeSelectionPolicy): void => {
  if (!Number.isSafeInteger(policy.lookbackMs) || policy.lookbackMs < 0) {
    throw new Error('lookbackMs must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(policy.maximumAgeMs) || policy.maximumAgeMs < 0) {
    throw new Error('maximumAgeMs must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(policy.minimumRecords) || policy.minimumRecords < 0) {
    throw new Error('minimumRecords must be a non-negative safe integer');
  }
};

export const selectPointInTimeRecords = <T extends PointInTimeRecord>(input: {
  readonly sourceName: string;
  readonly instrumentId: string;
  readonly asOf: number;
  readonly records: readonly T[];
  readonly policy: PointInTimeSelectionPolicy;
}): PointInTimeSelection<T> => {
  requireTimestamp(input.asOf, 'asOf');
  validatePolicy(input.policy);
  if (input.sourceName.trim().length === 0) {
    throw new Error('sourceName must not be empty');
  }
  if (input.instrumentId.trim().length === 0) {
    throw new Error('instrumentId must not be empty');
  }

  let excludedFutureObservationCount = 0;
  let excludedUnavailableAtDecisionCount = 0;
  let excludedOutsideLookbackCount = 0;
  const windowStart = Math.max(0, input.asOf - input.policy.lookbackMs);
  const selected: T[] = [];

  for (const record of input.records) {
    if (record.instrumentId !== input.instrumentId) {
      throw new Error(
        `${input.sourceName} instrument mismatch: expected ${input.instrumentId}, received ${record.instrumentId}`,
      );
    }
    requireTimestamp(record.observedAt, `${input.sourceName}.observedAt`);
    requireTimestamp(record.receivedAt, `${input.sourceName}.receivedAt`);
    if (record.observedAt > input.asOf) {
      excludedFutureObservationCount += 1;
      continue;
    }
    if (record.receivedAt > input.asOf) {
      excludedUnavailableAtDecisionCount += 1;
      continue;
    }
    if (record.observedAt < windowStart) {
      excludedOutsideLookbackCount += 1;
      continue;
    }
    selected.push(record);
  }

  selected.sort(
    (left, right) =>
      left.observedAt - right.observedAt ||
      left.receivedAt - right.receivedAt,
  );
  const latest = selected.at(-1);
  const ageMs = latest === undefined ? null : input.asOf - latest.observedAt;
  const rejectionReasons: PointInTimeSelectionRejectionReason[] = [];
  if (selected.length < input.policy.minimumRecords) {
    rejectionReasons.push('INSUFFICIENT_POINT_IN_TIME_RECORDS');
  }
  if (ageMs !== null && ageMs > input.policy.maximumAgeMs) {
    rejectionReasons.push('LATEST_RECORD_TOO_STALE');
  }

  return {
    records: selected,
    quality: {
      sourceName: input.sourceName,
      inputCount: input.records.length,
      selectedCount: selected.length,
      excludedFutureObservationCount,
      excludedUnavailableAtDecisionCount,
      excludedOutsideLookbackCount,
      latestObservedAt: latest?.observedAt ?? null,
      latestReceivedAt: latest?.receivedAt ?? null,
      ageMs,
      status: rejectionReasons.length === 0 ? 'PASSED' : 'REJECTED',
      rejectionReasons,
    },
  };
};

export const requirePointInTimeSelection = <T extends PointInTimeRecord>(
  selection: PointInTimeSelection<T>,
): readonly T[] => {
  if (selection.quality.status === 'REJECTED') {
    throw new Error(
      `${selection.quality.sourceName} point-in-time quality failed: ${selection.quality.rejectionReasons.join(',')}`,
    );
  }
  return selection.records;
};
