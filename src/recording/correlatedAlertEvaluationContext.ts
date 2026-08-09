import { createHash } from 'node:crypto';

import type { CorrelatedMarketSignal } from '../external/core/ExternalSignalCorrelationEngine';
import type {
  CorrelatedAlert,
  VersionedCorrelatedAlert,
} from '../types/correlatedAlert';
import type { CorrelatedAlertEvaluationContext } from '../types/correlatedAlertEvaluation';
import type { MarketInstrumentConfig } from '../types/instrument';

export interface CorrelatedAlertEvaluationContextInput {
  instrument: MarketInstrumentConfig;
  correlatedSignal: CorrelatedMarketSignal;
  sourceMarketTimestamp: number;
  referenceTimestamp: number;
  referenceMidpoint: number | undefined;
  referenceBestBid: number | undefined;
  referenceBestAsk: number | undefined;
}

const isUtcEpochMilliseconds = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const isFinitePositive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

const approximatelyEqual = (left: number, right: number): boolean => {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= Number.EPSILON * scale * 8;
};

export const isValidCorrelatedAlertEvaluationContext = (
  context: CorrelatedAlertEvaluationContext,
): boolean => {
  if (
    context.instId.length === 0 ||
    (context.instType !== 'SPOT' && context.instType !== 'SWAP') ||
    !isUtcEpochMilliseconds(context.sourceSignalTimestamp) ||
    !isUtcEpochMilliseconds(context.sourceMarketTimestamp) ||
    !isUtcEpochMilliseconds(context.referenceTimestamp) ||
    !isFinitePositive(context.referenceBestBid) ||
    !isFinitePositive(context.referenceBestAsk) ||
    context.referenceBestAsk < context.referenceBestBid ||
    !isFinitePositive(context.referenceMidpoint) ||
    !Number.isFinite(context.referenceSpread) ||
    context.referenceSpread < 0 ||
    !Number.isFinite(context.referenceSpreadPercent) ||
    context.referenceSpreadPercent < 0
  ) {
    return false;
  }

  const expectedMidpoint =
    (context.referenceBestBid + context.referenceBestAsk) / 2;
  const expectedSpread = context.referenceBestAsk - context.referenceBestBid;
  const expectedSpreadPercent = (expectedSpread / expectedMidpoint) * 100;

  return (
    approximatelyEqual(context.referenceMidpoint, expectedMidpoint) &&
    approximatelyEqual(context.referenceSpread, expectedSpread) &&
    approximatelyEqual(context.referenceSpreadPercent, expectedSpreadPercent) &&
    (context.sourceSignalIds === undefined ||
      context.sourceSignalIds.every(
        (signalId) => typeof signalId === 'string' && signalId.length > 0,
      ))
  );
};

export const createCorrelatedAlertEvaluationContext = (
  input: CorrelatedAlertEvaluationContextInput,
): CorrelatedAlertEvaluationContext | undefined => {
  const {
    instrument,
    correlatedSignal,
    sourceMarketTimestamp,
    referenceTimestamp,
    referenceMidpoint,
    referenceBestBid,
    referenceBestAsk,
  } = input;

  if (
    !isFinitePositive(referenceBestBid) ||
    !isFinitePositive(referenceBestAsk) ||
    referenceBestAsk < referenceBestBid ||
    !isFinitePositive(referenceMidpoint)
  ) {
    return undefined;
  }

  const context: CorrelatedAlertEvaluationContext = {
    instId: instrument.instId,
    instType: instrument.instType,
    okxBias: correlatedSignal.okxBias,
    externalBias: correlatedSignal.externalBias,
    sourceSignalTimestamp: correlatedSignal.timestamp,
    sourceMarketTimestamp,
    referenceTimestamp,
    referenceMidpoint,
    referenceBestBid,
    referenceBestAsk,
    referenceSpread: referenceBestAsk - referenceBestBid,
    referenceSpreadPercent:
      ((referenceBestAsk - referenceBestBid) / referenceMidpoint) * 100,
    sourceSignalIds: Object.freeze(
      [
        ...new Set(
          correlatedSignal.contributions.map(
            (contribution) => contribution.signalId,
          ),
        ),
      ].sort(),
    ),
  };

  return isValidCorrelatedAlertEvaluationContext(context)
    ? Object.freeze(context)
    : undefined;
};

/**
 * SHA-256 collisions are computationally negligible, but the fingerprint is
 * only a semantic replay-matching aid. The session/sequence alert ID remains
 * the authoritative persisted identity.
 */
export const createCorrelatedAlertSemanticFingerprint = (
  alert: CorrelatedAlert,
  context: CorrelatedAlertEvaluationContext,
): string => {
  const canonicalFields = [
    context.instId,
    context.instType,
    String(context.sourceSignalTimestamp),
    String(context.sourceMarketTimestamp),
    String(context.referenceTimestamp),
    String(alert.createdAt),
    alert.relationship,
    context.okxBias,
    context.externalBias,
    alert.bias,
    alert.eventType,
  ];

  return createHash('sha256')
    .update(canonicalFields.join('\u001f'), 'utf8')
    .digest('hex');
};

export const hasVersionedAlertIdentity = (
  alert: CorrelatedAlert,
): alert is VersionedCorrelatedAlert =>
  typeof alert.sourceSessionId === 'string' &&
  alert.sourceSessionId.length > 0 &&
  Number.isSafeInteger(alert.alertSequence) &&
  (alert.alertSequence ?? 0) > 0 &&
  alert.id ===
    `correlated-alert:${alert.sourceSessionId}:${alert.alertSequence}`;
