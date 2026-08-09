import { describe, expect, it } from 'vitest';

import { runAutonomousResearchSimulation } from '../src/tools/simulateAutonomousResearch';

describe('runAutonomousResearchSimulation', () => {
  it('is deterministic and remains evidence-blocked without fabricating results', () => {
    const first = runAutonomousResearchSimulation();
    const second = runAutonomousResearchSimulation();

    expect(first).toEqual(second);
    expect(first.researchState).toBe('ACQUIRING_EVIDENCE');
    expect(first.blockers).toContain('COLLECTION_DURATION_BELOW_180_DAYS');
    expect(first.profitabilityClaimed).toBe(false);
    expect(first.strategyPromotionAllowed).toBe(false);
    expect(first.liveExecutionAllowed).toBe(false);
  });
});
