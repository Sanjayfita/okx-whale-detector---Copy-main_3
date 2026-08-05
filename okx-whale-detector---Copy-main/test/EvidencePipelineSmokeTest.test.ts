import { describe, expect, it } from 'vitest';

import { runEvidencePipelineSmokeTest } from '../src/tools/smokeTestEvidencePipeline';

describe('runEvidencePipelineSmokeTest', () => {
  it('completes one alert through all five evidence horizons', async () => {
    const result = await runEvidencePipelineSmokeTest();

    expect(result).toEqual({
      qualifiedAlertCount: 1,
      completedObservationCount: 5,
      completeBundleCount: 1,
      pendingObservationCount: 0,
      malformedRecordCount: 0,
      liveOrderExecutionAllowed: false,
    });
  });
});
