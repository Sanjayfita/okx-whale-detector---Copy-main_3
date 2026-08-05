import { describe, expect, it, vi } from 'vitest';

import type { UnifiedSafetyEvidenceDocument } from '../src/safety/unifiedSafetyEvidencePersistence';
import { runInspectUnifiedSafetyEvidenceCli } from '../src/tools/inspectUnifiedSafetyEvidence';

const createDocument = (
  status: 'BLOCKED' | 'MORE_EVIDENCE_REQUIRED' | 'READY_FOR_QUALIFICATION_REVIEW',
): UnifiedSafetyEvidenceDocument => ({
  schemaVersion: 1,
  generatorVersion: 'unified-safety-evidence-v1',
  generatedAt: 1_000,
  bundle: {
    generatedAt: 900,
    status,
    evidence: [
      {
        source: 'RUNTIME_HEALTH',
        generatedAt: 800,
        state: status === 'BLOCKED' ? 'FAIL' : 'PASS',
        summary: 'Runtime health summary',
        reasons: ['deterministic test evidence'],
      },
    ],
    passedSources: status === 'BLOCKED' ? [] : ['RUNTIME_HEALTH'],
    reviewSources: [],
    failedSources: status === 'BLOCKED' ? ['RUNTIME_HEALTH'] : [],
    missingSources: [
      'LIVE_TRADING_READINESS',
      'PAPER_TRADING_RISK',
      'READINESS_TREND',
      'RECORDING_INTEGRITY',
    ],
    reasons: ['test bundle reason'],
    orderExecutionAuthorized: false,
  },
});

describe('runInspectUnifiedSafetyEvidenceCli', () => {
  it('prints evidence and returns zero for review-required evidence', async () => {
    const log = vi.fn();
    const document = createDocument('MORE_EVIDENCE_REQUIRED');

    const exitCode = await runInspectUnifiedSafetyEvidenceCli(
      ['--file', 'evidence.json'],
      { readDocument: vi.fn(async () => document), log },
    );

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith('Status: MORE_EVIDENCE_REQUIRED');
    expect(log).toHaveBeenCalledWith(
      'EVIDENCE | RUNTIME_HEALTH | PASS | generatedAt=800 | Runtime health summary',
    );
    expect(log).toHaveBeenCalledWith('Order execution authorized: false');
  });

  it('returns one for blocked evidence', async () => {
    const exitCode = await runInspectUnifiedSafetyEvidenceCli(
      ['--file', 'evidence.json'],
      {
        readDocument: vi.fn(async () => createDocument('BLOCKED')),
        log: vi.fn(),
      },
    );

    expect(exitCode).toBe(1);
  });

  it('returns two when the file argument is missing', async () => {
    const error = vi.fn();

    const exitCode = await runInspectUnifiedSafetyEvidenceCli([], { error });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Usage: safety:inspect-evidence -- --file <evidence.json>',
    );
  });

  it('returns two when document loading fails', async () => {
    const error = vi.fn();

    const exitCode = await runInspectUnifiedSafetyEvidenceCli(
      ['--file', 'evidence.json'],
      {
        readDocument: vi.fn(async () => {
          throw new Error('broken evidence');
        }),
        error,
      },
    );

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Unified safety evidence inspection failed: broken evidence',
    );
  });
});
