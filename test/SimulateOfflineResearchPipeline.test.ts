import { describe, expect, it, vi } from 'vitest';

import { runOfflineResearchPipelineSimulation } from '../src/tools/simulateOfflineResearchPipeline';

describe('offline research pipeline simulation', () => {
  it('runs, persists, inspects, repeats deterministically, and cleans up', async () => {
    const output: string[] = [];
    const log = vi.fn((...values: unknown[]) => output.push(values.map(String).join(' ')));

    await runOfflineResearchPipelineSimulation(log);

    expect(output).toContain('OFFLINE RESEARCH PIPELINE SIMULATION');
    expect(output).toContain('Status: COMPLETED');
    expect(output).toContain('Steps completed: 1');
    expect(output).toContain('Artifacts: 1');
    expect(output).toContain('Inspection complete: true');
    expect(output).toContain('Byte-identical manifest repeat: true');
    expect(output).toContain('Research analytics only. No orders are placed.');
    expect(output).toContain('Temporary offline research outputs cleaned up: true');
  });
});
