import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type {
  PaperTradingTrendDirection,
  PaperTradingTrendPoint,
  PaperTradingTrendSummary,
} from './paperTradingTrend';

export const PAPER_TRADING_TREND_SCHEMA_VERSION = 1 as const;
export const PAPER_TRADING_TREND_GENERATOR_VERSION =
  'paper-trading-trend-document-v1' as const;

export interface PaperTradingTrendDocument {
  schemaVersion: typeof PAPER_TRADING_TREND_SCHEMA_VERSION;
  generatorVersion: typeof PAPER_TRADING_TREND_GENERATOR_VERSION;
  summary: PaperTradingTrendSummary;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertFinite = (name: string, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
};

const assertNonNegativeInteger = (name: string, value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as number;
};

const isDirection = (value: unknown): value is PaperTradingTrendDirection =>
  value === 'IMPROVING' || value === 'STABLE' || value === 'DETERIORATING';

const validatePoint = (value: unknown, index: number): PaperTradingTrendPoint => {
  if (!isRecord(value)) throw new Error(`summary.points[${index}] must be an object`);
  const riskStatus = value.riskStatus;
  if (riskStatus !== 'ALLOWED' && riskStatus !== 'WARNING' && riskStatus !== 'BLOCKED') {
    throw new Error(`summary.points[${index}].riskStatus is invalid`);
  }
  return Object.freeze({
    generatedAt: assertNonNegativeInteger(
      `summary.points[${index}].generatedAt`,
      value.generatedAt,
    ),
    equity: assertFinite(`summary.points[${index}].equity`, value.equity),
    realizedPnl: assertFinite(`summary.points[${index}].realizedPnl`, value.realizedPnl),
    unrealizedPnl: assertFinite(
      `summary.points[${index}].unrealizedPnl`,
      value.unrealizedPnl,
    ),
    drawdownPercent: assertFinite(
      `summary.points[${index}].drawdownPercent`,
      value.drawdownPercent,
    ),
    riskStatus,
  });
};

const validateSummary = (value: unknown): PaperTradingTrendSummary => {
  if (!isRecord(value)) throw new Error('summary must be an object');
  if (!isDirection(value.direction)) throw new Error('summary.direction is invalid');
  if (!Array.isArray(value.points) || value.points.length < 2) {
    throw new Error('summary.points must contain at least two points');
  }

  const points = value.points.map(validatePoint);
  for (let index = 1; index < points.length; index += 1) {
    if (points[index]!.generatedAt <= points[index - 1]!.generatedAt) {
      throw new Error('summary.points must be strictly chronological');
    }
  }

  if (!Array.isArray(value.reasons) || value.reasons.some((reason) => typeof reason !== 'string')) {
    throw new Error('summary.reasons must be an array of strings');
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const equityChange = assertFinite('summary.equityChange', value.equityChange);
  const drawdownPercentChange = assertFinite(
    'summary.drawdownPercentChange',
    value.drawdownPercentChange,
  );
  if (equityChange !== last.equity - first.equity) {
    throw new Error('summary.equityChange is inconsistent');
  }
  if (drawdownPercentChange !== last.drawdownPercent - first.drawdownPercent) {
    throw new Error('summary.drawdownPercentChange is inconsistent');
  }

  return Object.freeze({
    direction: value.direction,
    points: Object.freeze(points),
    equityChange,
    realizedPnlChange: assertFinite('summary.realizedPnlChange', value.realizedPnlChange),
    unrealizedPnlChange: assertFinite(
      'summary.unrealizedPnlChange',
      value.unrealizedPnlChange,
    ),
    drawdownPercentChange,
    bestEquity: assertFinite('summary.bestEquity', value.bestEquity),
    worstEquity: assertFinite('summary.worstEquity', value.worstEquity),
    maximumDrawdownPercent: assertFinite(
      'summary.maximumDrawdownPercent',
      value.maximumDrawdownPercent,
    ),
    riskEscalations: assertNonNegativeInteger(
      'summary.riskEscalations',
      value.riskEscalations,
    ),
    riskImprovements: assertNonNegativeInteger(
      'summary.riskImprovements',
      value.riskImprovements,
    ),
    reasons: Object.freeze([...value.reasons]),
  });
};

export const createPaperTradingTrendDocument = (
  summary: PaperTradingTrendSummary,
): PaperTradingTrendDocument =>
  Object.freeze({
    schemaVersion: PAPER_TRADING_TREND_SCHEMA_VERSION,
    generatorVersion: PAPER_TRADING_TREND_GENERATOR_VERSION,
    summary: validateSummary(summary),
  });

export const validatePaperTradingTrendDocument = (
  value: unknown,
): value is PaperTradingTrendDocument => {
  if (!isRecord(value)) throw new Error('Paper trading trend document must be an object');
  if (value.schemaVersion !== PAPER_TRADING_TREND_SCHEMA_VERSION) {
    throw new Error('Unsupported paper trading trend schema version');
  }
  if (value.generatorVersion !== PAPER_TRADING_TREND_GENERATOR_VERSION) {
    throw new Error('Unsupported paper trading trend generator version');
  }
  validateSummary(value.summary);
  return true;
};

export const serializePaperTradingTrendDocument = (
  document: PaperTradingTrendDocument,
): string => {
  validatePaperTradingTrendDocument(document);
  return `${canonicalJsonStringify(document)}\n`;
};

export const readPaperTradingTrendDocumentFromText = (
  text: string,
): PaperTradingTrendDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `Malformed paper trading trend JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  validatePaperTradingTrendDocument(parsed);
  return parsed as PaperTradingTrendDocument;
};

export const writePaperTradingTrendDocument = async (
  filePath: string,
  document: PaperTradingTrendDocument,
): Promise<void> => {
  await writeFile(filePath, serializePaperTradingTrendDocument(document), 'utf8');
};

export const readPaperTradingTrendDocument = async (
  filePath: string,
): Promise<PaperTradingTrendDocument> =>
  readPaperTradingTrendDocumentFromText(await readFile(filePath, 'utf8'));
