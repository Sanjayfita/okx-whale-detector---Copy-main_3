import { describe, expect, it } from 'vitest';

import {
  createLiveTradingReadinessDocument,
  readLiveTradingReadinessDocumentFromText,
  serializeLiveTradingReadinessDocument,
  validateLiveTradingReadinessDocument,
} from '../src/safety/liveTradingReadinessPersistence';
import type { LiveTradingReadinessChecklist } from '../src/safety/liveTradingReadiness';

const completeChecklist = (): LiveTradingReadinessChecklist => ({
  credentialsIsolated: true,
  tradePermissionDisabledByDefault: true,
  maximumOrderNotionalConfigured: true,
  maximumDailyLossConfigured: true,
  emergencyStopImplemented: true,
  duplicateOrderProtectionImplemented: true,
  exchangeReconciliationImplemented: true,
  auditLoggingImplemented: true,
  manualApprovalRequired: true,
  testnetValidationCompleted: true,
  independentSecurityReviewCompleted: true,
});

describe('live trading readiness persistence', () => {
  it('creates and round-trips a deterministic versioned document', () => {
    const document = createLiveTradingReadinessDocument({
      generatedAt: 1_700_000_000_000,
      checklist: completeChecklist(),
    });

    expect(document.assessment.status).toBe('READY_FOR_MANUAL_REVIEW');
    expect(document.assessment.orderExecutionAuthorized).toBe(false);

    const first = serializeLiveTradingReadinessDocument(document);
    const second = serializeLiveTradingReadinessDocument(document);
    expect(second).toBe(first);

    const restored = readLiveTradingReadinessDocumentFromText(first);
    expect(restored).toEqual(document);
    expect(validateLiveTradingReadinessDocument(restored)).toBe(true);
  });

  it('preserves a not-ready assessment without authorizing execution', () => {
    const checklist = completeChecklist();
    checklist.emergencyStopImplemented = false;

    const document = createLiveTradingReadinessDocument({
      generatedAt: 1_700_000_000_001,
      checklist,
    });

    expect(document.assessment.status).toBe('NOT_READY');
    expect(document.assessment.missingChecks).toEqual(['emergencyStopImplemented']);
    expect(document.assessment.orderExecutionAuthorized).toBe(false);
  });

  it('rejects malformed and unsupported documents', () => {
    expect(() => readLiveTradingReadinessDocumentFromText('{')).toThrow(
      'Malformed live trading readiness document JSON',
    );

    const document = createLiveTradingReadinessDocument({
      generatedAt: 1,
      checklist: completeChecklist(),
    });
    expect(() =>
      validateLiveTradingReadinessDocument({ ...document, schemaVersion: 2 }),
    ).toThrow('Unsupported live trading readiness document schema version');
  });

  it('rejects inconsistent or execution-authorizing assessments', () => {
    const document = createLiveTradingReadinessDocument({
      generatedAt: 2,
      checklist: completeChecklist(),
    });

    expect(() =>
      validateLiveTradingReadinessDocument({
        ...document,
        assessment: { ...document.assessment, completedChecks: 0 },
      }),
    ).toThrow('assessment.completedChecks is inconsistent');

    expect(() =>
      validateLiveTradingReadinessDocument({
        ...document,
        assessment: { ...document.assessment, orderExecutionAuthorized: true },
      }),
    ).toThrow('assessment.orderExecutionAuthorized must remain false');
  });
});
