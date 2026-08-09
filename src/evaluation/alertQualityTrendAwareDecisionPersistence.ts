import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from './canonicalJson';
import type {
  AlertQualityResearchDecision,
  AlertQualityResearchDecisionReason,
  AlertQualityTrendAwareDecisionReport,
} from './alertQualityTrendAwareDecision';
import type { AlertQualityUnifiedTrend } from './alertQualityUnifiedTrend';

export const ALERT_QUALITY_TREND_AWARE_DECISION_SCHEMA_VERSION = 1 as const;
export const ALERT_QUALITY_TREND_AWARE_DECISION_ENGINE_VERSION =
  'alert-quality-trend-aware-decision-v1' as const;

export interface PersistedAlertQualityTrendAwareDecision {
  schemaVersion: typeof ALERT_QUALITY_TREND_AWARE_DECISION_SCHEMA_VERSION;
  engineVersion: typeof ALERT_QUALITY_TREND_AWARE_DECISION_ENGINE_VERSION;
  decisionRunId: string;
  generatedAt: number;
  sourceReportRunId: string;
  sourceReportGeneratedAt: number;
  sourceTrendFirstReportRunId: string;
  sourceTrendFirstReportGeneratedAt: number;
  sourceTrendLastReportRunId: string;
  sourceTrendLastReportGeneratedAt: number;
  usedTrendComparison: boolean;
  decision: AlertQualityResearchDecision;
  reasons: readonly AlertQualityResearchDecisionReason[];
  thresholdCounts: AlertQualityTrendAwareDecisionReport['thresholdCounts'];
  trendCounts: AlertQualityTrendAwareDecisionReport['trendCounts'];
  comparisonCounts: AlertQualityTrendAwareDecisionReport['comparisonCounts'];
}

export interface AlertQualityTrendAwareDecisionReadIssue {
  lineNumber: number;
  reason: 'MALFORMED_JSON' | 'INVALID_DECISION' | 'UNSUPPORTED_SCHEMA_VERSION';
  message: string;
}

export interface AlertQualityTrendAwareDecisionReadResult {
  decisions: readonly PersistedAlertQualityTrendAwareDecision[];
  exactDuplicateCount: number;
  issues: readonly AlertQualityTrendAwareDecisionReadIssue[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DECISIONS = new Set<AlertQualityResearchDecision>([
  'QUALIFIED',
  'QUALIFIED_BUT_DECELERATING',
  'WATCH',
  'INSUFFICIENT_EVIDENCE',
  'DISQUALIFIED',
  'DEGRADING',
  'REVERSING_POSITIVE',
  'REVERSING_NEGATIVE',
]);
const REASONS = new Set<AlertQualityResearchDecisionReason>([
  'ALL_GROUPS_PASS',
  'SOME_GROUPS_FAIL',
  'INSUFFICIENT_DATA_PRESENT',
  'TREND_IMPROVING',
  'TREND_DEGRADING',
  'TREND_STABLE',
  'TREND_DECELERATING',
  'POSITIVE_REVERSAL',
  'NEGATIVE_REVERSAL',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertIdentifier = (name: string, value: unknown): void => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${name} must be a valid durable identifier`);
  }
};

const assertNonNegativeSafeInteger = (name: string, value: unknown): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const assertCounts = (name: string, value: unknown, keys: readonly string[]): void => {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  keys.forEach((key) => assertNonNegativeSafeInteger(`${name}.${key}`, value[key]));
};

export const createPersistedAlertQualityTrendAwareDecision = (input: {
  decisionReport: AlertQualityTrendAwareDecisionReport;
  trend: AlertQualityUnifiedTrend;
  decisionRunId: string;
  generatedAt: number;
}): PersistedAlertQualityTrendAwareDecision => {
  assertIdentifier('decisionRunId', input.decisionRunId);
  assertNonNegativeSafeInteger('generatedAt', input.generatedAt);
  if (input.trend.reports.length < 2) {
    throw new Error('Trend-aware decision persistence requires at least two trend reports');
  }
  const first = input.trend.reports[0]!;
  const last = input.trend.reports[input.trend.reports.length - 1]!;

  return Object.freeze({
    schemaVersion: ALERT_QUALITY_TREND_AWARE_DECISION_SCHEMA_VERSION,
    engineVersion: ALERT_QUALITY_TREND_AWARE_DECISION_ENGINE_VERSION,
    decisionRunId: input.decisionRunId,
    generatedAt: input.generatedAt,
    sourceReportRunId: input.decisionReport.sourceReportRunId,
    sourceReportGeneratedAt: input.decisionReport.sourceReportGeneratedAt,
    sourceTrendFirstReportRunId: first.reportRunId,
    sourceTrendFirstReportGeneratedAt: first.generatedAt,
    sourceTrendLastReportRunId: last.reportRunId,
    sourceTrendLastReportGeneratedAt: last.generatedAt,
    usedTrendComparison: input.decisionReport.comparisonCounts !== null,
    decision: input.decisionReport.decision,
    reasons: Object.freeze([...input.decisionReport.reasons]),
    thresholdCounts: Object.freeze({ ...input.decisionReport.thresholdCounts }),
    trendCounts: Object.freeze({ ...input.decisionReport.trendCounts }),
    comparisonCounts: input.decisionReport.comparisonCounts
      ? Object.freeze({ ...input.decisionReport.comparisonCounts })
      : null,
  });
};

export const validatePersistedAlertQualityTrendAwareDecision = (
  value: unknown,
): value is PersistedAlertQualityTrendAwareDecision => {
  if (!isRecord(value)) throw new Error('Trend-aware decision must be an object');
  if (value.schemaVersion !== ALERT_QUALITY_TREND_AWARE_DECISION_SCHEMA_VERSION) {
    throw new Error('Unsupported trend-aware decision schema version');
  }
  if (value.engineVersion !== ALERT_QUALITY_TREND_AWARE_DECISION_ENGINE_VERSION) {
    throw new Error('Unsupported trend-aware decision engine version');
  }
  assertIdentifier('decisionRunId', value.decisionRunId);
  assertIdentifier('sourceReportRunId', value.sourceReportRunId);
  assertIdentifier('sourceTrendFirstReportRunId', value.sourceTrendFirstReportRunId);
  assertIdentifier('sourceTrendLastReportRunId', value.sourceTrendLastReportRunId);
  assertNonNegativeSafeInteger('generatedAt', value.generatedAt);
  assertNonNegativeSafeInteger('sourceReportGeneratedAt', value.sourceReportGeneratedAt);
  assertNonNegativeSafeInteger(
    'sourceTrendFirstReportGeneratedAt',
    value.sourceTrendFirstReportGeneratedAt,
  );
  assertNonNegativeSafeInteger(
    'sourceTrendLastReportGeneratedAt',
    value.sourceTrendLastReportGeneratedAt,
  );
  if (typeof value.usedTrendComparison !== 'boolean') {
    throw new Error('usedTrendComparison must be a boolean');
  }
  if (!DECISIONS.has(value.decision as AlertQualityResearchDecision)) {
    throw new Error('decision is invalid');
  }
  if (
    !Array.isArray(value.reasons) ||
    value.reasons.some((reason) => !REASONS.has(reason as AlertQualityResearchDecisionReason))
  ) {
    throw new Error('reasons contains an invalid reason');
  }
  assertCounts('thresholdCounts', value.thresholdCounts, [
    'passed',
    'failed',
    'insufficientData',
  ]);
  assertCounts('trendCounts', value.trendCounts, [
    'improved',
    'degraded',
    'unchanged',
    'unavailable',
  ]);
  if (value.comparisonCounts === null) {
    if (value.usedTrendComparison) {
      throw new Error('comparisonCounts must be present when usedTrendComparison is true');
    }
  } else {
    if (!value.usedTrendComparison) {
      throw new Error('comparisonCounts must be null when usedTrendComparison is false');
    }
    assertCounts('comparisonCounts', value.comparisonCounts, [
      'accelerating',
      'decelerating',
      'steady',
      'reversing',
      'unavailable',
    ]);
  }
  return true;
};

const identity = (decision: PersistedAlertQualityTrendAwareDecision): string =>
  canonicalJsonStringify({
    decisionRunId: decision.decisionRunId,
    generatedAt: decision.generatedAt,
  });

export const serializeAlertQualityTrendAwareDecisions = (
  decisions: readonly PersistedAlertQualityTrendAwareDecision[],
): string => {
  const unique = new Map<string, string>();
  decisions.forEach((decision) => {
    validatePersistedAlertQualityTrendAwareDecision(decision);
    const key = identity(decision);
    const material = canonicalJsonStringify(decision);
    const existing = unique.get(key);
    if (existing !== undefined && existing !== material) {
      throw new Error(`Conflicting duplicate trend-aware decision: ${key}`);
    }
    unique.set(key, material);
  });
  const body = [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, material]) => material)
    .join('\n');
  return body.length > 0 ? `${body}\n` : '';
};

export const writeAlertQualityTrendAwareDecisions = async (
  filePath: string,
  decisions: readonly PersistedAlertQualityTrendAwareDecision[],
): Promise<void> => {
  await writeFile(filePath, serializeAlertQualityTrendAwareDecisions(decisions), 'utf8');
};

export const readAlertQualityTrendAwareDecisionsFromText = (
  text: string,
): AlertQualityTrendAwareDecisionReadResult => {
  const values = new Map<
    string,
    { material: string; decision: PersistedAlertQualityTrendAwareDecision }
  >();
  const issues: AlertQualityTrendAwareDecisionReadIssue[] = [];
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
    if (
      isRecord(parsed) &&
      parsed.schemaVersion !== ALERT_QUALITY_TREND_AWARE_DECISION_SCHEMA_VERSION
    ) {
      issues.push({
        lineNumber: index + 1,
        reason: 'UNSUPPORTED_SCHEMA_VERSION',
        message: `Unsupported schema version: ${String(parsed.schemaVersion)}`,
      });
      return;
    }
    try {
      validatePersistedAlertQualityTrendAwareDecision(parsed);
      const decision = parsed as PersistedAlertQualityTrendAwareDecision;
      const key = identity(decision);
      const material = canonicalJsonStringify(decision);
      const existing = values.get(key);
      if (existing) {
        if (existing.material !== material) {
          throw new Error(`Conflicting duplicate trend-aware decision: ${key}`);
        }
        exactDuplicateCount += 1;
        return;
      }
      values.set(key, { material, decision });
    } catch (error) {
      issues.push({
        lineNumber: index + 1,
        reason: 'INVALID_DECISION',
        message: error instanceof Error ? error.message : 'Invalid trend-aware decision',
      });
    }
  });

  return {
    decisions: Object.freeze(
      [...values.values()]
        .sort((left, right) => identity(left.decision).localeCompare(identity(right.decision)))
        .map(({ decision }) => decision),
    ),
    exactDuplicateCount,
    issues: Object.freeze(issues),
  };
};

export const readAlertQualityTrendAwareDecisions = async (
  filePath: string,
): Promise<AlertQualityTrendAwareDecisionReadResult> =>
  readAlertQualityTrendAwareDecisionsFromText(await readFile(filePath, 'utf8'));
