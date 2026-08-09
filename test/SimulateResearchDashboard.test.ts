import { describe, expect, it } from 'vitest';

import { runResearchDashboardSimulation } from '../src/tools/simulateResearchDashboard';

describe('research dashboard simulation', () => {
  it('verifies the deterministic dashboard workflow', async () => {
    const result = await runResearchDashboardSimulation();

    expect(result.readyDashboardVerified).toBe(true);
    expect(result.warningDashboardVerified).toBe(true);
    expect(result.blockedDashboardVerified).toBe(true);
    expect(result.persistenceVerified).toBe(true);
    expect(result.canonicalSerializationStable).toBe(true);
    expect(result.inspectorExitCodesVerified).toBe(true);
  });
});
