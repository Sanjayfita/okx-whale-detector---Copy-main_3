import { describe, expect, it } from 'vitest';

import { runRecordingIntegritySimulation } from '../src/tools/simulateRecordingIntegrity';

describe('recording integrity simulation', () => {
  it('verifies inspection, persistence, deterministic reload, and invalid inputs', async () => {
    await expect(runRecordingIntegritySimulation()).resolves.toEqual({
      recordingValid: true,
      persistedDocumentValid: true,
      checksumStable: true,
      serializationStable: true,
      malformedRecordingRejected: true,
      nonMonotonicRecordingRejected: true,
    });
  });
});
