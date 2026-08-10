import { describe, expect, it } from 'vitest';

import { resolveEvidenceDatasetIdentity } from '../src/tools/researchEvidenceDataset';

const HASH = 'a'.repeat(64);

describe('resolveEvidenceDatasetIdentity', () => {
  it('accepts a content-addressed dataset ID or two explicit arguments', () => {
    expect(resolveEvidenceDatasetIdentity([`eval-1:${HASH}`])).toEqual({
      evaluationId: 'eval-1',
      releaseFingerprint: HASH,
    });
    expect(resolveEvidenceDatasetIdentity(['eval-1', HASH])).toEqual({
      evaluationId: 'eval-1',
      releaseFingerprint: HASH,
    });
  });

  it('rejects unsafe or non-content-addressed identities', () => {
    expect(() => resolveEvidenceDatasetIdentity(['../eval', HASH])).toThrow(
      'safe path segment',
    );
    expect(() => resolveEvidenceDatasetIdentity(['eval-1:not-a-hash'])).toThrow(
      '64-character SHA-256',
    );
  });
});
