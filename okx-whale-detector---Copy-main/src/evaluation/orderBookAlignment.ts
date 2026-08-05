import type {
  CorrelatedAlertRecord,
  CorrelatedAlertRecordV2,
} from '../recording/CorrelatedAlertRecorder';
import {
  getAlignmentEvaluationConfigVersion,
  type AlignmentConfigurationV1,
} from './alignmentConfiguration';
import { sortAlignmentResults } from './alignmentOrdering';
import {
  ALIGNMENT_SCHEMA_VERSION,
  AlignmentReason,
  type AlignmentCompleteness,
  type AlignmentReason as AlignmentReasonType,
  type AlignmentResult,
  type AlignmentValidationFailure,
  type InstrumentKey,
  type PriceObservation,
  type ValidityInterval,
} from './alignmentTypes';
import {
  type OrderBookPriceSource,
  OrderBookObservationIndex,
} from './orderBookObservationIndex';
import type {
  OrderBookReconstructionIssue,
  OrderBookValidityGap,
  ReconstructedOrderBookRecording,
} from './orderBookReconstructor';
import {
  calculateTargetTimestamp,
  instrumentKeysEqual,
  validateAlignmentReference,
  validateInstrumentKey,
  validateObservationEligibility,
  validateSessionLinkage,
} from './alignmentValidation';

export interface OrderBookAlignmentRequest {
  alertRecords: readonly CorrelatedAlertRecord[];
  reconstruction: ReconstructedOrderBookRecording;
  configuration: AlignmentConfigurationV1;
  now: number;
}

export interface OrderBookAlignmentRejection extends AlignmentValidationFailure {
  alertId: string;
}

export interface OrderBookAlignmentBatchResult {
  results: readonly AlignmentResult[];
  rejectedAlerts: readonly OrderBookAlignmentRejection[];
}

const sources: readonly OrderBookPriceSource[] = [
  'ORDER_BOOK_MIDPOINT',
  'ORDER_BOOK_BID_ASK',
];

const instrumentGaps = (
  reconstruction: ReconstructedOrderBookRecording,
  instrument: InstrumentKey,
): OrderBookValidityGap[] =>
  reconstruction.validityGaps.filter(
    (gap) =>
      instrumentKeysEqual(gap.instrument, instrument) &&
      gap.reason !== AlignmentReason.RECORDING_TRUNCATED,
  );

const instrumentIssues = (
  reconstruction: ReconstructedOrderBookRecording,
  instrument: InstrumentKey,
): OrderBookReconstructionIssue[] =>
  reconstruction.issues.filter((issue) =>
    instrumentKeysEqual(issue.instrument, instrument),
  );

const crossesInterval = (
  startTimestamp: number,
  endTimestamp: number,
  interval: { startTimestamp: number; endTimestamp?: number },
): boolean =>
  interval.startTimestamp < endTimestamp &&
  (interval.endTimestamp === undefined ||
    interval.endTimestamp > startTimestamp);

const createResult = (input: {
  record: CorrelatedAlertRecordV2;
  reconstruction: ReconstructedOrderBookRecording;
  configuration: AlignmentConfigurationV1;
  instrument: InstrumentKey;
  source: OrderBookPriceSource;
  horizonMs: number;
  targetTimestamp: number | null;
  selectedObservation?: PriceObservation;
  completeness: AlignmentCompleteness;
  primaryReason?: AlignmentReasonType;
  additionalReasons?: readonly AlignmentReasonType[];
}): AlignmentResult => {
  const reasons = input.primaryReason
    ? [
        input.primaryReason,
        ...(input.additionalReasons ?? []).filter(
          (reason) => reason !== input.primaryReason,
        ),
      ]
    : [];
  const gaps: ValidityInterval[] = input.reconstruction.validityGaps
    .filter((gap) => instrumentKeysEqual(gap.instrument, input.instrument))
    .map(({ startTimestamp, endTimestamp, reason }) => ({
      startTimestamp,
      endTimestamp,
      reason,
    }));

  return {
    alignmentSchemaVersion: ALIGNMENT_SCHEMA_VERSION,
    evaluationConfigVersion: getAlignmentEvaluationConfigVersion(
      input.configuration,
    ),
    alertId: input.record.alert.id,
    instrument: input.instrument,
    source: input.source,
    horizonMs: input.horizonMs,
    reference: {
      provenance: 'CAPTURED_ALERT_CONTEXT',
      referenceTimestamp: input.record.evaluationContext.referenceTimestamp,
      midpoint: input.record.evaluationContext.referenceMidpoint,
      bestBid: input.record.evaluationContext.referenceBestBid,
      bestAsk: input.record.evaluationContext.referenceBestAsk,
    },
    targetTimestamp: input.targetTimestamp,
    selectedObservation: input.selectedObservation ?? null,
    observationDelayMs:
      input.selectedObservation && input.targetTimestamp !== null
        ? input.selectedObservation.eventTimestamp - input.targetTimestamp
        : null,
    availabilityDelayMs: input.selectedObservation
      ? input.selectedObservation.availabilityTimestamp -
        input.selectedObservation.eventTimestamp
      : null,
    completeness: input.completeness,
    primaryReason: input.primaryReason ?? null,
    reasons,
    sourceSessionId: input.record.sourceSessionId,
    recordingId: input.reconstruction.recording.header.recordingId,
    validityGaps: gaps,
    fallbackUsed: false,
    fallbackReason: null,
  };
};

const fromFailure = (
  record: CorrelatedAlertRecordV2,
  reconstruction: ReconstructedOrderBookRecording,
  configuration: AlignmentConfigurationV1,
  instrument: InstrumentKey,
  source: OrderBookPriceSource,
  horizonMs: number,
  targetTimestamp: number | null,
  failure: AlignmentValidationFailure,
): AlignmentResult =>
  createResult({
    record,
    reconstruction,
    configuration,
    instrument,
    source,
    horizonMs,
    targetTimestamp,
    completeness: failure.completeness,
    primaryReason: failure.primaryReason,
    additionalReasons: failure.reasons,
  });

const missingFailure = (
  reconstruction: ReconstructedOrderBookRecording,
  instrument: InstrumentKey,
  targetTimestamp: number,
): AlignmentValidationFailure => {
  const state = reconstruction.finalStates.find((candidate) =>
    instrumentKeysEqual(candidate.instrument, instrument),
  );
  if (
    reconstruction.recording.footer &&
    reconstruction.recording.footer.endedAt < targetTimestamp
  ) {
    return {
      valid: false,
      completeness: 'MISSING',
      primaryReason: AlignmentReason.RECORDING_ENDED_BEFORE_HORIZON,
      reasons: [AlignmentReason.RECORDING_ENDED_BEFORE_HORIZON],
    };
  }

  const issue = instrumentIssues(reconstruction, instrument).find(
    (candidate) =>
      candidate.startTimestamp <= targetTimestamp &&
      (candidate.endTimestamp === undefined ||
        targetTimestamp < candidate.endTimestamp),
  );
  if (issue) {
    return {
      valid: false,
      completeness: issue.completeness,
      primaryReason: issue.reason,
      reasons: [issue.reason],
    };
  }

  const gap = reconstruction.validityGaps.find(
    (candidate) =>
      instrumentKeysEqual(candidate.instrument, instrument) &&
      candidate.startTimestamp <= targetTimestamp &&
      (candidate.endTimestamp === undefined ||
        targetTimestamp < candidate.endTimestamp),
  );
  if (gap) {
    return {
      valid: false,
      completeness:
        gap.reason === AlignmentReason.BOOK_INVALID ||
        gap.reason === AlignmentReason.EVENT_TIME_OUT_OF_ORDER
          ? 'INVALID'
          : 'MISSING',
      primaryReason: gap.reason,
      reasons: [gap.reason],
    };
  }

  const reason =
    reconstruction.recording.termination === 'TRUNCATED'
      ? AlignmentReason.RECORDING_TRUNCATED
      : !state?.sawValidSnapshot
        ? AlignmentReason.NO_INITIAL_SNAPSHOT
        : AlignmentReason.NO_SAMPLE_AFTER_HORIZON;
  return {
    valid: false,
    completeness: 'MISSING',
    primaryReason: reason,
    reasons: [reason],
  };
};

const selectObservation = (
  index: OrderBookObservationIndex,
  reconstruction: ReconstructedOrderBookRecording,
  configuration: AlignmentConfigurationV1,
  instrument: InstrumentKey,
  source: OrderBookPriceSource,
  targetTimestamp: number,
  now: number,
):
  | { observation: PriceObservation }
  | { failure: AlignmentValidationFailure } => {
  const candidatesResult = index.getCandidates(
    instrument,
    source,
    targetTimestamp,
  );
  if (!candidatesResult.valid) {
    return { failure: candidatesResult };
  }

  const gaps = instrumentGaps(reconstruction, instrument);
  const issues = instrumentIssues(reconstruction, instrument);
  let timingFailure: AlignmentValidationFailure | undefined;

  for (const observation of candidatesResult.value) {
    if (
      observation.eventTimestamp - targetTimestamp >
      configuration.orderBookMaximumEventLatenessMs
    ) {
      timingFailure ??= {
        valid: false,
        completeness: 'MISSING',
        primaryReason: AlignmentReason.SAMPLE_TOO_LATE,
        reasons: [AlignmentReason.SAMPLE_TOO_LATE],
      };
      break;
    }

    const issue = issues.find(
      (candidate) =>
        (candidate.reason === AlignmentReason.CONFLICTING_DUPLICATE &&
          candidate.startTimestamp <= observation.eventTimestamp &&
          (candidate.endTimestamp === undefined ||
            candidate.endTimestamp > targetTimestamp)) ||
        crossesInterval(targetTimestamp, observation.eventTimestamp, candidate),
    );
    if (issue) {
      return {
        failure: {
          valid: false,
          completeness: issue.completeness,
          primaryReason: issue.reason,
          reasons: [issue.reason],
        },
      };
    }

    const crossedGap = gaps.find((gap) =>
      crossesInterval(targetTimestamp, observation.eventTimestamp, gap),
    );
    if (crossedGap) {
      return {
        failure: {
          valid: false,
          completeness: 'MISSING',
          primaryReason: crossedGap.reason,
          reasons: [crossedGap.reason],
        },
      };
    }

    const result = validateObservationEligibility({
      observation,
      requestedSource: source,
      sourceFallback: configuration.sourceFallback,
      targetTimestamp,
      availableAtTimestamp: observation.availabilityTimestamp,
      configuration,
      now,
      validityGaps: gaps,
    });
    if (result.valid) {
      return { observation };
    }
    timingFailure = result;
  }

  return {
    failure:
      timingFailure ??
      missingFailure(reconstruction, instrument, targetTimestamp),
  };
};

const alignVersionedRecord = (
  record: CorrelatedAlertRecordV2,
  request: OrderBookAlignmentRequest,
  index: OrderBookObservationIndex,
):
  | { results: AlignmentResult[] }
  | { rejection: OrderBookAlignmentRejection } => {
  const instrumentResult = validateInstrumentKey({
    instId: record.evaluationContext.instId,
    instType: record.evaluationContext.instType,
  });
  if (!instrumentResult.valid) {
    return {
      rejection: { ...instrumentResult, alertId: record.alert.id },
    };
  }

  const instrument = instrumentResult.value;
  const referenceResult = validateAlignmentReference(
    {
      provenance: 'CAPTURED_ALERT_CONTEXT',
      referenceTimestamp: record.evaluationContext.referenceTimestamp,
      midpoint: record.evaluationContext.referenceMidpoint,
      bestBid: record.evaluationContext.referenceBestBid,
      bestAsk: record.evaluationContext.referenceBestAsk,
    },
    request.configuration,
    request.now,
  );
  const linkageResult = validateSessionLinkage({
    alertSourceSessionId: record.sourceSessionId,
    instrument,
    candidateHeaders: [request.reconstruction.recording.header],
  });
  const results: AlignmentResult[] = [];

  for (const horizonMs of request.configuration.horizonsMs) {
    const targetResult = calculateTargetTimestamp(
      record.evaluationContext.referenceTimestamp,
      horizonMs,
      request.configuration,
      request.now,
    );

    for (const source of sources) {
      if (!referenceResult.valid) {
        results.push(
          fromFailure(
            record,
            request.reconstruction,
            request.configuration,
            instrument,
            source,
            horizonMs,
            targetResult.valid ? targetResult.value : null,
            referenceResult,
          ),
        );
        continue;
      }
      if (!targetResult.valid) {
        results.push(
          fromFailure(
            record,
            request.reconstruction,
            request.configuration,
            instrument,
            source,
            horizonMs,
            null,
            targetResult,
          ),
        );
        continue;
      }
      if (!linkageResult.valid) {
        results.push(
          fromFailure(
            record,
            request.reconstruction,
            request.configuration,
            instrument,
            source,
            horizonMs,
            targetResult.value,
            linkageResult,
          ),
        );
        continue;
      }

      const selected = selectObservation(
        index,
        request.reconstruction,
        request.configuration,
        instrument,
        source,
        targetResult.value,
        request.now,
      );
      if ('failure' in selected) {
        results.push(
          fromFailure(
            record,
            request.reconstruction,
            request.configuration,
            instrument,
            source,
            horizonMs,
            targetResult.value,
            selected.failure,
          ),
        );
        continue;
      }

      const truncated =
        request.reconstruction.recording.termination === 'TRUNCATED';
      results.push(
        createResult({
          record,
          reconstruction: request.reconstruction,
          configuration: request.configuration,
          instrument,
          source,
          horizonMs,
          targetTimestamp: targetResult.value,
          selectedObservation: selected.observation,
          completeness: truncated ? 'PARTIAL' : 'COMPLETE',
          primaryReason: truncated
            ? AlignmentReason.RECORDING_TRUNCATED
            : undefined,
        }),
      );
    }
  }

  return { results };
};

export const alignAlertsToOrderBooks = (
  request: OrderBookAlignmentRequest,
): OrderBookAlignmentBatchResult => {
  const index = new OrderBookObservationIndex(request.reconstruction);
  const results: AlignmentResult[] = [];
  const rejectedAlerts: OrderBookAlignmentRejection[] = [];

  for (const record of request.alertRecords) {
    if (record.schemaVersion !== 2) {
      rejectedAlerts.push({
        valid: false,
        alertId: record.alert.id,
        completeness: 'MISSING',
        primaryReason: AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
        reasons: [AlignmentReason.LEGACY_LINKAGE_UNVERIFIED],
      });
      continue;
    }

    const aligned = alignVersionedRecord(record, request, index);
    if ('rejection' in aligned) {
      rejectedAlerts.push(aligned.rejection);
    } else {
      results.push(...aligned.results);
    }
  }

  return {
    results: Object.freeze(sortAlignmentResults(results)),
    rejectedAlerts: Object.freeze(
      [...rejectedAlerts].sort((left, right) =>
        left.alertId.localeCompare(right.alertId),
      ),
    ),
  };
};

export const serializeOrderBookAlignmentResults = (
  results: readonly AlignmentResult[],
): string => JSON.stringify(sortAlignmentResults(results));
