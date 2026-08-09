import { describe, expect, it, vi } from 'vitest';

import { runRuntimeHealthSimulation } from '../src/tools/simulateRuntimeHealth';

describe('runtime health simulation', () => {
  it('verifies healthy, degraded, and unhealthy observability flows', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      const result = await runRuntimeHealthSimulation();

      expect(result.healthyInspectionExitCode).toBe(0);
      expect(result.unhealthyInspectionExitCode).toBe(1);
      expect(result.healthyStatus).toBe('DEGRADED');
      expect(result.unhealthyStatus).toBe('UNHEALTHY');
      expect(result.byteIdenticalRepeat).toBe(true);
      expect(result.inspectionVerified).toBe(true);
      expect(log).toHaveBeenCalledWith('Observability simulation only. No orders are placed.');
    } finally {
      log.mockRestore();
    }
  });
});
