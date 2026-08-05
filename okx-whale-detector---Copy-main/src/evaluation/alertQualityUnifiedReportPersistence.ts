import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from './canonicalJson';
import {
  ALERT_QUALITY_UNIFIED_REPORT_GENERATOR_VERSION,
  ALERT_QUALITY_UNIFIED_REPORT_SCHEMA_VERSION,
  type AlertQualityUnifiedReport,
} from './alertQualityUnifiedReport';

export interface AlertQualityUnifiedReportReadIssue {
  lineNumber: number;
  reason: 'MALFORMED_JSON' | 'INVALID_REPORT' | 'UNSUPPORTED_SCHEMA_VERSION';
  message: string;
}

export interface AlertQualityUnifiedReportReadResult {
  reports: readonly AlertQualityUnifiedReport[];
  exactDuplicateCount: number;
  issues: readonly AlertQualityUnifiedReportReadIssue[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const GROUP_DIMENSIONS = new Set([
  'INSTRUMENT_ID',
  'INSTRUMENT_TYPE',
  'HORIZON_MS',
  'SOURCE',
  'EVENT_TYPE',
  'RELATIONSHIP',
  'SEVERITY',
  'OKX_BIAS',
  'EXTERNAL_BIAS',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertNonNegativeSafeInteger = (name: string, value: unknown): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const normalizedDimensions = (value: unknown): string => {
  if (!Array.isArray(value)) return canonicalJsonStringify(value);
  return canonicalJsonStringify([...value].sort());
};

const assertSection = (
  name: string,
  section: unknown,
  report: Record<string, unknown>,
): void => {
  if (!isRecord(section)) throw new Error(`${name} must be an object`);
  if (section.reportRunId !== report.reportRunId) {
    throw new Error(`${name}.reportRunId must match the unified report`);
  }
  if (section.generatedAt !== report.generatedAt) {
    throw new Error(`${name}.generatedAt must match the unified report`);
  }
  if (
    normalizedDimensions(section.groupingDimensions) !==
    normalizedDimensions(report.groupingDimensions)
  ) {
    throw new Error(`${name}.groupingDimensions must match the unified report`);
  }
  assertNonNegativeSafeInteger(
    `${name}.inputRecordCount`,
    section.inputRecordCount,
  );
  assertNonNegativeSafeInteger(
    `${name}.uniqueCellCount`,
    section.uniqueCellCount,
  );
  assertNonNegativeSafeInteger(
    `${name}.exactDuplicateCellCount`,
    section.exactDuplicateCellCount,
  );
  if (!Array.isArray(section.groups)) {
    throw new Error(`${name}.groups must be an array`);
  }
};

export const validateAlertQualityUnifiedReport = (
  value: unknown,
): value is AlertQualityUnifiedReport => {
  if (!isRecord(value)) throw new Error('Unified report must be an object');
  if (value.schemaVersion !== ALERT_QUALITY_UNIFIED_REPORT_SCHEMA_VERSION) {
    throw new Error('Unsupported unified report schema version');
  }
  if (
    value.generatorVersion !== ALERT_QUALITY_UNIFIED_REPORT_GENERATOR_VERSION
  ) {
    throw new Error('Unsupported unified report generator version');
  }
  if (
    typeof value.reportRunId !== 'string' ||
    !IDENTIFIER_PATTERN.test(value.reportRunId)
  ) {
    throw new Error('reportRunId must be a valid durable identifier');
  }
  assertNonNegativeSafeInteger('generatedAt', value.generatedAt);
  if (!Array.isArray(value.groupingDimensions)) {
    throw new Error('groupingDimensions must be an array');
  }
  const dimensions = value.groupingDimensions;
  if (new Set(dimensions).size !== dimensions.length) {
    throw new Error('groupingDimensions must be unique');
  }
  if (
    dimensions.some(
      (dimension) =>
        typeof dimension !== 'string' || !GROUP_DIMENSIONS.has(dimension),
    )
  ) {
    throw new Error('groupingDimensions contains an unsupported dimension');
  }
  if (!isRecord(value.inputRecordCounts)) {
    throw new Error('inputRecordCounts must be an object');
  }
  assertNonNegativeSafeInteger(
    'inputRecordCounts.terminalReturn',
    value.inputRecordCounts.terminalReturn,
  );
  assertNonNegativeSafeInteger(
    'inputRecordCounts.pathOutcome',
    value.inputRecordCounts.pathOutcome,
  );
  assertNonNegativeSafeInteger(
    'inputRecordCounts.targetStop',
    value.inputRecordCounts.targetStop,
  );

  assertSection('terminalReturn', value.terminalReturn, value);
  assertSection('pathOutcome', value.pathOutcome, value);
  assertSection('targetStop', value.targetStop, value);

  const terminalReturn = value.terminalReturn as Record<string, unknown>;
  const pathOutcome = value.pathOutcome as Record<string, unknown>;
  const targetStop = value.targetStop as Record<string, unknown>;
  if (
    terminalReturn.inputRecordCount !== value.inputRecordCounts.terminalReturn
  ) {
    throw new Error('terminalReturn input count mismatch');
  }
  if (pathOutcome.inputRecordCount !== value.inputRecordCounts.pathOutcome) {
    throw new Error('pathOutcome input count mismatch');
  }
  if (targetStop.inputRecordCount !== value.inputRecordCounts.targetStop) {
    throw new Error('targetStop input count mismatch');
  }
  return true;
};

const reportIdentity = (report: AlertQualityUnifiedReport): string =>
  canonicalJsonStringify({
    reportRunId: report.reportRunId,
    generatedAt: report.generatedAt,
  });

export const serializeAlertQualityUnifiedReport = (
  report: AlertQualityUnifiedReport,
): string => {
  validateAlertQualityUnifiedReport(report);
  return `${canonicalJsonStringify(report)}\n`;
};

export const serializeAlertQualityUnifiedReports = (
  reports: readonly AlertQualityUnifiedReport[],
): string => {
  const unique = new Map<string, string>();
  for (const report of reports) {
    validateAlertQualityUnifiedReport(report);
    const identity = reportIdentity(report);
    const material = canonicalJsonStringify(report);
    const existing = unique.get(identity);
    if (existing !== undefined && existing !== material) {
      throw new Error(`Conflicting duplicate unified report: ${identity}`);
    }
    unique.set(identity, material);
  }
  const serialized = [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, material]) => material)
    .join('\n');
  return serialized.length > 0 ? `${serialized}\n` : '';
};

export const writeAlertQualityUnifiedReports = async (
  filePath: string,
  reports: readonly AlertQualityUnifiedReport[],
): Promise<void> => {
  await writeFile(
    filePath,
    serializeAlertQualityUnifiedReports(reports),
    'utf8',
  );
};

export const readAlertQualityUnifiedReportsFromText = (
  text: string,
): AlertQualityUnifiedReportReadResult => {
  const reports = new Map<
    string,
    { material: string; report: AlertQualityUnifiedReport }
  >();
  const issues: AlertQualityUnifiedReportReadIssue[] = [];
  let exactDuplicateCount = 0;
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      issues.push({
        lineNumber: index + 1,
        reason: 'MALFORMED_JSON',
        message: error instanceof Error ? error.message : 'Malformed JSON',
      });
      return;
    }
    if (
      isRecord(parsed) &&
      parsed.schemaVersion !== ALERT_QUALITY_UNIFIED_REPORT_SCHEMA_VERSION
    ) {
      issues.push({
        lineNumber: index + 1,
        reason: 'UNSUPPORTED_SCHEMA_VERSION',
        message: `Unsupported schema version: ${String(parsed.schemaVersion)}`,
      });
      return;
    }
    try {
      validateAlertQualityUnifiedReport(parsed);
      const report = parsed as AlertQualityUnifiedReport;
      const identity = reportIdentity(report);
      const material = canonicalJsonStringify(report);
      const existing = reports.get(identity);
      if (existing) {
        if (existing.material !== material) {
          throw new Error(`Conflicting duplicate unified report: ${identity}`);
        }
        exactDuplicateCount += 1;
        return;
      }
      reports.set(identity, { material, report });
    } catch (error) {
      issues.push({
        lineNumber: index + 1,
        reason: 'INVALID_REPORT',
        message: error instanceof Error ? error.message : 'Invalid unified report',
      });
    }
  });

  return {
    reports: Object.freeze(
      [...reports.values()]
        .sort((left, right) =>
          reportIdentity(left.report).localeCompare(reportIdentity(right.report)),
        )
        .map(({ report }) => report),
    ),
    exactDuplicateCount,
    issues: Object.freeze(issues),
  };
};

export const readAlertQualityUnifiedReports = async (
  filePath: string,
): Promise<AlertQualityUnifiedReportReadResult> =>
  readAlertQualityUnifiedReportsFromText(await readFile(filePath, 'utf8'));
