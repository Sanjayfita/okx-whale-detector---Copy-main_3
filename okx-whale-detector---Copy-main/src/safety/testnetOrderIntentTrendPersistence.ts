import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type {
  TestnetOrderIntentTrendDirection,
  TestnetOrderIntentTrendPoint,
  TestnetOrderIntentTrendSummary,
} from './testnetOrderIntentTrend';

export const TESTNET_ORDER_INTENT_TREND_SCHEMA_VERSION = 1 as const;
export const TESTNET_ORDER_INTENT_TREND_GENERATOR_VERSION =
  'testnet-order-intent-trend-v1' as const;

export interface TestnetOrderIntentTrendDocument {
  schemaVersion: typeof TESTNET_ORDER_INTENT_TREND_SCHEMA_VERSION;
  generatorVersion: typeof TESTNET_ORDER_INTENT_TREND_GENERATOR_VERSION;
  generatedAt: number;
  trend: TestnetOrderIntentTrendSummary;
}

const DIRECTIONS: readonly TestnetOrderIntentTrendDirection[] = Object.freeze([
  'DECREASING_RISK',
  'STABLE',
  'INCREASING_RISK',
]);

const STATUSES = Object.freeze(['REJECTED', 'PREPARED_FOR_DRY_RUN'] as const);
const SIDES = Object.freeze(['BUY', 'SELL'] as const);
const ORDER_TYPES = Object.freeze(['MARKET', 'LIMIT'] as const);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireSafeInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as number;
};

const requireFiniteNumber = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
};

const requirePositiveFinite = (value: unknown, name: string): number => {
  const number = requireFiniteNumber(value, name);
  if (number <= 0) throw new Error(`${name} must be positive`);
  return number;
};

const validatePoint = (value: unknown, index: number): TestnetOrderIntentTrendPoint => {
  if (!isRecord(value)) throw new Error(`trend.points[${index}] must be an object`);
  const status = value.status;
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error(`trend.points[${index}].status is invalid`);
  }

  return Object.freeze({
    generatedAt: requireSafeInteger(value.generatedAt, `trend.points[${index}].generatedAt`),
    status: status as TestnetOrderIntentTrendPoint['status'],
    estimatedNotional: requirePositiveFinite(
      value.estimatedNotional,
      `trend.points[${index}].estimatedNotional`,
    ),
    maximumNotional: requirePositiveFinite(
      value.maximumNotional,
      `trend.points[${index}].maximumNotional`,
    ),
    quantity: requirePositiveFinite(value.quantity, `trend.points[${index}].quantity`),
    referencePrice: requirePositiveFinite(
      value.referencePrice,
      `trend.points[${index}].referencePrice`,
    ),
  });
};

const validateTrend = (value: unknown): TestnetOrderIntentTrendSummary => {
  if (!isRecord(value)) throw new Error('trend must be an object');
  if (!DIRECTIONS.includes(value.direction as TestnetOrderIntentTrendDirection)) {
    throw new Error('trend.direction is invalid');
  }
  if (typeof value.instrumentId !== 'string' || value.instrumentId.trim() === '') {
    throw new Error('trend.instrumentId must not be empty');
  }
  if (!SIDES.includes(value.side as (typeof SIDES)[number])) {
    throw new Error('trend.side is invalid');
  }
  if (!ORDER_TYPES.includes(value.orderType as (typeof ORDER_TYPES)[number])) {
    throw new Error('trend.orderType is invalid');
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
  const estimatedNotionalChange = requireFiniteNumber(
    value.estimatedNotionalChange,
    'trend.estimatedNotionalChange',
  );
  const maximumNotionalChange = requireFiniteNumber(
    value.maximumNotionalChange,
    'trend.maximumNotionalChange',
  );
  if (estimatedNotionalChange !== last.estimatedNotional - first.estimatedNotional) {
    throw new Error('trend.estimatedNotionalChange is inconsistent');
  }
  if (maximumNotionalChange !== last.maximumNotional - first.maximumNotional) {
    throw new Error('trend.maximumNotionalChange is inconsistent');
  }

  const highestEstimatedNotional = requirePositiveFinite(
    value.highestEstimatedNotional,
    'trend.highestEstimatedNotional',
  );
  const lowestEstimatedNotional = requirePositiveFinite(
    value.lowestEstimatedNotional,
    'trend.lowestEstimatedNotional',
  );
  if (highestEstimatedNotional !== Math.max(...points.map((point) => point.estimatedNotional))) {
    throw new Error('trend.highestEstimatedNotional is inconsistent');
  }
  if (lowestEstimatedNotional !== Math.min(...points.map((point) => point.estimatedNotional))) {
    throw new Error('trend.lowestEstimatedNotional is inconsistent');
  }
  if (!Array.isArray(value.reasons) || value.reasons.some((item) => typeof item !== 'string')) {
    throw new Error('trend.reasons must be an array of strings');
  }
  if (
    value.dryRunOnly !== true ||
    value.transportDispatchAllowed !== false ||
    value.testnetExecutionAuthorized !== false ||
    value.orderExecutionAuthorized !== false
  ) {
    throw new Error('trend execution safeguards are invalid');
  }

  return Object.freeze({
    instrumentId: value.instrumentId.trim(),
    side: value.side as TestnetOrderIntentTrendSummary['side'],
    orderType: value.orderType as TestnetOrderIntentTrendSummary['orderType'],
    direction: value.direction as TestnetOrderIntentTrendDirection,
    points: Object.freeze(points),
    estimatedNotionalChange,
    maximumNotionalChange,
    riskIncreases: requireSafeInteger(value.riskIncreases, 'trend.riskIncreases'),
    riskReductions: requireSafeInteger(value.riskReductions, 'trend.riskReductions'),
    highestEstimatedNotional,
    lowestEstimatedNotional,
    reasons: Object.freeze([...(value.reasons as string[])]),
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};

export const createTestnetOrderIntentTrendDocument = (input: {
  generatedAt: number;
  trend: TestnetOrderIntentTrendSummary;
}): TestnetOrderIntentTrendDocument => {
  const generatedAt = requireSafeInteger(input.generatedAt, 'generatedAt');
  const trend = validateTrend(input.trend);
  if (trend.points[trend.points.length - 1]!.generatedAt > generatedAt) {
    throw new Error('Latest trend point cannot be newer than document generatedAt');
  }

  return Object.freeze({
    schemaVersion: TESTNET_ORDER_INTENT_TREND_SCHEMA_VERSION,
    generatorVersion: TESTNET_ORDER_INTENT_TREND_GENERATOR_VERSION,
    generatedAt,
    trend,
  });
};

export const validateTestnetOrderIntentTrendDocument = (
  value: unknown,
): value is TestnetOrderIntentTrendDocument => {
  if (!isRecord(value)) throw new Error('Testnet order intent trend document must be an object');
  if (value.schemaVersion !== TESTNET_ORDER_INTENT_TREND_SCHEMA_VERSION) {
    throw new Error('Unsupported testnet order intent trend schema version');
  }
  if (value.generatorVersion !== TESTNET_ORDER_INTENT_TREND_GENERATOR_VERSION) {
    throw new Error('Unsupported testnet order intent trend generator version');
  }
  const generatedAt = requireSafeInteger(value.generatedAt, 'generatedAt');
  const trend = validateTrend(value.trend);
  if (trend.points[trend.points.length - 1]!.generatedAt > generatedAt) {
    throw new Error('Latest trend point cannot be newer than document generatedAt');
  }
  return true;
};

export const serializeTestnetOrderIntentTrendDocument = (
  document: TestnetOrderIntentTrendDocument,
): string => {
  validateTestnetOrderIntentTrendDocument(document);
  return `${canonicalJsonStringify(document)}\n`;
};

export const readTestnetOrderIntentTrendDocumentFromText = (
  text: string,
): TestnetOrderIntentTrendDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `Malformed testnet order intent trend JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  validateTestnetOrderIntentTrendDocument(parsed);
  return parsed as TestnetOrderIntentTrendDocument;
};

export const writeTestnetOrderIntentTrendDocument = async (
  filePath: string,
  document: TestnetOrderIntentTrendDocument,
): Promise<void> => {
  await writeFile(filePath, serializeTestnetOrderIntentTrendDocument(document), 'utf8');
};

export const readTestnetOrderIntentTrendDocument = async (
  filePath: string,
): Promise<TestnetOrderIntentTrendDocument> =>
  readTestnetOrderIntentTrendDocumentFromText(await readFile(filePath, 'utf8'));
