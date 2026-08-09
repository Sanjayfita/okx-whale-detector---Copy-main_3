import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import type { PaperPortfolioSnapshot } from './paperPortfolio';
import type { PaperPortfolioValuation } from './paperPortfolioValuation';
import type { PaperRiskAssessment } from './paperRiskControls';

export const PAPER_TRADING_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const PAPER_TRADING_DOCUMENT_GENERATOR_VERSION = 'paper-trading-document-v1' as const;

export interface PaperTradingDocument {
  schemaVersion: typeof PAPER_TRADING_DOCUMENT_SCHEMA_VERSION;
  generatorVersion: typeof PAPER_TRADING_DOCUMENT_GENERATOR_VERSION;
  portfolio: PaperPortfolioSnapshot;
  valuation: PaperPortfolioValuation;
  risk: PaperRiskAssessment;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertFinite = (name: string, value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
};

const assertTimestamp = (name: string, value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value as number;
};

const validateDocumentRelationships = (document: PaperTradingDocument): void => {
  const { portfolio, valuation, risk } = document;
  if (portfolio.generatedAt > valuation.generatedAt) {
    throw new Error('Portfolio snapshot cannot be newer than valuation');
  }
  if (valuation.generatedAt !== risk.generatedAt) {
    throw new Error('Valuation and risk timestamps must match');
  }
  if (valuation.cash !== portfolio.cash) {
    throw new Error('Valuation cash must match portfolio cash');
  }
  if (valuation.realizedPnl !== portfolio.realizedPnl) {
    throw new Error('Valuation realized PnL must match portfolio realized PnL');
  }
  if (valuation.feesPaid !== portfolio.feesPaid) {
    throw new Error('Valuation fees must match portfolio fees');
  }
  if (risk.equity !== valuation.equity) {
    throw new Error('Risk equity must match valuation equity');
  }
};

export const validatePaperTradingDocument = (
  value: unknown,
): value is PaperTradingDocument => {
  if (!isRecord(value)) throw new Error('Paper trading document must be an object');
  if (value.schemaVersion !== PAPER_TRADING_DOCUMENT_SCHEMA_VERSION) {
    throw new Error('Unsupported paper trading document schema version');
  }
  if (value.generatorVersion !== PAPER_TRADING_DOCUMENT_GENERATOR_VERSION) {
    throw new Error('Unsupported paper trading document generator version');
  }
  if (!isRecord(value.portfolio)) throw new Error('portfolio must be an object');
  if (!isRecord(value.valuation)) throw new Error('valuation must be an object');
  if (!isRecord(value.risk)) throw new Error('risk must be an object');

  assertTimestamp('portfolio.generatedAt', value.portfolio.generatedAt);
  assertTimestamp('valuation.generatedAt', value.valuation.generatedAt);
  assertTimestamp('risk.generatedAt', value.risk.generatedAt);
  assertFinite('portfolio.cash', value.portfolio.cash);
  assertFinite('portfolio.realizedPnl', value.portfolio.realizedPnl);
  assertFinite('portfolio.feesPaid', value.portfolio.feesPaid);
  assertFinite('valuation.cash', value.valuation.cash);
  assertFinite('valuation.equity', value.valuation.equity);
  assertFinite('valuation.realizedPnl', value.valuation.realizedPnl);
  assertFinite('valuation.feesPaid', value.valuation.feesPaid);
  assertFinite('risk.equity', value.risk.equity);

  if (!Array.isArray(value.portfolio.fills)) throw new Error('portfolio.fills must be an array');
  if (!Array.isArray(value.portfolio.positions)) throw new Error('portfolio.positions must be an array');
  if (!Array.isArray(value.valuation.positions)) throw new Error('valuation.positions must be an array');
  if (!Array.isArray(value.risk.reasons) || value.risk.reasons.some((item) => typeof item !== 'string')) {
    throw new Error('risk.reasons must be an array of strings');
  }
  if (value.risk.status !== 'ALLOWED' && value.risk.status !== 'WARNING' && value.risk.status !== 'BLOCKED') {
    throw new Error('risk.status is invalid');
  }

  validateDocumentRelationships(value as unknown as PaperTradingDocument);
  return true;
};

export const createPaperTradingDocument = (input: {
  portfolio: PaperPortfolioSnapshot;
  valuation: PaperPortfolioValuation;
  risk: PaperRiskAssessment;
}): PaperTradingDocument => {
  const document: PaperTradingDocument = Object.freeze({
    schemaVersion: PAPER_TRADING_DOCUMENT_SCHEMA_VERSION,
    generatorVersion: PAPER_TRADING_DOCUMENT_GENERATOR_VERSION,
    portfolio: input.portfolio,
    valuation: input.valuation,
    risk: input.risk,
  });
  validatePaperTradingDocument(document);
  return document;
};

export const serializePaperTradingDocument = (document: PaperTradingDocument): string => {
  validatePaperTradingDocument(document);
  return `${canonicalJsonStringify(document)}\n`;
};

export const readPaperTradingDocumentFromText = (text: string): PaperTradingDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `Malformed paper trading document JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  validatePaperTradingDocument(parsed);
  return parsed as PaperTradingDocument;
};

export const writePaperTradingDocument = async (
  filePath: string,
  document: PaperTradingDocument,
): Promise<void> => {
  await writeFile(filePath, serializePaperTradingDocument(document), 'utf8');
};

export const readPaperTradingDocument = async (filePath: string): Promise<PaperTradingDocument> =>
  readPaperTradingDocumentFromText(await readFile(filePath, 'utf8'));
