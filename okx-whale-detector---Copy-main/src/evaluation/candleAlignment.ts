import type {
  CorrelatedAlertRecord,
  CorrelatedAlertRecordV2,
} from '../recording/CorrelatedAlertRecorder';
import {
  ALIGNMENT_SCHEMA_VERSION,
  AlignmentReason,
  type AlignmentCompleteness,
  type AlignmentReason as AlignmentReasonType,
  type AlignmentResult,
  type AlignmentValidationFailure,
  type InstrumentKey,
} from './alignmentTypes';
import {
  getAlignmentEvaluationConfigVersion,
  type AlignmentConfigurationV1,
} from './alignmentConfiguration';
import {
  parseConfirmedCandleInterval,
  toConfirmedCandlePriceObservation,
  type NormalizedCandleRecording,
  type NormalizedConfirmedCandle,
  type SupportedConfirmedCandleInterval,
} from './candleNormalization';
import { ConfirmedCandleIndex } from './confirmedCandleIndex';
import { sortAlignmentResults } from './alignmentOrdering';
import {
  calculateTargetTimestamp,
  validateAlignmentReference,
  validateInstrumentKey,
  validateObservationEligibility,
  validateSessionLinkage,
} from './alignmentValidation';

export interface CandleAlignmentRequest {
  alertRecords: readonly CorrelatedAlertRecord[];
  recording: NormalizedCandleRecording;
  configuration: AlignmentConfigurationV1;
  interval: string;
  now: number;
}

export interface CandleAlignmentRejection extends AlignmentValidationFailure {
  alertId: string;
}

export interface CandleAlignmentBatchResult {
  results: readonly AlignmentResult[];
  rejectedAlerts: readonly CandleAlignmentRejection[];
}

const createResult = (input: {
  record: CorrelatedAlertRecordV2;
  recording: NormalizedCandleRecording;
  configuration: AlignmentConfigurationV1;
  instrument: InstrumentKey;
  horizonMs: number;
  targetTimestamp: number | null;
  selectedCandle?: NormalizedConfirmedCandle;
  completeness: AlignmentCompleteness;
  primaryReason?: AlignmentReasonType;
  additionalReasons?: readonly AlignmentReasonType[];
}): AlignmentResult => {
  const selectedObservation = input.selectedCandle
    ? toConfirmedCandlePriceObservation(input.selectedCandle)
    : null;
  const reasons = input.primaryReason
    ? [
        input.primaryReason,
        ...(input.additionalReasons ?? []).filter(
          (reason) => reason !== input.primaryReason,
        ),
      ]
    : [];

  return {
    alignmentSchemaVersion: ALIGNMENT_SCHEMA_VERSION,
    evaluationConfigVersion: getAlignmentEvaluationConfigVersion(
      input.configuration,
    ),
    alertId: input.record.alert.id,
    instrument: input.instrument,
    source: 'CONFIRMED_CANDLE_CLOSE',
    horizonMs: input.horizonMs,
    reference: {
      provenance: 'CAPTURED_ALERT_CONTEXT',
      referenceTimestamp: input.record.evaluationContext.referenceTimestamp,
      midpoint: input.record.evaluationContext.referenceMidpoint,
      bestBid: input.record.evaluationContext.referenceBestBid,
      bestAsk: input.record.evaluationContext.referenceBestAsk,
    },
    targetTimestamp: input.targetTimestamp,
    selectedObservation,
    observationDelayMs:
      selectedObservation && input.targetTimestamp !== null
        ? selectedObservation.eventTimestamp - input.targetTimestamp
        : null,
    availabilityDelayMs: selectedObservation
      ? selectedObservation.availabilityTimestamp -
        selectedObservation.eventTimestamp
      : null,
    completeness: input.completeness,
    primaryReason: input.primaryReason ?? null,
    reasons,
    sourceSessionId: input.record.sourceSessionId,
    recordingId: input.recording.header.recordingId,
    validityGaps: [],
    fallbackUsed: false,
    fallbackReason: null,
  };
};

const resultFromFailure = (
  record: CorrelatedAlertRecordV2,
  recording: NormalizedCandleRecording,
  configuration: AlignmentConfigurationV1,
  instrument: InstrumentKey,
  horizonMs: number,
  targetTimestamp: number | null,
  failure: AlignmentValidationFailure,
): AlignmentResult =>
  createResult({
    record,
    recording,
    configuration,
    instrument,
    horizonMs,
    targetTimestamp,
    completeness: failure.completeness,
    primaryReason: failure.primaryReason,
    additionalReasons: failure.reasons,
  });

const missingReason = (
  recording: NormalizedCandleRecording,
  targetTimestamp: number,
): AlignmentReason => {
  if (recording.termination === 'TRUNCATED') {
    return AlignmentReason.RECORDING_TRUNCATED;
  }

  if (recording.footer && recording.footer.endedAt < targetTimestamp) {
    return AlignmentReason.RECORDING_ENDED_BEFORE_HORIZON;
  }

  return AlignmentReason.NO_SAMPLE_AFTER_HORIZON;
};

const selectCandle = (
  index: ConfirmedCandleIndex,
  instrument: InstrumentKey,
  interval: SupportedConfirmedCandleInterval,
  targetTimestamp: number,
  recording: NormalizedCandleRecording,
  configuration: AlignmentConfigurationV1,
  now: number,
):
  | { selected: NormalizedConfirmedCandle }
  | { failure: AlignmentValidationFailure } => {
  const candidatesResult = index.getCandidates(
    instrument,
    interval,
    targetTimestamp,
  );
  if (!candidatesResult.valid) {
    return { failure: candidatesResult };
  }

  let timingFailure: AlignmentValidationFailure | undefined;

  for (const candidate of candidatesResult.value) {
    if (
      candidate.eventTimestamp - targetTimestamp >
      configuration.candleMaximumEventLatenessMs
    ) {
      timingFailure ??= {
        valid: false,
        completeness: 'MISSING',
        primaryReason: AlignmentReason.SAMPLE_TOO_LATE,
        reasons: [AlignmentReason.SAMPLE_TOO_LATE],
      };
      break;
    }

    if (index.isAmbiguous(candidate)) {
      return {
        failure: {
          valid: false,
          completeness: 'AMBIGUOUS',
          primaryReason: AlignmentReason.CONFLICTING_DUPLICATE,
          reasons: [AlignmentReason.CONFLICTING_DUPLICATE],
        },
      };
    }

    const observationResult = validateObservationEligibility({
      observation: toConfirmedCandlePriceObservation(candidate),
      requestedSource: 'CONFIRMED_CANDLE_CLOSE',
      sourceFallback: configuration.sourceFallback,
      targetTimestamp,
      availableAtTimestamp: candidate.availabilityTimestamp,
      configuration,
      now,
    });

    if (observationResult.valid) {
      if (
        recording.footer &&
        candidate.availabilityTimestamp > recording.footer.endedAt
      ) {
        return {
          failure: {
            valid: false,
            completeness: 'INVALID',
            primaryReason: AlignmentReason.EVENT_TIME_OUT_OF_ORDER,
            reasons: [AlignmentReason.EVENT_TIME_OUT_OF_ORDER],
          },
        };
      }

      return { selected: candidate };
    }

    timingFailure = observationResult;
  }

  return {
    failure: timingFailure ?? {
      valid: false,
      completeness: 'MISSING',
      primaryReason: missingReason(recording, targetTimestamp),
      reasons: [missingReason(recording, targetTimestamp)],
    },
  };
};

const alignVersionedAlert = (
  record: CorrelatedAlertRecordV2,
  recording: NormalizedCandleRecording,
  configuration: AlignmentConfigurationV1,
  interval: SupportedConfirmedCandleInterval,
  now: number,
  index: ConfirmedCandleIndex,
): { results: AlignmentResult[] } | { rejection: CandleAlignmentRejection } => {
  const instrumentResult = validateInstrumentKey({
    instId: record.evaluationContext.instId,
    instType: record.evaluationContext.instType,
  });
  if (!instrumentResult.valid) {
    return {
      rejection: {
        ...instrumentResult,
        alertId: record.alert.id,
      },
    };
  }

  const instrument = instrumentResult.value;
  const reference = {
    provenance: 'CAPTURED_ALERT_CONTEXT' as const,
    referenceTimestamp: record.evaluationContext.referenceTimestamp,
    midpoint: record.evaluationContext.referenceMidpoint,
    bestBid: record.evaluationContext.referenceBestBid,
    bestAsk: record.evaluationContext.referenceBestAsk,
  };
  const referenceResult = validateAlignmentReference(
    reference,
    configuration,
    now,
  );
  const linkageResult = validateSessionLinkage({
    alertSourceSessionId: record.sourceSessionId,
    instrument,
    candidateHeaders: [recording.header],
  });
  const results: AlignmentResult[] = [];

  for (const horizonMs of configuration.horizonsMs) {
    const targetResult = calculateTargetTimestamp(
      record.evaluationContext.referenceTimestamp,
      horizonMs,
      configuration,
      now,
    );

    if (!referenceResult.valid) {
      results.push(
        resultFromFailure(
          record,
          recording,
          configuration,
          instrument,
          horizonMs,
          targetResult.valid ? targetResult.value : null,
          referenceResult,
        ),
      );
      continue;
    }
    if (!targetResult.valid) {
      results.push(
        resultFromFailure(
          record,
          recording,
          configuration,
          instrument,
          horizonMs,
          null,
          targetResult,
        ),
      );
      continue;
    }
    if (!linkageResult.valid) {
      results.push(
        resultFromFailure(
          record,
          recording,
          configuration,
          instrument,
          horizonMs,
          targetResult.value,
          linkageResult,
        ),
      );
      continue;
    }

    const selected = selectCandle(
      index,
      instrument,
      interval,
      targetResult.value,
      recording,
      configuration,
      now,
    );

    if ('failure' in selected) {
      results.push(
        resultFromFailure(
          record,
          recording,
          configuration,
          instrument,
          horizonMs,
          targetResult.value,
          selected.failure,
        ),
      );
      continue;
    }

    if (recording.termination === 'TRUNCATED') {
      results.push(
        createResult({
          record,
          recording,
          configuration,
          instrument,
          horizonMs,
          targetTimestamp: targetResult.value,
          selectedCandle: selected.selected,
          completeness: 'PARTIAL',
          primaryReason: AlignmentReason.RECORDING_TRUNCATED,
        }),
      );
      continue;
    }

    results.push(
      createResult({
        record,
        recording,
        configuration,
        instrument,
        horizonMs,
        targetTimestamp: targetResult.value,
        selectedCandle: selected.selected,
        completeness: 'COMPLETE',
      }),
    );
  }

  return { results };
};

export const alignAlertsToConfirmedCandles = (
  request: CandleAlignmentRequest,
): CandleAlignmentBatchResult => {
  const intervalResult = parseConfirmedCandleInterval(request.interval);
  if (
    !intervalResult.valid ||
    !request.recording.header.subscriptions.candleIntervals.includes(
      request.interval,
    )
  ) {
    const failure = intervalResult.valid
      ? {
          valid: false as const,
          completeness: 'MISSING' as const,
          primaryReason: AlignmentReason.CANDLE_INTERVAL_UNKNOWN,
          reasons: [AlignmentReason.CANDLE_INTERVAL_UNKNOWN],
        }
      : intervalResult;

    return {
      results: [],
      rejectedAlerts: request.alertRecords.map((record) => ({
        ...failure,
        alertId: record.alert.id,
      })),
    };
  }

  const index = new ConfirmedCandleIndex(request.recording);
  const results: AlignmentResult[] = [];
  const rejectedAlerts: CandleAlignmentRejection[] = [];

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

    const aligned = alignVersionedAlert(
      record,
      request.recording,
      request.configuration,
      intervalResult.value.interval,
      request.now,
      index,
    );
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

export const serializeCandleAlignmentResults = (
  results: readonly AlignmentResult[],
): string => JSON.stringify(sortAlignmentResults(results));
