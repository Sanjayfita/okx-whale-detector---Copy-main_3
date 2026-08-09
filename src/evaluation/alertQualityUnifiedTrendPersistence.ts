import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from './canonicalJson';
import {
  ALERT_QUALITY_UNIFIED_TREND_GENERATOR_VERSION,
  ALERT_QUALITY_UNIFIED_TREND_SCHEMA_VERSION,
  type AlertQualityUnifiedTrend,
} from './alertQualityUnifiedTrend';

export interface AlertQualityUnifiedTrendReadIssue {
  lineNumber: number;
  reason: 'MALFORMED_JSON' | 'INVALID_TREND' | 'UNSUPPORTED_SCHEMA_VERSION';
  message: string;
}

export interface AlertQualityUnifiedTrendReadResult {
  trends: readonly AlertQualityUnifiedTrend[];
  exactDuplicateCount: number;
  issues: readonly AlertQualityUnifiedTrendReadIssue[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertNonNegativeSafeInteger = (name: string, value: unknown): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const assertNullableFiniteNumber = (name: string, value: unknown): void => {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${name} must be a finite number or null`);
  }
};

const assertReportPoint = (value: unknown, index: number): void => {
  if (!isRecord(value)) throw new Error(`reports[${index}] must be an object`);
  if (
    typeof value.reportRunId !== 'string' ||
    !IDENTIFIER_PATTERN.test(value.reportRunId)
  ) {
    throw new Error(`reports[${index}].reportRunId must be a valid durable identifier`);
  }
  assertNonNegativeSafeInteger(`reports[${index}].generatedAt`, value.generatedAt);
  if (!isRecord(value.inputRecordCounts)) {
    throw new Error(`reports[${index}].inputRecordCounts must be an object`);
  }
  assertNonNegativeSafeInteger(
    `reports[${index}].inputRecordCounts.terminalReturn`,
    value.inputRecordCounts.terminalReturn,
  );
  assertNonNegativeSafeInteger(
    `reports[${index}].inputRecordCounts.pathOutcome`,
    value.inputRecordCounts.pathOutcome,
  );
  assertNonNegativeSafeInteger(
    `reports[${index}].inputRecordCounts.targetStop`,
    value.inputRecordCounts.targetStop,
  );
};

const assertMetric = (value: unknown, index: number): void => {
  if (!isRecord(value)) throw new Error(`metrics[${index}] must be an object`);
  for (const field of ['metricKey', 'section', 'groupKey', 'metric'] as const) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new Error(`metrics[${index}].${field} must be a non-empty string`);
    }
  }
  if (value.family !== null && typeof value.family !== 'string') {
    throw new Error(`metrics[${index}].family must be a string or null`);
  }
  for (const field of [
    'observedTransitionCount',
    'improvedCount',
    'degradedCount',
    'unchangedCount',
    'unavailableCount',
  ] as const) {
    assertNonNegativeSafeInteger(`metrics[${index}].${field}`, value[field]);
  }
  for (const field of ['netDelta', 'firstObservedValue', 'lastObservedValue'] as const) {
    assertNullableFiniteNumber(`metrics[${index}].${field}`, value[field]);
  }
  if (!['IMPROVED', 'DEGRADED', 'UNCHANGED', 'UNAVAILABLE'].includes(String(value.overallChange))) {
    throw new Error(`metrics[${index}].overallChange is unsupported`);
  }
};

export const validateAlertQualityUnifiedTrend = (
  value: unknown,
): value is AlertQualityUnifiedTrend => {
  if (!isRecord(value)) throw new Error('Unified trend must be an object');
  if (value.schemaVersion !== ALERT_QUALITY_UNIFIED_TREND_SCHEMA_VERSION) {
    throw new Error('Unsupported unified trend schema version');
  }
  if (value.generatorVersion !== ALERT_QUALITY_UNIFIED_TREND_GENERATOR_VERSION) {
    throw new Error('Unsupported unified trend generator version');
  }
  if (!Array.isArray(value.groupingDimensions)) {
    throw new Error('groupingDimensions must be an array');
  }
  if (
    value.groupingDimensions.some((dimension) => typeof dimension !== 'string') ||
    new Set(value.groupingDimensions).size !== value.groupingDimensions.length
  ) {
    throw new Error('groupingDimensions must contain unique strings');
  }
  if (!Array.isArray(value.reports) || value.reports.length < 2) {
    throw new Error('reports must contain at least two report points');
  }
  value.reports.forEach(assertReportPoint);
  const identities = value.reports.map((report) => {
    const point = report as Record<string, unknown>;
    return `${String(point.generatedAt)}:${String(point.reportRunId)}`;
  });
  if (new Set(identities).size !== identities.length) {
    throw new Error('report point identities must be unique');
  }
  if (!Array.isArray(value.transitions) || value.transitions.length !== value.reports.length - 1) {
    throw new Error('transitions must connect every adjacent report point');
  }
  if (!Array.isArray(value.metrics)) throw new Error('metrics must be an array');
  value.metrics.forEach(assertMetric);
  if (new Set(value.metrics.map((metric) => (metric as Record<string, unknown>).metricKey)).size !== value.metrics.length) {
    throw new Error('metric keys must be unique');
  }
  for (const field of [
    'totalImprovedMetricCount',
    'totalDegradedMetricCount',
    'totalUnchangedMetricCount',
    'totalUnavailableMetricCount',
  ] as const) {
    assertNonNegativeSafeInteger(field, value[field]);
  }
  return true;
};

const trendIdentity = (trend: AlertQualityUnifiedTrend): string =>
  canonicalJsonStringify({
    firstReport: trend.reports[0],
    lastReport: trend.reports[trend.reports.length - 1],
    reportCount: trend.reports.length,
  });

export const serializeAlertQualityUnifiedTrend = (
  trend: AlertQualityUnifiedTrend,
): string => {
  validateAlertQualityUnifiedTrend(trend);
  return `${canonicalJsonStringify(trend)}\n`;
};

export const serializeAlertQualityUnifiedTrends = (
  trends: readonly AlertQualityUnifiedTrend[],
): string => {
  const unique = new Map<string, string>();
  for (const trend of trends) {
    validateAlertQualityUnifiedTrend(trend);
    const identity = trendIdentity(trend);
    const material = canonicalJsonStringify(trend);
    const existing = unique.get(identity);
    if (existing !== undefined && existing !== material) {
      throw new Error(`Conflicting duplicate unified trend: ${identity}`);
    }
    unique.set(identity, material);
  }
  const serialized = [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, material]) => material)
    .join('\n');
  return serialized.length > 0 ? `${serialized}\n` : '';
};

export const writeAlertQualityUnifiedTrends = async (
  filePath: string,
  trends: readonly AlertQualityUnifiedTrend[],
): Promise<void> => {
  await writeFile(filePath, serializeAlertQualityUnifiedTrends(trends), 'utf8');
};

export const readAlertQualityUnifiedTrendsFromText = (
  text: string,
): AlertQualityUnifiedTrendReadResult => {
  const trends = new Map<string, { material: string; trend: AlertQualityUnifiedTrend }>();
  const issues: AlertQualityUnifiedTrendReadIssue[] = [];
  let exactDuplicateCount = 0;

  text.split(/\r?\n/).forEach((line, index) => {
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
    if (isRecord(parsed) && parsed.schemaVersion !== ALERT_QUALITY_UNIFIED_TREND_SCHEMA_VERSION) {
      issues.push({
        lineNumber: index + 1,
        reason: 'UNSUPPORTED_SCHEMA_VERSION',
        message: `Unsupported schema version: ${String(parsed.schemaVersion)}`,
      });
      return;
    }
    try {
      validateAlertQualityUnifiedTrend(parsed);
      const trend = parsed as AlertQualityUnifiedTrend;
      const identity = trendIdentity(trend);
      const material = canonicalJsonStringify(trend);
      const existing = trends.get(identity);
      if (existing) {
        if (existing.material !== material) {
          throw new Error(`Conflicting duplicate unified trend: ${identity}`);
        }
        exactDuplicateCount += 1;
        return;
      }
      trends.set(identity, { material, trend });
    } catch (error) {
      issues.push({
        lineNumber: index + 1,
        reason: 'INVALID_TREND',
        message: error instanceof Error ? error.message : 'Invalid unified trend',
      });
    }
  });

  return {
    trends: Object.freeze(
      [...trends.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, entry]) => entry.trend),
    ),
    exactDuplicateCount,
    issues: Object.freeze(issues),
  };
};

export const readAlertQualityUnifiedTrends = async (
  filePath: string,
): Promise<AlertQualityUnifiedTrendReadResult> =>
  readAlertQualityUnifiedTrendsFromText(await readFile(filePath, 'utf8'));
