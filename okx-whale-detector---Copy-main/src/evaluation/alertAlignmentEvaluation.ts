import { createHash } from 'node:crypto';

import type {
  CorrelatedAlertEventType,
  CorrelatedAlertSeverity,
} from '../types/correlatedAlert';
import type { CorrelatedAlertProvenance } from '../types/correlatedAlertEvaluation';
import type { MarketBias } from '../types/signal';
import type { SupportedInstType } from '../types/instrument';
import {
  ALIGNMENT_CONFIGURATION_VERSION,
  createAlignmentConfiguration,
  type AlignmentConfigurationV1,
} from './alignmentConfiguration';
import type {
  AlignmentCompleteness,
  AlignmentReason,
  AlignmentResult,
  PriceSource,
} from './alignmentTypes';
import { canonicalJsonStringify } from './canonicalJson';

export const ALERT_ALIGNMENT_EVALUATION_RECORD_TYPE =
  'alertAlignmentEvaluation' as const;
export const ALERT_ALIGNMENT_EVALUATION_SCHEMA_VERSION = 1 as const;
export const ALIGNMENT_EVALUATOR_VERSION = 'alignment-evaluator-v1' as const;

export const ALERT_ALIGNMENT_SOURCE_ORDER = Object.freeze([
  'ORDER_BOOK_MIDPOINT',
  'ORDER_BOOK_BID_ASK',
  'CONFIRMED_CANDLE_CLOSE',
] as const satisfies readonly PriceSource[]);

export const DEFAULT_ALIGNMENT_FLOATING_POINT_TOLERANCE = Object.freeze({
  absoluteTolerance: 1e-12,
  relativeTolerance: 1e-12,
});

export interface AlertAlignmentFloatingPointTolerance {
  absoluteTolerance: number;
  relativeTolerance: number;
}

export interface AlertAlignmentEvaluationConfiguration {
  version: typeof ALIGNMENT_CONFIGURATION_VERSION;
  fingerprint: string;
  horizonsMs: readonly number[];
  requestedSources: readonly PriceSource[];
  sourceFallback: AlignmentConfigurationV1['sourceFallback'];
  orderBookMaximumEventLatenessMs: number;
  candleMaximumEventLatenessMs: number;
  localArrivalAllowanceMs: number;
  allowedClockSkewMs: number;
  legacyReferenceMaximumAgeMs: number;
  minimumValidTimestampMs: number;
  maximumValidTimestampMs: number;
  maximumFutureOffsetMs: number;
  legacyPolicy: 'NO_INFERENCE';
  timestampRangePolicy: 'STRICT_UTC_EPOCH_MS';
  floatingPointTolerance: AlertAlignmentFloatingPointTolerance;
}

export interface AlertAlignmentEvaluationInstrument {
  instId: string;
  instType: SupportedInstType | null;
}

export interface AlertAlignmentEvaluationAlertIdentity {
  alertId: string;
  sourceSessionId: string | null;
  alertSequence: number | null;
  semanticFingerprint: string | null;
  alertSchemaVersion: 1 | 2;
  alertRecordedAt: number;
}

export interface AlertAlignmentEvaluationProvenance {
  alertProvenance: CorrelatedAlertProvenance | 'LEGACY_UNVERIFIED';
  marketRecordingFormat: 'VERSIONED_V1' | 'LEGACY_UNVERSIONED' | 'INVALID';
  marketSourceSessionId: string | null;
  recordingId: string | null;
  recordingStartedAt: number | null;
  recordingEndedAt: number | null;
  recordingTermination: 'CLEAN' | 'TRUNCATED' | 'LEGACY_UNVERIFIED' | 'INVALID';
  evaluatorVersion: typeof ALIGNMENT_EVALUATOR_VERSION;
}

export interface AlertAlignmentEvaluationReference {
  referenceTimestamp: number;
  sourceMarketTimestamp: number;
  sourceSignalTimestamp: number;
  midpoint: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  provenance: 'CAPTURED_ALERT_CONTEXT';
}

export interface AlertAlignmentEvaluationAlertContext {
  eventType: CorrelatedAlertEventType;
  bias: MarketBias;
  okxBias: MarketBias | null;
  externalBias: MarketBias | null;
  relationship:
    'AGREEMENT' | 'CONTRADICTION' | 'EXTERNAL_ONLY' | 'OKX_ONLY' | 'NEUTRAL';
  severity: CorrelatedAlertSeverity;
  combinedConfidence: number;
  alertImportance: number;
  okxConfidence: number;
  externalEffectiveConfidence: number;
}

export type PersistedAlignmentResult = Omit<AlignmentResult, 'instrument'> & {
  instrument: AlertAlignmentEvaluationInstrument;
};

export interface AlertAlignmentEvaluationRecord {
  recordType: typeof ALERT_ALIGNMENT_EVALUATION_RECORD_TYPE;
  schemaVersion: typeof ALERT_ALIGNMENT_EVALUATION_SCHEMA_VERSION;
  recordedAt: number;
  evaluationId: string;
  evaluationRunId: string;
  alertIdentity: AlertAlignmentEvaluationAlertIdentity;
  instrument: AlertAlignmentEvaluationInstrument;
  provenance: AlertAlignmentEvaluationProvenance;
  reference: AlertAlignmentEvaluationReference | null;
  alertContext: AlertAlignmentEvaluationAlertContext;
  configuration: AlertAlignmentEvaluationConfiguration;
  alignments: readonly PersistedAlignmentResult[];
}

export interface AlertAlignmentEvaluationConfigurationInput {
  alignment?: AlignmentConfigurationV1;
  requestedSources?: readonly PriceSource[];
  floatingPointTolerance?: Partial<AlertAlignmentFloatingPointTolerance>;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && SHA256_PATTERN.test(value);

export const isEvaluationRunId = (value: unknown): value is string =>
  typeof value === 'string' && IDENTIFIER_PATTERN.test(value);

const orderSources = (sources: readonly PriceSource[]): PriceSource[] => {
  const requested = new Set(sources);
  if (
    requested.size !== sources.length ||
    sources.some((source) => !ALERT_ALIGNMENT_SOURCE_ORDER.includes(source))
  ) {
    throw new Error('Requested alignment sources must be unique and supported');
  }

  if (requested.size === 0) {
    throw new Error('At least one alignment source is required');
  }

  return ALERT_ALIGNMENT_SOURCE_ORDER.filter((source) => requested.has(source));
};

const configurationMaterial = (
  configuration: Omit<AlertAlignmentEvaluationConfiguration, 'fingerprint'>,
): unknown => configuration;

export const createAlertAlignmentEvaluationConfiguration = (
  input: AlertAlignmentEvaluationConfigurationInput = {},
): AlertAlignmentEvaluationConfiguration => {
  const alignment = createAlignmentConfiguration(input.alignment);
  const tolerance = {
    ...DEFAULT_ALIGNMENT_FLOATING_POINT_TOLERANCE,
    ...input.floatingPointTolerance,
  };

  if (
    !Number.isFinite(tolerance.absoluteTolerance) ||
    tolerance.absoluteTolerance < 0 ||
    !Number.isFinite(tolerance.relativeTolerance) ||
    tolerance.relativeTolerance < 0
  ) {
    throw new Error('Alignment floating-point tolerances must be non-negative');
  }

  const material = {
    version: alignment.version,
    horizonsMs: Object.freeze([...alignment.horizonsMs]),
    requestedSources: Object.freeze(
      orderSources(input.requestedSources ?? ALERT_ALIGNMENT_SOURCE_ORDER),
    ),
    sourceFallback: alignment.sourceFallback,
    orderBookMaximumEventLatenessMs: alignment.orderBookMaximumEventLatenessMs,
    candleMaximumEventLatenessMs: alignment.candleMaximumEventLatenessMs,
    localArrivalAllowanceMs: alignment.localArrivalAllowanceMs,
    allowedClockSkewMs: alignment.allowedClockSkewMs,
    legacyReferenceMaximumAgeMs: alignment.legacyReferenceMaximumAgeMs,
    minimumValidTimestampMs: alignment.minimumValidTimestampMs,
    maximumValidTimestampMs: alignment.maximumValidTimestampMs,
    maximumFutureOffsetMs: alignment.maximumFutureOffsetMs,
    legacyPolicy: 'NO_INFERENCE' as const,
    timestampRangePolicy: 'STRICT_UTC_EPOCH_MS' as const,
    floatingPointTolerance: Object.freeze(tolerance),
  };
  const fingerprint = createHash('sha256')
    .update(canonicalJsonStringify(configurationMaterial(material)))
    .digest('hex');

  return Object.freeze({ ...material, fingerprint });
};

export const toAlignmentConfiguration = (
  configuration: AlertAlignmentEvaluationConfiguration,
): AlignmentConfigurationV1 =>
  createAlignmentConfiguration({
    version: configuration.version,
    horizonsMs: configuration.horizonsMs,
    sourceFallback: configuration.sourceFallback,
    orderBookMaximumEventLatenessMs:
      configuration.orderBookMaximumEventLatenessMs,
    candleMaximumEventLatenessMs: configuration.candleMaximumEventLatenessMs,
    localArrivalAllowanceMs: configuration.localArrivalAllowanceMs,
    allowedClockSkewMs: configuration.allowedClockSkewMs,
    legacyReferenceMaximumAgeMs: configuration.legacyReferenceMaximumAgeMs,
    minimumValidTimestampMs: configuration.minimumValidTimestampMs,
    maximumValidTimestampMs: configuration.maximumValidTimestampMs,
    maximumFutureOffsetMs: configuration.maximumFutureOffsetMs,
  });

export const verifyAlertAlignmentConfigurationFingerprint = (
  configuration: AlertAlignmentEvaluationConfiguration,
): boolean => {
  try {
    const rebuilt = createAlertAlignmentEvaluationConfiguration({
      alignment: toAlignmentConfiguration(configuration),
      requestedSources: configuration.requestedSources,
      floatingPointTolerance: configuration.floatingPointTolerance,
    });
    return rebuilt.fingerprint === configuration.fingerprint;
  } catch {
    return false;
  }
};

export const createAlertAlignmentEvaluationId = (input: {
  alertIdentity: AlertAlignmentEvaluationAlertIdentity;
  recordingId: string | null;
  configurationFingerprint: string;
}): string => {
  const material = {
    alignmentSchemaVersion: 1,
    alertIdentity: {
      alertId: input.alertIdentity.alertId,
      sourceSessionId: input.alertIdentity.sourceSessionId,
      alertSequence: input.alertIdentity.alertSequence,
      semanticFingerprint: input.alertIdentity.semanticFingerprint,
      alertSchemaVersion: input.alertIdentity.alertSchemaVersion,
      alertRecordedAt: input.alertIdentity.alertRecordedAt,
    },
    recordingId: input.recordingId,
    configurationFingerprint: input.configurationFingerprint,
  };
  const digest = createHash('sha256')
    .update(canonicalJsonStringify(material))
    .digest('hex');
  return `alert-alignment-evaluation:${digest}`;
};

export const approximatelyEqualForEvaluation = (
  left: number,
  right: number,
  tolerance: AlertAlignmentFloatingPointTolerance,
): boolean => {
  const magnitude = Math.max(Math.abs(left), Math.abs(right));
  return (
    Math.abs(left - right) <=
    tolerance.absoluteTolerance + tolerance.relativeTolerance * magnitude
  );
};

export const compareEvaluationRecords = (
  left: AlertAlignmentEvaluationRecord,
  right: AlertAlignmentEvaluationRecord,
): number =>
  (left.reference?.referenceTimestamp ?? Number.MAX_SAFE_INTEGER) -
    (right.reference?.referenceTimestamp ?? Number.MAX_SAFE_INTEGER) ||
  left.alertIdentity.alertId.localeCompare(right.alertIdentity.alertId) ||
  (left.provenance.recordingId ?? '').localeCompare(
    right.provenance.recordingId ?? '',
  ) ||
  left.configuration.fingerprint.localeCompare(right.configuration.fingerprint);

export const sortEvaluationReasons = (
  primaryReason: AlignmentReason | null,
  reasons: readonly AlignmentReason[],
): AlignmentReason[] => {
  const unique = [...new Set(reasons)];
  const rest = unique
    .filter((reason) => reason !== primaryReason)
    .sort((left, right) => left.localeCompare(right));
  return primaryReason === null ? rest : [primaryReason, ...rest];
};

export const isResultConsistencyValid = (result: {
  completeness: AlignmentCompleteness;
  selectedObservation: unknown;
  primaryReason: AlignmentReason | null;
  reasons: readonly AlignmentReason[];
}): boolean => {
  const hasObservation = result.selectedObservation !== null;
  const hasPrimaryReason =
    result.primaryReason !== null &&
    result.reasons.includes(result.primaryReason);

  if (result.completeness === 'COMPLETE') {
    return (
      hasObservation &&
      result.primaryReason === null &&
      result.reasons.length === 0
    );
  }
  if (result.completeness === 'MISSING') {
    return !hasObservation && hasPrimaryReason;
  }
  if (result.completeness === 'INVALID') {
    return !hasObservation && hasPrimaryReason;
  }
  if (result.completeness === 'AMBIGUOUS') {
    return hasPrimaryReason;
  }

  return hasObservation && hasPrimaryReason;
};
