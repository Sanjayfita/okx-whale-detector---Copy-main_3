import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type {
  TestnetOrderIntent,
  TestnetOrderIntentStatus,
  TestnetOrderSide,
  TestnetOrderType,
} from './testnetOrderIntent';

export const TESTNET_ORDER_INTENT_SCHEMA_VERSION = 1 as const;
export const TESTNET_ORDER_INTENT_GENERATOR_VERSION =
  'testnet-order-intent-v1' as const;

export interface TestnetOrderIntentDocument {
  schemaVersion: typeof TESTNET_ORDER_INTENT_SCHEMA_VERSION;
  generatorVersion: typeof TESTNET_ORDER_INTENT_GENERATOR_VERSION;
  generatedAt: number;
  intent: TestnetOrderIntent;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireSafeInteger = (value: unknown, name: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as number;
};

const requirePositiveFinite = (value: unknown, name: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
  return value;
};

const validateIntent = (value: unknown): TestnetOrderIntent => {
  if (!isRecord(value)) throw new Error('intent must be an object');

  const status = value.status as TestnetOrderIntentStatus;
  if (!['REJECTED', 'PREPARED_FOR_DRY_RUN'].includes(status)) {
    throw new Error('intent.status is invalid');
  }
  if (value.environment !== 'TESTNET') {
    throw new Error('intent.environment must remain TESTNET');
  }
  if (typeof value.instrumentId !== 'string' || value.instrumentId.trim() === '') {
    throw new Error('intent.instrumentId must not be empty');
  }

  const side = value.side as TestnetOrderSide;
  if (!['BUY', 'SELL'].includes(side)) throw new Error('intent.side is invalid');
  const orderType = value.orderType as TestnetOrderType;
  if (!['MARKET', 'LIMIT'].includes(orderType)) {
    throw new Error('intent.orderType is invalid');
  }

  const quantity = requirePositiveFinite(value.quantity, 'intent.quantity');
  const referencePrice = requirePositiveFinite(
    value.referencePrice,
    'intent.referencePrice',
  );
  const limitPrice =
    value.limitPrice === null
      ? null
      : requirePositiveFinite(value.limitPrice, 'intent.limitPrice');
  if (orderType === 'LIMIT' && limitPrice === null) {
    throw new Error('intent.limitPrice is required for LIMIT orders');
  }
  if (orderType === 'MARKET' && limitPrice !== null) {
    throw new Error('intent.limitPrice must be null for MARKET orders');
  }

  const estimatedNotional = requirePositiveFinite(
    value.estimatedNotional,
    'intent.estimatedNotional',
  );
  const maximumNotional = requirePositiveFinite(
    value.maximumNotional,
    'intent.maximumNotional',
  );
  const expectedNotional = quantity * (limitPrice ?? referencePrice);
  if (estimatedNotional !== expectedNotional) {
    throw new Error('intent.estimatedNotional is inconsistent');
  }
  if (!Array.isArray(value.reasons) || value.reasons.some((item) => typeof item !== 'string')) {
    throw new Error('intent.reasons must be an array of strings');
  }
  if (
    value.dryRunOnly !== true ||
    value.transportDispatchAllowed !== false ||
    value.testnetExecutionAuthorized !== false ||
    value.orderExecutionAuthorized !== false
  ) {
    throw new Error('intent execution safeguards are invalid');
  }

  return Object.freeze({
    status,
    environment: 'TESTNET',
    instrumentId: value.instrumentId.trim(),
    side,
    orderType,
    quantity,
    referencePrice,
    limitPrice,
    estimatedNotional,
    maximumNotional,
    createdAt: requireSafeInteger(value.createdAt, 'intent.createdAt'),
    reasons: Object.freeze([...(value.reasons as string[])]),
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};

export const createTestnetOrderIntentDocument = (input: {
  generatedAt: number;
  intent: TestnetOrderIntent;
}): TestnetOrderIntentDocument => {
  const generatedAt = requireSafeInteger(input.generatedAt, 'generatedAt');
  const intent = validateIntent(input.intent);
  if (intent.createdAt > generatedAt) {
    throw new Error('intent.createdAt cannot be newer than document generatedAt');
  }

  return Object.freeze({
    schemaVersion: TESTNET_ORDER_INTENT_SCHEMA_VERSION,
    generatorVersion: TESTNET_ORDER_INTENT_GENERATOR_VERSION,
    generatedAt,
    intent,
  });
};

export const validateTestnetOrderIntentDocument = (
  value: unknown,
): value is TestnetOrderIntentDocument => {
  if (!isRecord(value)) throw new Error('Testnet order intent document must be an object');
  if (value.schemaVersion !== TESTNET_ORDER_INTENT_SCHEMA_VERSION) {
    throw new Error('Unsupported testnet order intent schema version');
  }
  if (value.generatorVersion !== TESTNET_ORDER_INTENT_GENERATOR_VERSION) {
    throw new Error('Unsupported testnet order intent generator version');
  }

  const generatedAt = requireSafeInteger(value.generatedAt, 'generatedAt');
  const intent = validateIntent(value.intent);
  if (intent.createdAt > generatedAt) {
    throw new Error('intent.createdAt cannot be newer than document generatedAt');
  }
  return true;
};

export const serializeTestnetOrderIntentDocument = (
  document: TestnetOrderIntentDocument,
): string => {
  validateTestnetOrderIntentDocument(document);
  return `${canonicalJsonStringify(document)}\n`;
};

export const readTestnetOrderIntentDocumentFromText = (
  text: string,
): TestnetOrderIntentDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `Malformed testnet order intent JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  validateTestnetOrderIntentDocument(parsed);
  return parsed as TestnetOrderIntentDocument;
};

export const writeTestnetOrderIntentDocument = async (
  filePath: string,
  document: TestnetOrderIntentDocument,
): Promise<void> => {
  await writeFile(filePath, serializeTestnetOrderIntentDocument(document), 'utf8');
};

export const readTestnetOrderIntentDocument = async (
  filePath: string,
): Promise<TestnetOrderIntentDocument> =>
  readTestnetOrderIntentDocumentFromText(await readFile(filePath, 'utf8'));
