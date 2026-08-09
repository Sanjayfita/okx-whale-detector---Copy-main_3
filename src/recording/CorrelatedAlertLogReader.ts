import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import {
  CORRELATED_ALERT_SCHEMA_VERSION,
  LEGACY_CORRELATED_ALERT_SCHEMA_VERSION,
  type CorrelatedAlertRecord,
  type CorrelatedAlertRecordV1,
  type CorrelatedAlertRecordV2,
} from './CorrelatedAlertRecorder';
import {
  createCorrelatedAlertSemanticFingerprint,
  hasVersionedAlertIdentity,
  isValidCorrelatedAlertEvaluationContext,
} from './correlatedAlertEvaluationContext';
import type {
  CorrelatedAlert,
  CorrelatedAlertEventType,
  CorrelatedAlertSeverity,
  VersionedCorrelatedAlert,
} from '../types/correlatedAlert';
import type { CorrelatedAlertEvaluationContext } from '../types/correlatedAlertEvaluation';

export interface MalformedCorrelatedAlertLine {
  lineNumber: number;
  message: string;
}

export interface CorrelatedAlertLogReadResult {
  records: CorrelatedAlertRecord[];
  malformedLines: MalformedCorrelatedAlertLine[];
}

export interface CorrelatedAlertLogReadOptions {
  maximumRecords?: number;
}

const ALERT_SEVERITIES = new Set<CorrelatedAlertSeverity>([
  'INFO',
  'WATCH',
  'STRONG',
  'CRITICAL',
]);
const ALERT_EVENT_TYPES = new Set<CorrelatedAlertEventType>([
  'NEW_SIGNAL',
  'CONFIDENCE_INCREASED',
  'DIRECTION_CHANGED',
  'AGREEMENT',
  'CONTRADICTION',
]);
const MARKET_BIASES = new Set(['BULLISH', 'BEARISH', 'NEUTRAL']);
const RELATIONSHIPS = new Set([
  'AGREEMENT',
  'CONTRADICTION',
  'EXTERNAL_ONLY',
  'OKX_ONLY',
  'NEUTRAL',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isUtcEpochMilliseconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const parseAlert = (
  value: Record<string, unknown>,
  allowLegacyImportanceFallback: boolean,
): CorrelatedAlert => {
  if (
    typeof value.id !== 'string' ||
    typeof value.symbol !== 'string' ||
    !ALERT_SEVERITIES.has(value.severity as CorrelatedAlertSeverity) ||
    !ALERT_EVENT_TYPES.has(value.eventType as CorrelatedAlertEventType) ||
    !MARKET_BIASES.has(String(value.bias)) ||
    !RELATIONSHIPS.has(String(value.relationship)) ||
    !isFiniteNumber(value.combinedConfidence) ||
    (value.alertImportance === undefined
      ? !allowLegacyImportanceFallback
      : !isFiniteNumber(value.alertImportance) ||
        value.alertImportance < 0 ||
        value.alertImportance > 100) ||
    !isFiniteNumber(value.okxConfidence) ||
    !isFiniteNumber(value.externalEffectiveConfidence) ||
    !isFiniteNumber(value.externalSignalsUsed) ||
    !isFiniteNumber(value.ignoredExternalSignals) ||
    typeof value.reason !== 'string' ||
    !isFiniteNumber(value.createdAt)
  ) {
    throw new Error('Invalid correlated alert payload');
  }

  return {
    ...value,
    alertImportance:
      value.alertImportance === undefined
        ? value.combinedConfidence
        : value.alertImportance,
  } as unknown as CorrelatedAlert;
};

const parseLegacyRecord = (
  value: Record<string, unknown>,
): CorrelatedAlertRecordV1 => {
  if (!isFiniteNumber(value.recordedAt) || !isRecord(value.alert)) {
    throw new Error('Invalid legacy correlated alert record');
  }

  return {
    ...value,
    schemaVersion: LEGACY_CORRELATED_ALERT_SCHEMA_VERSION,
    recordedAt: value.recordedAt,
    alert: parseAlert(value.alert, true),
  } as CorrelatedAlertRecordV1;
};

const parseEvaluationContext = (
  value: unknown,
): CorrelatedAlertEvaluationContext => {
  if (
    !isRecord(value) ||
    typeof value.instId !== 'string' ||
    (value.instType !== 'SPOT' && value.instType !== 'SWAP') ||
    !MARKET_BIASES.has(String(value.okxBias)) ||
    !MARKET_BIASES.has(String(value.externalBias)) ||
    !isUtcEpochMilliseconds(value.sourceSignalTimestamp) ||
    !isUtcEpochMilliseconds(value.sourceMarketTimestamp) ||
    !isUtcEpochMilliseconds(value.referenceTimestamp) ||
    !isFiniteNumber(value.referenceMidpoint) ||
    !isFiniteNumber(value.referenceBestBid) ||
    !isFiniteNumber(value.referenceBestAsk) ||
    !isFiniteNumber(value.referenceSpread) ||
    !isFiniteNumber(value.referenceSpreadPercent) ||
    (value.sourceSignalIds !== undefined &&
      (!Array.isArray(value.sourceSignalIds) ||
        !value.sourceSignalIds.every(
          (signalId) => typeof signalId === 'string',
        )))
  ) {
    throw new Error('Invalid correlated alert evaluation context');
  }

  const context = value as unknown as CorrelatedAlertEvaluationContext;

  if (!isValidCorrelatedAlertEvaluationContext(context)) {
    throw new Error('Invalid correlated alert evaluation context');
  }

  return {
    ...context,
    sourceSignalIds:
      context.sourceSignalIds === undefined
        ? undefined
        : [...context.sourceSignalIds],
  };
};

const parseVersionedRecord = (
  value: Record<string, unknown>,
): CorrelatedAlertRecordV2 => {
  if (
    !isUtcEpochMilliseconds(value.recordedAt) ||
    typeof value.sourceSessionId !== 'string' ||
    !Number.isSafeInteger(value.alertSequence) ||
    (value.alertSequence as number) <= 0 ||
    typeof value.semanticFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.semanticFingerprint) ||
    (value.provenance !== 'LIVE' &&
      value.provenance !== 'REPLAY' &&
      value.provenance !== 'SIMULATION') ||
    !isRecord(value.alert)
  ) {
    throw new Error('Invalid version 2 correlated alert record');
  }

  const alert = parseAlert(value.alert, false);

  if (
    !isUtcEpochMilliseconds(alert.createdAt) ||
    !hasVersionedAlertIdentity(alert) ||
    alert.sourceSessionId !== value.sourceSessionId ||
    alert.alertSequence !== value.alertSequence
  ) {
    throw new Error('Invalid version 2 correlated alert identity');
  }

  const evaluationContext = parseEvaluationContext(value.evaluationContext);
  const expectedFingerprint = createCorrelatedAlertSemanticFingerprint(
    alert,
    evaluationContext,
  );

  if (value.semanticFingerprint !== expectedFingerprint) {
    throw new Error('Invalid correlated alert semantic fingerprint');
  }

  return {
    ...value,
    schemaVersion: CORRELATED_ALERT_SCHEMA_VERSION,
    recordedAt: value.recordedAt,
    sourceSessionId: value.sourceSessionId,
    alertSequence: value.alertSequence as number,
    semanticFingerprint: value.semanticFingerprint,
    provenance: value.provenance,
    alert: alert as VersionedCorrelatedAlert,
    evaluationContext,
  };
};

export const parseCorrelatedAlertRecord = (
  line: string,
): CorrelatedAlertRecord => {
  const value: unknown = JSON.parse(line);

  if (!isRecord(value)) {
    throw new Error('Invalid correlated alert record');
  }

  if (value.schemaVersion === LEGACY_CORRELATED_ALERT_SCHEMA_VERSION) {
    return parseLegacyRecord(value);
  }

  if (value.schemaVersion === CORRELATED_ALERT_SCHEMA_VERSION) {
    return parseVersionedRecord(value);
  }

  throw new Error('Unsupported correlated alert schema version');
};

export class CorrelatedAlertLogReader {
  public async read(
    filePath: string,
    options: CorrelatedAlertLogReadOptions = {},
  ): Promise<CorrelatedAlertLogReadResult> {
    const maximumRecords = options.maximumRecords;

    if (
      maximumRecords !== undefined &&
      (!Number.isInteger(maximumRecords) || maximumRecords <= 0)
    ) {
      throw new Error('maximumRecords must be a positive integer');
    }

    const records: CorrelatedAlertRecord[] = [];
    const malformedLines: MalformedCorrelatedAlertLine[] = [];
    const input = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    let lineNumber = 0;

    for await (const line of input) {
      lineNumber += 1;

      if (line.trim().length === 0) {
        continue;
      }

      try {
        records.push(parseCorrelatedAlertRecord(line));
      } catch (error: unknown) {
        malformedLines.push({
          lineNumber,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (maximumRecords !== undefined && records.length >= maximumRecords) {
        break;
      }
    }

    return { records, malformedLines };
  }
}
