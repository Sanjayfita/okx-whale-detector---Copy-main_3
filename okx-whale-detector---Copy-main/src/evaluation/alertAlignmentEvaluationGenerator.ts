import type {
  CorrelatedAlertRecord,
  CorrelatedAlertRecordV2,
} from '../recording/CorrelatedAlertRecorder';
import type {
  MarketRecordingFormatType,
  MarketRecordingHeaderRecord,
} from '../recording/marketRecordingFormat';
import { alignAlertsToConfirmedCandles } from './candleAlignment';
import {
  normalizeVersionedCandleRecordingLines,
  type NormalizedCandleRecording,
} from './candleNormalization';
import { alignAlertsToOrderBooks } from './orderBookAlignment';
import { normalizeVersionedOrderBookRecordingLines } from './orderBookNormalization';
import {
  reconstructOrderBooks,
  type ReconstructedOrderBookRecording,
} from './orderBookReconstructor';
import {
  ALIGNMENT_SCHEMA_VERSION,
  AlignmentReason,
  type AlignmentCompleteness,
  type AlignmentReason as AlignmentReasonType,
  type AlignmentResult,
  type AlignmentValidationFailure,
  type PriceSource,
} from './alignmentTypes';
import {
  ALERT_ALIGNMENT_EVALUATION_RECORD_TYPE,
  ALERT_ALIGNMENT_EVALUATION_SCHEMA_VERSION,
  ALIGNMENT_EVALUATOR_VERSION,
  approximatelyEqualForEvaluation,
  compareEvaluationRecords,
  createAlertAlignmentEvaluationConfiguration,
  createAlertAlignmentEvaluationId,
  isEvaluationRunId,
  sortEvaluationReasons,
  toAlignmentConfiguration,
  type AlertAlignmentEvaluationAlertIdentity,
  type AlertAlignmentEvaluationConfiguration,
  type AlertAlignmentEvaluationConfigurationInput,
  type AlertAlignmentEvaluationInstrument,
  type AlertAlignmentEvaluationRecord,
  type AlertAlignmentEvaluationReference,
  type PersistedAlignmentResult,
} from './alertAlignmentEvaluation';

export interface PreparedAlertAlignmentMarketRecording {
  formatType: MarketRecordingFormatType | 'INVALID';
  header: MarketRecordingHeaderRecord | null;
  candleRecording: NormalizedCandleRecording | null;
  orderBookReconstruction: ReconstructedOrderBookRecording | null;
  failure: AlignmentValidationFailure | null;
}

export interface PrepareAlertAlignmentMarketRecordingOptions {
  configuration?: AlertAlignmentEvaluationConfigurationInput;
  now: number;
}

export interface GenerateAlertAlignmentEvaluationsRequest {
  alerts: readonly CorrelatedAlertRecord[];
  marketRecording: PreparedAlertAlignmentMarketRecording;
  configuration?: AlertAlignmentEvaluationConfiguration;
  evaluationRunId: string;
  now: number;
}

const resultKey = (
  alertId: string,
  horizonMs: number,
  source: PriceSource,
): string => `${alertId}\u001f${horizonMs}\u001f${source}`;

const unavailableRecording = (
  lines: readonly string[],
  failure: AlignmentValidationFailure,
): PreparedAlertAlignmentMarketRecording => {
  const first = lines.find((line) => line.trim().length > 0);
  let formatType: PreparedAlertAlignmentMarketRecording['formatType'] =
    'INVALID';

  if (first) {
    try {
      const value: unknown = JSON.parse(first);
      if (
        typeof value === 'object' &&
        value !== null &&
        !('recordType' in value)
      ) {
        formatType = 'LEGACY_UNVERSIONED';
      }
    } catch {
      formatType = 'INVALID';
    }
  }

  return {
    formatType,
    header: null,
    candleRecording: null,
    orderBookReconstruction: null,
    failure,
  };
};

export const prepareAlertAlignmentMarketRecording = (
  inputLines: Iterable<string>,
  options: PrepareAlertAlignmentMarketRecordingOptions,
): PreparedAlertAlignmentMarketRecording => {
  const lines = [...inputLines];
  const evaluationConfiguration = createAlertAlignmentEvaluationConfiguration(
    options.configuration,
  );
  const alignmentConfiguration = toAlignmentConfiguration(
    evaluationConfiguration,
  );
  const normalizationOptions = {
    configuration: alignmentConfiguration,
    now: options.now,
  };
  const candleResult = normalizeVersionedCandleRecordingLines(
    lines,
    normalizationOptions,
  );
  if (!candleResult.valid) {
    return unavailableRecording(lines, candleResult);
  }

  const orderBookResult = normalizeVersionedOrderBookRecordingLines(
    lines,
    normalizationOptions,
  );
  if (!orderBookResult.valid) {
    return unavailableRecording(lines, orderBookResult);
  }

  const candleHeader = candleResult.value.header;
  const orderBookHeader = orderBookResult.value.header;
  if (
    candleHeader.sourceSessionId !== orderBookHeader.sourceSessionId ||
    candleHeader.recordingId !== orderBookHeader.recordingId
  ) {
    return unavailableRecording(lines, {
      valid: false,
      completeness: 'INVALID',
      primaryReason: AlignmentReason.NO_MATCHING_MARKET_SESSION,
      reasons: [AlignmentReason.NO_MATCHING_MARKET_SESSION],
    });
  }

  return {
    formatType: 'VERSIONED_V1',
    header: candleHeader,
    candleRecording: candleResult.value,
    orderBookReconstruction: reconstructOrderBooks(orderBookResult.value),
    failure: null,
  };
};

const createAlertIdentity = (
  record: CorrelatedAlertRecord,
): AlertAlignmentEvaluationAlertIdentity =>
  record.schemaVersion === 2
    ? {
        alertId: record.alert.id,
        sourceSessionId: record.sourceSessionId,
        alertSequence: record.alertSequence,
        semanticFingerprint: record.semanticFingerprint,
        alertSchemaVersion: record.schemaVersion,
        alertRecordedAt: record.recordedAt,
      }
    : {
        alertId: record.alert.id,
        sourceSessionId: null,
        alertSequence: null,
        semanticFingerprint: null,
        alertSchemaVersion: record.schemaVersion,
        alertRecordedAt: record.recordedAt,
      };

const createInstrument = (
  record: CorrelatedAlertRecord,
): AlertAlignmentEvaluationInstrument => ({
  instId:
    record.schemaVersion === 2
      ? record.evaluationContext.instId
      : record.alert.symbol,
  instType:
    record.schemaVersion === 2 ? record.evaluationContext.instType : null,
});

const createReference = (
  record: CorrelatedAlertRecord,
): AlertAlignmentEvaluationReference | null =>
  record.schemaVersion === 2
    ? {
        referenceTimestamp: record.evaluationContext.referenceTimestamp,
        sourceMarketTimestamp: record.evaluationContext.sourceMarketTimestamp,
        sourceSignalTimestamp: record.evaluationContext.sourceSignalTimestamp,
        midpoint: record.evaluationContext.referenceMidpoint,
        bestBid: record.evaluationContext.referenceBestBid,
        bestAsk: record.evaluationContext.referenceBestAsk,
        spread: record.evaluationContext.referenceSpread,
        spreadPercent: record.evaluationContext.referenceSpreadPercent,
        provenance: 'CAPTURED_ALERT_CONTEXT',
      }
    : null;

const referenceIsConsistent = (
  reference: AlertAlignmentEvaluationReference,
  configuration: AlertAlignmentEvaluationConfiguration,
): boolean => {
  if (
    !Number.isSafeInteger(reference.referenceTimestamp) ||
    !Number.isSafeInteger(reference.sourceMarketTimestamp) ||
    !Number.isSafeInteger(reference.sourceSignalTimestamp) ||
    !Number.isFinite(reference.midpoint) ||
    reference.midpoint <= 0 ||
    !Number.isFinite(reference.bestBid) ||
    reference.bestBid <= 0 ||
    !Number.isFinite(reference.bestAsk) ||
    reference.bestAsk < reference.bestBid ||
    !Number.isFinite(reference.spread) ||
    reference.spread < 0 ||
    !Number.isFinite(reference.spreadPercent) ||
    reference.spreadPercent < 0
  ) {
    return false;
  }

  const midpoint = (reference.bestBid + reference.bestAsk) / 2;
  const spread = reference.bestAsk - reference.bestBid;
  const spreadPercent = (spread / midpoint) * 100;
  const tolerance = configuration.floatingPointTolerance;

  return (
    approximatelyEqualForEvaluation(reference.midpoint, midpoint, tolerance) &&
    approximatelyEqualForEvaluation(reference.spread, spread, tolerance) &&
    approximatelyEqualForEvaluation(
      reference.spreadPercent,
      spreadPercent,
      tolerance,
    )
  );
};

const createFailureResult = (input: {
  record: CorrelatedAlertRecord;
  instrument: AlertAlignmentEvaluationInstrument;
  source: PriceSource;
  horizonMs: number;
  reference: AlertAlignmentEvaluationReference | null;
  configuration: AlertAlignmentEvaluationConfiguration;
  marketRecording: PreparedAlertAlignmentMarketRecording;
  completeness: Exclude<AlignmentCompleteness, 'COMPLETE'>;
  reason: AlignmentReasonType;
}): PersistedAlignmentResult => {
  const targetTimestamp =
    input.reference &&
    Number.isSafeInteger(input.reference.referenceTimestamp + input.horizonMs)
      ? input.reference.referenceTimestamp + input.horizonMs
      : null;
  const header = input.marketRecording.header;

  return {
    alignmentSchemaVersion: ALIGNMENT_SCHEMA_VERSION,
    evaluationConfigVersion: `${input.configuration.version}:${input.configuration.fingerprint}`,
    alertId: input.record.alert.id,
    instrument: input.instrument,
    source: input.source,
    horizonMs: input.horizonMs,
    reference: input.reference
      ? {
          provenance: 'CAPTURED_ALERT_CONTEXT',
          referenceTimestamp: input.reference.referenceTimestamp,
          midpoint: input.reference.midpoint,
          bestBid: input.reference.bestBid,
          bestAsk: input.reference.bestAsk,
        }
      : null,
    targetTimestamp,
    selectedObservation: null,
    observationDelayMs: null,
    availabilityDelayMs: null,
    completeness: input.completeness,
    primaryReason: input.reason,
    reasons: [input.reason],
    sourceSessionId:
      input.record.schemaVersion === 2 ? input.record.sourceSessionId : null,
    recordingId: header?.recordingId ?? null,
    validityGaps: [],
    fallbackUsed: false,
    fallbackReason: null,
  };
};

const canonicalizeResult = (
  result: AlignmentResult,
  configuration: AlertAlignmentEvaluationConfiguration,
): PersistedAlignmentResult => ({
  ...result,
  evaluationConfigVersion: `${configuration.version}:${configuration.fingerprint}`,
  instrument: { ...result.instrument },
  reasons: Object.freeze(
    sortEvaluationReasons(result.primaryReason, result.reasons),
  ),
  validityGaps: Object.freeze(
    [...result.validityGaps].sort(
      (left, right) =>
        left.startTimestamp - right.startTimestamp ||
        (left.endTimestamp ?? Number.MAX_SAFE_INTEGER) -
          (right.endTimestamp ?? Number.MAX_SAFE_INTEGER) ||
        left.reason.localeCompare(right.reason),
    ),
  ),
});

const sourceOrder = new Map(
  (
    [
      'ORDER_BOOK_MIDPOINT',
      'ORDER_BOOK_BID_ASK',
      'CONFIRMED_CANDLE_CLOSE',
    ] as const
  ).map((source, index) => [source, index]),
);

const sortMatrix = (
  results: readonly PersistedAlignmentResult[],
): PersistedAlignmentResult[] =>
  [...results].sort(
    (left, right) =>
      left.horizonMs - right.horizonMs ||
      (sourceOrder.get(left.source) ?? Number.MAX_SAFE_INTEGER) -
        (sourceOrder.get(right.source) ?? Number.MAX_SAFE_INTEGER),
  );

const buildAlignedResultMap = (
  alerts: readonly CorrelatedAlertRecordV2[],
  marketRecording: PreparedAlertAlignmentMarketRecording,
  configuration: AlertAlignmentEvaluationConfiguration,
  now: number,
): Map<string, PersistedAlignmentResult> => {
  const results = new Map<string, PersistedAlignmentResult>();
  const alignmentConfiguration = toAlignmentConfiguration(configuration);

  if (
    alerts.length === 0 ||
    !marketRecording.candleRecording ||
    !marketRecording.orderBookReconstruction
  ) {
    return results;
  }

  const orderBook = alignAlertsToOrderBooks({
    alertRecords: alerts,
    reconstruction: marketRecording.orderBookReconstruction,
    configuration: alignmentConfiguration,
    now,
  });
  const candles = alignAlertsToConfirmedCandles({
    alertRecords: alerts,
    recording: marketRecording.candleRecording,
    configuration: alignmentConfiguration,
    interval: '1m',
    now,
  });

  for (const result of [...orderBook.results, ...candles.results]) {
    results.set(
      resultKey(result.alertId, result.horizonMs, result.source),
      canonicalizeResult(result, configuration),
    );
  }

  return results;
};

const recordFailure = (
  record: CorrelatedAlertRecord,
  marketRecording: PreparedAlertAlignmentMarketRecording,
  reference: AlertAlignmentEvaluationReference | null,
  configuration: AlertAlignmentEvaluationConfiguration,
): {
  completeness: Exclude<AlignmentCompleteness, 'COMPLETE'>;
  reason: AlignmentReasonType;
} | null => {
  if (record.schemaVersion !== 2 || reference === null) {
    return {
      completeness: 'MISSING',
      reason: AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
    };
  }
  if (!referenceIsConsistent(reference, configuration)) {
    return {
      completeness: 'INVALID',
      reason: AlignmentReason.REFERENCE_CONTEXT_INVALID,
    };
  }
  if (marketRecording.failure) {
    return {
      completeness: marketRecording.failure.completeness,
      reason: marketRecording.failure.primaryReason,
    };
  }
  if (!marketRecording.header) {
    return {
      completeness: 'MISSING',
      reason: AlignmentReason.NO_MATCHING_MARKET_SESSION,
    };
  }
  if (reference.referenceTimestamp < marketRecording.header.startedAt) {
    return {
      completeness: 'MISSING',
      reason: AlignmentReason.RECORDING_STARTED_AFTER_REFERENCE,
    };
  }

  return null;
};

export const generateAlertAlignmentEvaluations = (
  request: GenerateAlertAlignmentEvaluationsRequest,
): AlertAlignmentEvaluationRecord[] => {
  if (!isEvaluationRunId(request.evaluationRunId)) {
    throw new Error('evaluationRunId must be a valid identifier');
  }
  if (!Number.isSafeInteger(request.now) || request.now < 0) {
    throw new Error('now must be UTC epoch milliseconds');
  }

  const configuration =
    request.configuration ?? createAlertAlignmentEvaluationConfiguration();
  const versionedAlerts = request.alerts.filter(
    (record): record is CorrelatedAlertRecordV2 => record.schemaVersion === 2,
  );
  const aligned = buildAlignedResultMap(
    versionedAlerts,
    request.marketRecording,
    configuration,
    request.now,
  );
  const output: AlertAlignmentEvaluationRecord[] = [];

  for (const record of request.alerts) {
    const alertIdentity = createAlertIdentity(record);
    const instrument = createInstrument(record);
    const reference = createReference(record);
    const failure = recordFailure(
      record,
      request.marketRecording,
      reference,
      configuration,
    );
    const alignments: PersistedAlignmentResult[] = [];

    for (const horizonMs of configuration.horizonsMs) {
      for (const source of configuration.requestedSources) {
        const existing = aligned.get(
          resultKey(record.alert.id, horizonMs, source),
        );
        alignments.push(
          failure || !existing
            ? createFailureResult({
                record,
                instrument,
                source,
                horizonMs,
                reference,
                configuration,
                marketRecording: request.marketRecording,
                completeness: failure?.completeness ?? 'MISSING',
                reason:
                  failure?.reason ?? AlignmentReason.NO_SAMPLE_AFTER_HORIZON,
              })
            : existing,
        );
      }
    }

    const header = request.marketRecording.header;
    const recordingId = header?.recordingId ?? null;
    const recordOutput: AlertAlignmentEvaluationRecord = {
      recordType: ALERT_ALIGNMENT_EVALUATION_RECORD_TYPE,
      schemaVersion: ALERT_ALIGNMENT_EVALUATION_SCHEMA_VERSION,
      recordedAt: request.now,
      evaluationId: createAlertAlignmentEvaluationId({
        alertIdentity,
        recordingId,
        configurationFingerprint: configuration.fingerprint,
      }),
      evaluationRunId: request.evaluationRunId,
      alertIdentity,
      instrument,
      provenance: {
        alertProvenance:
          record.schemaVersion === 2 ? record.provenance : 'LEGACY_UNVERIFIED',
        marketRecordingFormat: request.marketRecording.formatType,
        marketSourceSessionId: header?.sourceSessionId ?? null,
        recordingId,
        recordingStartedAt: header?.startedAt ?? null,
        recordingEndedAt:
          request.marketRecording.candleRecording?.footer?.endedAt ?? null,
        recordingTermination:
          request.marketRecording.formatType === 'LEGACY_UNVERSIONED'
            ? 'LEGACY_UNVERIFIED'
            : request.marketRecording.formatType === 'INVALID'
              ? 'INVALID'
              : (request.marketRecording.candleRecording?.termination ??
                'INVALID'),
        evaluatorVersion: ALIGNMENT_EVALUATOR_VERSION,
      },
      reference,
      alertContext: {
        eventType: record.alert.eventType,
        bias: record.alert.bias,
        okxBias:
          record.schemaVersion === 2 ? record.evaluationContext.okxBias : null,
        externalBias:
          record.schemaVersion === 2
            ? record.evaluationContext.externalBias
            : null,
        relationship: record.alert.relationship,
        severity: record.alert.severity,
        combinedConfidence: record.alert.combinedConfidence,
        alertImportance: record.alert.alertImportance,
        okxConfidence: record.alert.okxConfidence,
        externalEffectiveConfidence: record.alert.externalEffectiveConfidence,
      },
      configuration,
      alignments: Object.freeze(sortMatrix(alignments)),
    };

    output.push(Object.freeze(recordOutput));
  }

  return output.sort(compareEvaluationRecords);
};
