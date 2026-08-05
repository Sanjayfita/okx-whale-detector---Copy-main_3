import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from './canonicalJson';
import {
  createAlertQualityThresholdPolicy,
  type AlertQualityThresholdEvaluation,
  type AlertQualityThresholdPolicy,
  type AlertQualityThresholdReport,
} from './alertQualityThresholdPolicy';

export const ALERT_QUALITY_THRESHOLD_EVALUATION_SCHEMA_VERSION = 1 as const;
export const ALERT_QUALITY_THRESHOLD_EVALUATOR_VERSION =
  'alert-quality-threshold-evaluator-v1' as const;

export interface PersistedAlertQualityThresholdEvaluation {
  schemaVersion: typeof ALERT_QUALITY_THRESHOLD_EVALUATION_SCHEMA_VERSION;
  evaluatorVersion: typeof ALERT_QUALITY_THRESHOLD_EVALUATOR_VERSION;
  evaluationRunId: string;
  generatedAt: number;
  sourceReportRunId: string;
  sourceReportGeneratedAt: number;
  policyFingerprint: string;
  policy: Readonly<AlertQualityThresholdPolicy>;
  evaluations: readonly AlertQualityThresholdEvaluation[];
  passedCount: number;
  failedCount: number;
  insufficientDataCount: number;
}

export interface AlertQualityThresholdEvaluationReadIssue {
  lineNumber: number;
  reason: 'MALFORMED_JSON' | 'INVALID_EVALUATION' | 'UNSUPPORTED_SCHEMA_VERSION';
  message: string;
}

export interface AlertQualityThresholdEvaluationReadResult {
  evaluations: readonly PersistedAlertQualityThresholdEvaluation[];
  exactDuplicateCount: number;
  issues: readonly AlertQualityThresholdEvaluationReadIssue[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const STATUSES = new Set(['PASS', 'FAIL', 'INSUFFICIENT_DATA']);
const REASONS = new Set([
  'MINIMUM_SAMPLE_COUNT',
  'MINIMUM_ELIGIBLE_RATE',
  'MINIMUM_WIN_RATE',
  'MINIMUM_EXPECTANCY',
  'MAXIMUM_AMBIGUITY_RATE',
  'UNAVAILABLE_REQUIRED_METRIC',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertSafeInteger = (name: string, value: unknown): void => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

export const createAlertQualityThresholdPolicyFingerprint = (
  policy: AlertQualityThresholdPolicy,
): string => canonicalJsonStringify(createAlertQualityThresholdPolicy(policy));

export const createPersistedAlertQualityThresholdEvaluation = (input: {
  thresholdReport: AlertQualityThresholdReport;
  evaluationRunId: string;
  generatedAt: number;
}): PersistedAlertQualityThresholdEvaluation => {
  if (!IDENTIFIER_PATTERN.test(input.evaluationRunId)) {
    throw new Error('evaluationRunId must be a valid durable identifier');
  }
  assertSafeInteger('generatedAt', input.generatedAt);
  return Object.freeze({
    schemaVersion: ALERT_QUALITY_THRESHOLD_EVALUATION_SCHEMA_VERSION,
    evaluatorVersion: ALERT_QUALITY_THRESHOLD_EVALUATOR_VERSION,
    evaluationRunId: input.evaluationRunId,
    generatedAt: input.generatedAt,
    sourceReportRunId: input.thresholdReport.reportRunId,
    sourceReportGeneratedAt: input.thresholdReport.generatedAt,
    policyFingerprint: createAlertQualityThresholdPolicyFingerprint(input.thresholdReport.policy),
    policy: Object.freeze({ ...input.thresholdReport.policy }),
    evaluations: Object.freeze([...input.thresholdReport.evaluations]),
    passedCount: input.thresholdReport.passedCount,
    failedCount: input.thresholdReport.failedCount,
    insufficientDataCount: input.thresholdReport.insufficientDataCount,
  });
};

export const validatePersistedAlertQualityThresholdEvaluation = (
  value: unknown,
): value is PersistedAlertQualityThresholdEvaluation => {
  if (!isRecord(value)) throw new Error('Threshold evaluation must be an object');
  if (value.schemaVersion !== ALERT_QUALITY_THRESHOLD_EVALUATION_SCHEMA_VERSION) {
    throw new Error('Unsupported threshold evaluation schema version');
  }
  if (value.evaluatorVersion !== ALERT_QUALITY_THRESHOLD_EVALUATOR_VERSION) {
    throw new Error('Unsupported threshold evaluator version');
  }
  if (typeof value.evaluationRunId !== 'string' || !IDENTIFIER_PATTERN.test(value.evaluationRunId)) {
    throw new Error('evaluationRunId must be a valid durable identifier');
  }
  if (typeof value.sourceReportRunId !== 'string' || !IDENTIFIER_PATTERN.test(value.sourceReportRunId)) {
    throw new Error('sourceReportRunId must be a valid durable identifier');
  }
  assertSafeInteger('generatedAt', value.generatedAt);
  assertSafeInteger('sourceReportGeneratedAt', value.sourceReportGeneratedAt);
  if (!isRecord(value.policy)) throw new Error('policy must be an object');
  const policy = createAlertQualityThresholdPolicy(value.policy as Partial<AlertQualityThresholdPolicy>);
  if (value.policyFingerprint !== createAlertQualityThresholdPolicyFingerprint(policy)) {
    throw new Error('policyFingerprint does not match policy');
  }
  if (!Array.isArray(value.evaluations)) throw new Error('evaluations must be an array');
  value.evaluations.forEach((evaluation, index) => {
    if (!isRecord(evaluation)) throw new Error(`evaluations[${index}] must be an object`);
    if (typeof evaluation.groupKey !== 'string') throw new Error(`evaluations[${index}].groupKey must be a string`);
    if (!STATUSES.has(String(evaluation.status))) throw new Error(`evaluations[${index}].status is invalid`);
    if (!Array.isArray(evaluation.reasons) || evaluation.reasons.some((reason) => !REASONS.has(String(reason)))) {
      throw new Error(`evaluations[${index}].reasons contains an invalid reason`);
    }
    if (!isRecord(evaluation.observation)) {
      throw new Error(`evaluations[${index}].observation must be an object`);
    }
  });
  assertSafeInteger('passedCount', value.passedCount);
  assertSafeInteger('failedCount', value.failedCount);
  assertSafeInteger('insufficientDataCount', value.insufficientDataCount);
  const evaluations = value.evaluations as unknown as AlertQualityThresholdEvaluation[];
  const count = (status: string): number => evaluations.filter((item) => item.status === status).length;
  if (value.passedCount !== count('PASS')) throw new Error('passedCount does not match evaluations');
  if (value.failedCount !== count('FAIL')) throw new Error('failedCount does not match evaluations');
  if (value.insufficientDataCount !== count('INSUFFICIENT_DATA')) {
    throw new Error('insufficientDataCount does not match evaluations');
  }
  return true;
};

const identity = (evaluation: PersistedAlertQualityThresholdEvaluation): string =>
  canonicalJsonStringify({
    evaluationRunId: evaluation.evaluationRunId,
    generatedAt: evaluation.generatedAt,
  });

export const serializeAlertQualityThresholdEvaluations = (
  evaluations: readonly PersistedAlertQualityThresholdEvaluation[],
): string => {
  const unique = new Map<string, string>();
  evaluations.forEach((evaluation) => {
    validatePersistedAlertQualityThresholdEvaluation(evaluation);
    const key = identity(evaluation);
    const material = canonicalJsonStringify(evaluation);
    const existing = unique.get(key);
    if (existing !== undefined && existing !== material) {
      throw new Error(`Conflicting duplicate threshold evaluation: ${key}`);
    }
    unique.set(key, material);
  });
  const body = [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, material]) => material)
    .join('\n');
  return body.length > 0 ? `${body}\n` : '';
};

export const writeAlertQualityThresholdEvaluations = async (
  filePath: string,
  evaluations: readonly PersistedAlertQualityThresholdEvaluation[],
): Promise<void> => {
  await writeFile(filePath, serializeAlertQualityThresholdEvaluations(evaluations), 'utf8');
};

export const readAlertQualityThresholdEvaluationsFromText = (
  text: string,
): AlertQualityThresholdEvaluationReadResult => {
  const values = new Map<string, { material: string; evaluation: PersistedAlertQualityThresholdEvaluation }>();
  const issues: AlertQualityThresholdEvaluationReadIssue[] = [];
  let exactDuplicateCount = 0;
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      issues.push({ lineNumber: index + 1, reason: 'MALFORMED_JSON', message: error instanceof Error ? error.message : 'Malformed JSON' });
      return;
    }
    if (isRecord(parsed) && parsed.schemaVersion !== ALERT_QUALITY_THRESHOLD_EVALUATION_SCHEMA_VERSION) {
      issues.push({ lineNumber: index + 1, reason: 'UNSUPPORTED_SCHEMA_VERSION', message: `Unsupported schema version: ${String(parsed.schemaVersion)}` });
      return;
    }
    try {
      validatePersistedAlertQualityThresholdEvaluation(parsed);
      const evaluation = parsed as PersistedAlertQualityThresholdEvaluation;
      const key = identity(evaluation);
      const material = canonicalJsonStringify(evaluation);
      const existing = values.get(key);
      if (existing) {
        if (existing.material !== material) throw new Error(`Conflicting duplicate threshold evaluation: ${key}`);
        exactDuplicateCount += 1;
        return;
      }
      values.set(key, { material, evaluation });
    } catch (error) {
      issues.push({ lineNumber: index + 1, reason: 'INVALID_EVALUATION', message: error instanceof Error ? error.message : 'Invalid threshold evaluation' });
    }
  });
  return {
    evaluations: Object.freeze([...values.values()].sort((left, right) => identity(left.evaluation).localeCompare(identity(right.evaluation))).map(({ evaluation }) => evaluation)),
    exactDuplicateCount,
    issues: Object.freeze(issues),
  };
};

export const readAlertQualityThresholdEvaluations = async (
  filePath: string,
): Promise<AlertQualityThresholdEvaluationReadResult> =>
  readAlertQualityThresholdEvaluationsFromText(await readFile(filePath, 'utf8'));
