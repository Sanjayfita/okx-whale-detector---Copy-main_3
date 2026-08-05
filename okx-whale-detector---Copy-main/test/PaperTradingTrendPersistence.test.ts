import { describe, expect, it } from 'vitest';

import {
  createPaperTradingTrendDocument,
  readPaperTradingTrendDocumentFromText,
  serializePaperTradingTrendDocument,
} from '../src/paperTrading/paperTradingTrendPersistence';
import type { PaperTradingTrendSummary } from '../src/paperTrading/paperTradingTrend';

const summary: PaperTradingTrendSummary = Object.freeze({
  direction: 'IMPROVING',
  points: Object.freeze([
    Object.freeze({
      generatedAt: 100,
      equity: 1000,
      realizedPnl: 0,
      unrealizedPnl: 0,
      drawdownPercent: 2,
      riskStatus: 'WARNING' as const,
    }),
    Object.freeze({
      generatedAt: 200,
      equity: 1050,
      realizedPnl: 20,
      unrealizedPnl: 30,
      drawdownPercent: 1,
      riskStatus: 'ALLOWED' as const,
    }),
  ]),
  equityChange: 50,
  realizedPnlChange: 20,
  unrealizedPnlChange: 30,
  drawdownPercentChange: -1,
  bestEquity: 1050,
  worstEquity: 1000,
  maximumDrawdownPercent: 2,
  riskEscalations: 0,
  riskImprovements: 1,
  reasons: Object.freeze(['Risk improved']),
});

describe('paper trading trend persistence', () => {
  it('serializes and reads a deterministic versioned document', () => {
    const document = createPaperTradingTrendDocument(summary);
    const first = serializePaperTradingTrendDocument(document);
    const second = serializePaperTradingTrendDocument(document);

    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
    expect(readPaperTradingTrendDocumentFromText(first)).toEqual(document);
  });

  it('rejects malformed JSON and unsupported versions', () => {
    expect(() => readPaperTradingTrendDocumentFromText('{')).toThrow(
      'Malformed paper trading trend JSON',
    );

    const document = createPaperTradingTrendDocument(summary);
    expect(() =>
      readPaperTradingTrendDocumentFromText(
        JSON.stringify({ ...document, schemaVersion: 2 }),
      ),
    ).toThrow('Unsupported paper trading trend schema version');
  });

  it('rejects inconsistent changes and non-chronological points', () => {
    const document = createPaperTradingTrendDocument(summary);

    expect(() =>
      readPaperTradingTrendDocumentFromText(
        JSON.stringify({
          ...document,
          summary: { ...document.summary, equityChange: 999 },
        }),
      ),
    ).toThrow('summary.equityChange is inconsistent');

    expect(() =>
      readPaperTradingTrendDocumentFromText(
        JSON.stringify({
          ...document,
          summary: {
            ...document.summary,
            points: [...document.summary.points].reverse(),
          },
        }),
      ),
    ).toThrow('summary.points must be strictly chronological');
  });
});
