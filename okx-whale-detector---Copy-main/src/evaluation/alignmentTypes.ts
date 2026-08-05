import type { SupportedInstType } from '../types/instrument';

export const ALIGNMENT_SCHEMA_VERSION = 1 as const;

export interface InstrumentKey {
  instId: string;
  instType: SupportedInstType;
}

export type PriceSource =
  'ORDER_BOOK_MIDPOINT' | 'ORDER_BOOK_BID_ASK' | 'CONFIRMED_CANDLE_CLOSE';

export type SourceFallbackPolicy = 'NONE' | 'BEST_AVAILABLE';

export type AlignmentCompleteness =
  'COMPLETE' | 'PARTIAL' | 'MISSING' | 'AMBIGUOUS' | 'INVALID';

export enum AlignmentReason {
  NO_MATCHING_MARKET_SESSION = 'NO_MATCHING_MARKET_SESSION',
  MARKET_SESSION_AMBIGUOUS = 'MARKET_SESSION_AMBIGUOUS',
  INSTRUMENT_MISMATCH = 'INSTRUMENT_MISMATCH',
  INSTRUMENT_METADATA_MISSING = 'INSTRUMENT_METADATA_MISSING',
  INSTRUMENT_METADATA_CONFLICT = 'INSTRUMENT_METADATA_CONFLICT',
  NO_REFERENCE_CONTEXT = 'NO_REFERENCE_CONTEXT',
  NO_INITIAL_SNAPSHOT = 'NO_INITIAL_SNAPSHOT',
  SEQUENCE_GAP = 'SEQUENCE_GAP',
  BOOK_INVALID = 'BOOK_INVALID',
  NO_SAMPLE_AFTER_HORIZON = 'NO_SAMPLE_AFTER_HORIZON',
  SAMPLE_TOO_LATE = 'SAMPLE_TOO_LATE',
  UNCONFIRMED_CANDLE = 'UNCONFIRMED_CANDLE',
  CANDLE_INTERVAL_UNKNOWN = 'CANDLE_INTERVAL_UNKNOWN',
  PARTIAL_ALERT_CANDLE = 'PARTIAL_ALERT_CANDLE',
  CONFLICTING_DUPLICATE = 'CONFLICTING_DUPLICATE',
  TIMESTAMP_UNIT_INVALID = 'TIMESTAMP_UNIT_INVALID',
  TIMESTAMP_RANGE_INVALID = 'TIMESTAMP_RANGE_INVALID',
  CLOCK_SKEW_INVALID = 'CLOCK_SKEW_INVALID',
  AVAILABILITY_UNKNOWN = 'AVAILABILITY_UNKNOWN',
  EVENT_TIME_OUT_OF_ORDER = 'EVENT_TIME_OUT_OF_ORDER',
  RECORDING_ENDED_BEFORE_HORIZON = 'RECORDING_ENDED_BEFORE_HORIZON',
  RECORDING_TRUNCATED = 'RECORDING_TRUNCATED',
  TARGET_STOP_ORDER_AMBIGUOUS = 'TARGET_STOP_ORDER_AMBIGUOUS',
  LEGACY_LINKAGE_UNVERIFIED = 'LEGACY_LINKAGE_UNVERIFIED',
  REFERENCE_SAMPLE_TOO_OLD = 'REFERENCE_SAMPLE_TOO_OLD',
  RECORDING_ID_MISSING = 'RECORDING_ID_MISSING',
  PRICE_SOURCE_MISMATCH = 'PRICE_SOURCE_MISMATCH',
  INTERPOLATION_NOT_ALLOWED = 'INTERPOLATION_NOT_ALLOWED',
  REFERENCE_CONTEXT_INVALID = 'REFERENCE_CONTEXT_INVALID',
  RECORDING_STARTED_AFTER_REFERENCE = 'RECORDING_STARTED_AFTER_REFERENCE',
}

export interface AlignmentValidationSuccess<T> {
  valid: true;
  value: T;
}

export interface AlignmentValidationFailure {
  valid: false;
  completeness: Exclude<AlignmentCompleteness, 'COMPLETE'>;
  primaryReason: AlignmentReason;
  reasons: readonly AlignmentReason[];
}

export type AlignmentValidationResult<T> =
  AlignmentValidationSuccess<T> | AlignmentValidationFailure;

export interface PriceObservation {
  instrument: InstrumentKey;
  source: PriceSource;
  eventTimestamp: number;
  availabilityTimestamp: number;
  recordOrdinal: number;
  midpoint?: number;
  bestBid?: number;
  bestAsk?: number;
  close?: number;
  intervalStart?: number;
  intervalEnd?: number;
  recordingId: string;
  sourceSessionId: string;
}

export type ReferenceProvenance =
  'CAPTURED_ALERT_CONTEXT' | 'INFERRED_FROM_ORDER_BOOK';

export interface AlignmentReference {
  provenance: ReferenceProvenance;
  referenceTimestamp: number;
  midpoint: number;
  bestBid?: number;
  bestAsk?: number;
  legacyManifestId?: string;
}

export type ValidityGapReason =
  | AlignmentReason.SEQUENCE_GAP
  | AlignmentReason.BOOK_INVALID
  | AlignmentReason.RECORDING_TRUNCATED
  | AlignmentReason.EVENT_TIME_OUT_OF_ORDER;

export interface ValidityInterval {
  startTimestamp: number;
  endTimestamp?: number;
  reason: ValidityGapReason;
}

export type AlignmentFallbackReason = 'REQUESTED_SOURCE_UNAVAILABLE';

export interface AlignmentResult {
  alignmentSchemaVersion: typeof ALIGNMENT_SCHEMA_VERSION;
  evaluationConfigVersion: string;
  alertId: string;
  instrument: InstrumentKey;
  source: PriceSource;
  horizonMs: number;
  reference: AlignmentReference | null;
  targetTimestamp: number | null;
  selectedObservation: PriceObservation | null;
  observationDelayMs: number | null;
  availabilityDelayMs: number | null;
  completeness: AlignmentCompleteness;
  primaryReason: AlignmentReason | null;
  reasons: readonly AlignmentReason[];
  sourceSessionId: string | null;
  recordingId: string | null;
  validityGaps: readonly ValidityInterval[];
  fallbackUsed: boolean;
  fallbackReason: AlignmentFallbackReason | null;
}

export interface EligibleObservation {
  observation: PriceObservation;
  observationDelayMs: number;
  availabilityDelayMs: number;
  fallbackUsed: boolean;
  fallbackReason: AlignmentFallbackReason | null;
}

export const alignmentSuccess = <T>(
  value: T,
): AlignmentValidationSuccess<T> => ({
  valid: true,
  value,
});

export const alignmentFailure = (
  primaryReason: AlignmentReason,
  completeness: Exclude<AlignmentCompleteness, 'COMPLETE'> = 'INVALID',
  additionalReasons: readonly AlignmentReason[] = [],
): AlignmentValidationFailure => {
  const reasons = [primaryReason];

  for (const reason of additionalReasons) {
    if (!reasons.includes(reason)) {
      reasons.push(reason);
    }
  }

  return {
    valid: false,
    completeness,
    primaryReason,
    reasons,
  };
};
