import { describe, expect, it } from 'vitest';

import {
  createUnifiedSafetyEvidenceBundle,
  type SafetyEvidenceItem,
} from '../src/safety/unifiedSafetyEvidenceBundle';

const item = (
  source: SafetyEvidenceItem['source'],
  state: SafetyEvidenceItem['state'] = 'PASS',
): SafetyEvidenceItem => ({
  source,
  generatedAt: 900,
  state,
  summary: `${source} summary`,
  reasons: ['deterministic test evidence'],
});

const completeEvidence = (): SafetyEvidenceItem[] => [
  item('LIVE_TRADING_READINESS'),
  item('READINESS_TREND'),
  item('PAPER_TRADING_RISK'),
  item('RUNTIME_HEALTH'),
  item('RECORDING_INTEGRITY'),
];

describe('createUnifiedSafetyEvidenceBundle', () => {
  it('qualifies complete passing evidence for manual qualification review', () => {
    const bundle = createUnifiedSafetyEvidenceBundle({
      generatedAt: 1_000,
      evidence: completeEvidence(),
    });

    expect(bundle.status).toBe('READY_FOR_QUALIFICATION_REVIEW');
    expect(bundle.passedSources).toHaveLength(5);
    expect(bundle.reviewSources).toEqual([]);
    expect(bundle.failedSources).toEqual([]);
    expect(bundle.missingSources).toEqual([]);
    expect(bundle.orderExecutionAuthorized).toBe(false);
  });

  it('requires more evidence when a source is missing or requires review', () => {
    const evidence = completeEvidence().filter(
      (entry) => entry.source !== 'RECORDING_INTEGRITY',
    );
    evidence[0] = item('LIVE_TRADING_READINESS', 'REVIEW');

    const bundle = createUnifiedSafetyEvidenceBundle({
      generatedAt: 1_000,
      evidence,
    });

    expect(bundle.status).toBe('MORE_EVIDENCE_REQUIRED');
    expect(bundle.reviewSources).toEqual(['LIVE_TRADING_READINESS']);
    expect(bundle.missingSources).toEqual(['RECORDING_INTEGRITY']);
    expect(bundle.orderExecutionAuthorized).toBe(false);
  });

  it('blocks qualification when any evidence source fails', () => {
    const evidence = completeEvidence();
    evidence[3] = item('RUNTIME_HEALTH', 'FAIL');

    const bundle = createUnifiedSafetyEvidenceBundle({
      generatedAt: 1_000,
      evidence,
    });

    expect(bundle.status).toBe('BLOCKED');
    expect(bundle.failedSources).toEqual(['RUNTIME_HEALTH']);
    expect(bundle.orderExecutionAuthorized).toBe(false);
  });

  it('rejects duplicate sources and future evidence timestamps', () => {
    expect(() =>
      createUnifiedSafetyEvidenceBundle({
        generatedAt: 1_000,
        evidence: [item('RUNTIME_HEALTH'), item('RUNTIME_HEALTH')],
      }),
    ).toThrow('Duplicate safety evidence source');

    expect(() =>
      createUnifiedSafetyEvidenceBundle({
        generatedAt: 800,
        evidence: [item('RUNTIME_HEALTH')],
      }),
    ).toThrow('cannot be newer than the bundle');
  });

  it('sorts evidence deterministically', () => {
    const first = createUnifiedSafetyEvidenceBundle({
      generatedAt: 1_000,
      evidence: completeEvidence(),
    });
    const second = createUnifiedSafetyEvidenceBundle({
      generatedAt: 1_000,
      evidence: [...completeEvidence()].reverse(),
    });

    expect(second).toEqual(first);
  });
});
