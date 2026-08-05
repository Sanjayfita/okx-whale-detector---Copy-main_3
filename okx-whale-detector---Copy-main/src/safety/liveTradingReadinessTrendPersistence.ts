import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type {
  LiveTradingReadinessTrendDirection,
  LiveTradingReadinessTrendPoint,
  LiveTradingReadinessTrendSummary,
} from './liveTradingReadinessTrend';

export const LIVE_TRADING_READINESS_TREND_SCHEMA_VERSION = 1 as const;
export const LIVE_TRADING_READINESS_TREND_GENERATOR_VERSION =
  'live-trading-readiness-trend-v1' as const;

export interface LiveTradingReadinessTrendDocument {
  schemaVersion: typeof LIVE_TRADING_READINESS_TREND_SCHEMA_VERSION;
  generatorVersion: typeof LIVE_TRADING_READINESS_TREND_GENERATOR_VERSION;
  generatedAt: number;
  trend: LiveTradingReadinessTrendSummary;
}

const DIRECTIONS: readonly LiveTradingReadinessTrendDirection[] = Object.freeze([
  'IMPROVING',
  'STABLE',
  'DETERIORATING',
]);

const STATUSES = Object.freeze([
  'NOT_READY',
  'REVIEW_REQUIRED',
  'READY_FOR_MANUAL_REVIEW',
] as const);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireSafeInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as number;
};

const requireNumber = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
};

const validatePoint = (value: unknown, index: number): LiveTradingReadinessTrendPoint => {
  if (!isRecord(value)) throw new Error(`trend.points[${index}] must be an object`);
  const status = value.status;
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error(`trend.points[${index}].status is invalid`);
  }

  return Object.freeze({
    generatedAt: requireSafeInteger(value.generatedAt, `trend.points[${index}].generatedAt`),
    status: status as LiveTradingReadinessTrendPoint['status'],
    completedChecks: requireSafeInteger(
      value.completedChecks,
      `trend.points[${index}].completedChecks`,
    ),
    missingChecks: requireSafeInteger(value.missingChecks, `trend.points[${index}].missingChecks`),
  });
};

const validateTrend = (value: unknown): LiveTradingReadinessTrendSummary => {
  if (!isRecord(value)) throw new Error('trend must be an object');
  if (!DIRECTIONS.includes(value.direction as LiveTradingReadinessTrendDirection)) {
    throw new Error('trend.direction is invalid');
  }
  if (!Array.isArray(value.points) || value.points.length < 2) {
    throw new Error('trend.points must contain at least two points');
  }

  const points = value.points.map(validatePoint);
  for (let index = 1; index < points.length; index += 1) {
    if (points[index]!.generatedAt <= points[index - 1]!.generatedAt) {
      throw new Error('trend.points must be strictly chronological');
    }
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const completedChecksChange = requireNumber(
    value.completedChecksChange,
    'trend.completedChecksChange',
  );
  if (completedChecksChange !== last.completedChecks - first.completedChecks) {
    throw new Error('trend.completedChecksChange is inconsistent');
  }
  if (value.orderExecutionAuthorized !== false) {
    throw new Error('trend.orderExecutionAuthorized must remain false');
  }
  if (!Array.isArray(value.reasons) || value.reasons.some((item) => typeof item !== 'string')) {
    throw new Error('trend.reasons must be an array of strings');
  }

  return Object.freeze({
    direction: value.direction as LiveTradingReadinessTrendDirection,
    points: Object.freeze(points),
    completedChecksChange,
    readinessEscalations: requireSafeInteger(
      value.readinessEscalations,
      'trend.readinessEscalations',
    ),
    readinessRegressions: requireSafeInteger(
      value.readinessRegressions,
      'trend.readinessRegressions',
    ),
    bestCompletedChecks: requireSafeInteger(
      value.bestCompletedChecks,
      'trend.bestCompletedChecks',
    ),
    worstCompletedChecks: requireSafeInteger(
      value.worstCompletedChecks,
      'trend.worstCompletedChecks',
    ),
    reasons: Object.freeze([...(value.reasons as string[])]),
    orderExecutionAuthorized: false,
  });
};

export const createLiveTradingReadinessTrendDocument = (input: {
  generatedAt: number;
  trend: LiveTradingReadinessTrendSummary;
}): LiveTradingReadinessTrendDocument =>
  Object.freeze({
    schemaVersion: LIVE_TRADING_READINESS_TREND_SCHEMA_VERSION,
    generatorVersion: LIVE_TRADING_READINESS_TREND_GENERATOR_VERSION,
    generatedAt: requireSafeInteger(input.generatedAt, 'generatedAt'),
    trend: validateTrend(input.trend),
  });

export const validateLiveTradingReadinessTrendDocument = (
  value: unknown,
): value is LiveTradingReadinessTrendDocument => {
  if (!isRecord(value)) throw new Error('Readiness trend document must be an object');
  if (value.schemaVersion !== LIVE_TRADING_READINESS_TREND_SCHEMA_VERSION) {
    throw new Error('Unsupported readiness trend schema version');
  }
  if (value.generatorVersion !== LIVE_TRADING_READINESS_TREND_GENERATOR_VERSION) {
    throw new Error('Unsupported readiness trend generator version');
  }
  requireSafeInteger(value.generatedAt, 'generatedAt');
  validateTrend(value.trend);
  return true;
};

export const serializeLiveTradingReadinessTrendDocument = (
  document: LiveTradingReadinessTrendDocument,
): string => {
  validateLiveTradingReadinessTrendDocument(document);
  return `${canonicalJsonStringify(document)}\n`;
};

export const readLiveTradingReadinessTrendDocumentFromText = (
  text: string,
): LiveTradingReadinessTrendDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `Malformed readiness trend JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  validateLiveTradingReadinessTrendDocument(parsed);
  return parsed as LiveTradingReadinessTrendDocument;
};

export const writeLiveTradingReadinessTrendDocument = async (
  filePath: string,
  document: LiveTradingReadinessTrendDocument,
): Promise<void> => {
  await writeFile(filePath, serializeLiveTradingReadinessTrendDocument(document), 'utf8');
};

export const readLiveTradingReadinessTrendDocument = async (
  filePath: string,
): Promise<LiveTradingReadinessTrendDocument> =>
  readLiveTradingReadinessTrendDocumentFromText(await readFile(filePath, 'utf8'));
