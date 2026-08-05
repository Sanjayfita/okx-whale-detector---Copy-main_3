import { describe, expect, it } from 'vitest';

import { createFinalEmpiricalValidationReport } from '../src/research/finalEmpiricalValidationReport';

const baseInput = {
  evaluationId: 'evaluation-1',
  sourceCommit: 'abc123',
  configurationFingerprint: 'config-1',
  collectionDays: 30,
  qualifiedAlertCount: 1_000,
  requiredCollectionDays: 30,
  requiredQualifiedAlertCount: 1_000,
  evaluatedHorizons: 5,
  outperformedHorizons: 3,
  profitableAfterCostHorizons: 3,
  chronologicalHoldoutUsed: true,
} as const;

describe('createFinalEmpiricalValidationReport', () => {
  it('passes when evidence and all empirical requirements pass', () => {
    const report = createFinalEmpiricalValidationReport(baseInput);

    expect(report.verdict).toBe('PASSED');
    expect(report.reasons).toEqual([]);
    expect(report.complete).toBe(true);
    expect(report.paperOnly).toBe(true);
    expect(report.orderExecutionAuthorized).toBe(false);
    expect(report.liveOrderExecutionAllowed).toBe(false);
  });

  it('returns insufficient evidence before judging performance', () => {
    const report = createFinalEmpiricalValidationReport({
      ...baseInput,
      collectionDays: 10,
      qualifiedAlertCount: 200,
    });

    expect(report.verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(report.evidenceSufficient).toBe(false);
  });

  it('fails when sufficient evidence does not pass performance requirements', () => {
    const report = createFinalEmpiricalValidationReport({
      ...baseInput,
      outperformedHorizons: 2,
      profitableAfterCostHorizons: 1,
      chronologicalHoldoutUsed: false,
    });

    expect(report.verdict).toBe('FAILED');
    expect(report.reasons).toHaveLength(3);
  });

  it('rejects impossible horizon counts', () => {
    expect(() =>
      createFinalEmpiricalValidationReport({
        ...baseInput,
        outperformedHorizons: 6,
      }),
    ).toThrow('outperformedHorizons cannot exceed evaluatedHorizons');
  });
});
