import { describe, expect, it } from 'vitest';

import { createLiveTradingReadinessDocument } from '../src/safety/liveTradingReadinessPersistence';
import { summarizeLiveTradingReadinessTrend } from '../src/safety/liveTradingReadinessTrend';
import {
  createLiveTradingReadinessTrendDocument,
  readLiveTradingReadinessTrendDocumentFromText,
  serializeLiveTradingReadinessTrendDocument,
} from '../src/safety/liveTradingReadinessTrendPersistence';

const checklist = (completed: number) => {
  const keys = [
    'credentialsIsolated',
    'tradePermissionDisabledByDefault',
    'maximumOrderNotionalConfigured',
    'maximumDailyLossConfigured',
    'emergencyStopImplemented',
    'duplicateOrderProtectionImplemented',
    'exchangeReconciliationImplemented',
    'auditLoggingImplemented',
    'manualApprovalRequired',
    'testnetValidationCompleted',
    'independentSecurityReviewCompleted',
  ] as const;

  return Object.fromEntries(keys.map((key, index) => [key, index < completed])) as Record<
    (typeof keys)[number],
    boolean
  >;
};

const createTrend = () =>
  summarizeLiveTradingReadinessTrend([
    createLiveTradingReadinessDocument({ generatedAt: 100, checklist: checklist(3) }),
    createLiveTradingReadinessDocument({ generatedAt: 200, checklist: checklist(8) }),
    createLiveTradingReadinessDocument({ generatedAt: 300, checklist: checklist(11) }),
  ]);

describe('live trading readiness trend persistence', () => {
  it('round-trips a canonical deterministic document', () => {
    const document = createLiveTradingReadinessTrendDocument({
      generatedAt: 400,
      trend: createTrend(),
    });

    const first = serializeLiveTradingReadinessTrendDocument(document);
    const loaded = readLiveTradingReadinessTrendDocumentFromText(first);
    const second = serializeLiveTradingReadinessTrendDocument(loaded);

    expect(second).toBe(first);
    expect(loaded.trend.direction).toBe('IMPROVING');
    expect(loaded.trend.orderExecutionAuthorized).toBe(false);
  });

  it('rejects malformed JSON and unsupported versions', () => {
    expect(() => readLiveTradingReadinessTrendDocumentFromText('{')).toThrow(
      'Malformed readiness trend JSON',
    );

    const document = createLiveTradingReadinessTrendDocument({
      generatedAt: 400,
      trend: createTrend(),
    });
    const invalid = { ...document, schemaVersion: 99 };

    expect(() =>
      readLiveTradingReadinessTrendDocumentFromText(JSON.stringify(invalid)),
    ).toThrow('Unsupported readiness trend schema version');
  });

  it('rejects inconsistent changes and authorization', () => {
    const document = createLiveTradingReadinessTrendDocument({
      generatedAt: 400,
      trend: createTrend(),
    });

    expect(() =>
      readLiveTradingReadinessTrendDocumentFromText(
        JSON.stringify({
          ...document,
          trend: { ...document.trend, completedChecksChange: 999 },
        }),
      ),
    ).toThrow('trend.completedChecksChange is inconsistent');

    expect(() =>
      readLiveTradingReadinessTrendDocumentFromText(
        JSON.stringify({
          ...document,
          trend: { ...document.trend, orderExecutionAuthorized: true },
        }),
      ),
    ).toThrow('trend.orderExecutionAuthorized must remain false');
  });

  it('rejects duplicate or out-of-order trend points', () => {
    const document = createLiveTradingReadinessTrendDocument({
      generatedAt: 400,
      trend: createTrend(),
    });
    const points = document.trend.points.map((point) => ({ ...point }));
    points[1]!.generatedAt = points[0]!.generatedAt;

    expect(() =>
      readLiveTradingReadinessTrendDocumentFromText(
        JSON.stringify({ ...document, trend: { ...document.trend, points } }),
      ),
    ).toThrow('trend.points must be strictly chronological');
  });
});
