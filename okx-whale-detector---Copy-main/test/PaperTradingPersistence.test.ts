import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPaperPortfolioSnapshot } from '../src/paperTrading/paperPortfolio';
import { valuePaperPortfolio } from '../src/paperTrading/paperPortfolioValuation';
import { assessPaperTradingRisk } from '../src/paperTrading/paperRiskControls';
import {
  createPaperTradingDocument,
  readPaperTradingDocument,
  readPaperTradingDocumentFromText,
  serializePaperTradingDocument,
  writePaperTradingDocument,
} from '../src/paperTrading/paperTradingPersistence';

const createDocument = () => {
  const portfolio = createPaperPortfolioSnapshot({
    generatedAt: 2,
    initialCash: 10_000,
    fills: [
      {
        fillId: 'fill-1',
        instrumentId: 'BTC-USDT',
        side: 'BUY',
        quantity: 1,
        price: 100,
        fee: 1,
        executedAt: 1,
      },
    ],
  });
  const valuation = valuePaperPortfolio({
    generatedAt: 3,
    portfolio,
    marks: [{ instrumentId: 'BTC-USDT', price: 110, observedAt: 3 }],
  });
  const risk = assessPaperTradingRisk({
    valuation,
    initialEquity: 10_000,
    limits: {
      maxGrossExposure: 1_000,
      maxAbsoluteNetExposure: 1_000,
      maxPositionExposure: 1_000,
      maxDrawdownPercent: 20,
      warningThresholdPercent: 80,
    },
  });
  return createPaperTradingDocument({ portfolio, valuation, risk });
};

describe('paper trading persistence', () => {
  it('serializes deterministically and reloads from text', () => {
    const document = createDocument();
    const first = serializePaperTradingDocument(document);
    const second = serializePaperTradingDocument(document);

    expect(first).toBe(second);
    expect(readPaperTradingDocumentFromText(first)).toEqual(document);
  });

  it('writes and reads a versioned document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paper-trading-persistence-'));
    const filePath = join(directory, 'paper-trading.json');
    try {
      const document = createDocument();
      await writePaperTradingDocument(filePath, document);
      expect(await readPaperTradingDocument(filePath)).toEqual(document);
      expect(await readFile(filePath, 'utf8')).toBe(serializePaperTradingDocument(document));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed, unsupported, and inconsistent documents', () => {
    expect(() => readPaperTradingDocumentFromText('{')).toThrow(/Malformed paper trading/);

    const document = createDocument();
    expect(() =>
      readPaperTradingDocumentFromText(
        JSON.stringify({ ...document, schemaVersion: 2 }),
      ),
    ).toThrow(/Unsupported paper trading document schema version/);

    expect(() =>
      readPaperTradingDocumentFromText(
        JSON.stringify({
          ...document,
          risk: { ...document.risk, equity: document.risk.equity + 1 },
        }),
      ),
    ).toThrow(/Risk equity must match valuation equity/);
  });
});
