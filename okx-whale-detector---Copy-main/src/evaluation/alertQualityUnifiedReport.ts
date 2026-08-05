import type { AlertPathOutcomeRecord } from './pathOutcome';
import type { AlertTargetStopOutcomeRecord } from './targetStopOutcome';
import type { AlertTerminalReturnRecord } from './terminalReturn';
import {
  aggregatePathOutcomeQuality,
  type AlertQualityPathOutcomeGroupDimension,
  type AlertQualityPathOutcomeReport,
} from './alertQualityPathOutcomeAggregator';
import {
  aggregateTargetStopQuality,
  type AlertQualityTargetStopGroupDimension,
  type AlertQualityTargetStopReport,
} from './alertQualityTargetStopAggregator';
import {
  aggregateTerminalReturnQuality,
  type AlertQualityTerminalReturnGroupDimension,
  type AlertQualityTerminalReturnReport,
} from './alertQualityTerminalReturnAggregator';

export const ALERT_QUALITY_UNIFIED_REPORT_SCHEMA_VERSION = 1 as const;
export const ALERT_QUALITY_UNIFIED_REPORT_GENERATOR_VERSION =
  'alert-quality-unified-report-generator-v1' as const;

export type AlertQualityUnifiedGroupDimension =
  AlertQualityTerminalReturnGroupDimension &
    AlertQualityPathOutcomeGroupDimension &
    AlertQualityTargetStopGroupDimension;

export interface AlertQualityUnifiedReport {
  schemaVersion: typeof ALERT_QUALITY_UNIFIED_REPORT_SCHEMA_VERSION;
  generatorVersion: typeof ALERT_QUALITY_UNIFIED_REPORT_GENERATOR_VERSION;
  reportRunId: string;
  generatedAt: number;
  groupingDimensions: readonly AlertQualityUnifiedGroupDimension[];
  inputRecordCounts: {
    terminalReturn: number;
    pathOutcome: number;
    targetStop: number;
  };
  terminalReturn: AlertQualityTerminalReturnReport;
  pathOutcome: AlertQualityPathOutcomeReport;
  targetStop: AlertQualityTargetStopReport;
}

export interface GenerateAlertQualityUnifiedReportInput {
  terminalReturnRecords: readonly AlertTerminalReturnRecord[];
  pathOutcomeRecords: readonly AlertPathOutcomeRecord[];
  targetStopRecords: readonly AlertTargetStopOutcomeRecord[];
  reportRunId: string;
  generatedAt: number;
  groupingDimensions?: readonly AlertQualityUnifiedGroupDimension[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

const assertMetadata = (input: GenerateAlertQualityUnifiedReportInput): void => {
  if (!IDENTIFIER_PATTERN.test(input.reportRunId)) {
    throw new Error('reportRunId must be a valid durable identifier');
  }
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('generatedAt must be a non-negative safe integer');
  }
};

export const generateAlertQualityUnifiedReport = (
  input: GenerateAlertQualityUnifiedReportInput,
): AlertQualityUnifiedReport => {
  assertMetadata(input);
  const groupingDimensions = Object.freeze([...(input.groupingDimensions ?? [])]);

  const terminalReturn = aggregateTerminalReturnQuality({
    records: input.terminalReturnRecords,
    reportRunId: input.reportRunId,
    generatedAt: input.generatedAt,
    groupingDimensions,
  });
  const pathOutcome = aggregatePathOutcomeQuality({
    records: input.pathOutcomeRecords,
    reportRunId: input.reportRunId,
    generatedAt: input.generatedAt,
    groupingDimensions,
  });
  const targetStop = aggregateTargetStopQuality({
    records: input.targetStopRecords,
    reportRunId: input.reportRunId,
    generatedAt: input.generatedAt,
    groupingDimensions,
  });

  return Object.freeze({
    schemaVersion: ALERT_QUALITY_UNIFIED_REPORT_SCHEMA_VERSION,
    generatorVersion: ALERT_QUALITY_UNIFIED_REPORT_GENERATOR_VERSION,
    reportRunId: input.reportRunId,
    generatedAt: input.generatedAt,
    groupingDimensions,
    inputRecordCounts: Object.freeze({
      terminalReturn: input.terminalReturnRecords.length,
      pathOutcome: input.pathOutcomeRecords.length,
      targetStop: input.targetStopRecords.length,
    }),
    terminalReturn,
    pathOutcome,
    targetStop,
  });
};
