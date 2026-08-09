import { describe, expect, it } from 'vitest';

import { simulateTestnetOrderIntent } from '../src/tools/simulateTestnetOrderIntent';

describe('simulateTestnetOrderIntent', () => {
  it('verifies prepared and rejected scenarios without enabling execution', () => {
    const result = simulateTestnetOrderIntent();

    expect(result).toEqual({
      preparedStatus: 'PREPARED_FOR_DRY_RUN',
      productionStatus: 'REJECTED',
      approvalStatus: 'REJECTED',
      notionalStatus: 'REJECTED',
      deterministicRepeat: true,
      dryRunOnly: true,
      transportDispatchAllowed: false,
      testnetExecutionAuthorized: false,
      orderExecutionAuthorized: false,
    });
  });

  it('is deterministic across repeated runs', () => {
    expect(simulateTestnetOrderIntent()).toEqual(simulateTestnetOrderIntent());
  });
});
