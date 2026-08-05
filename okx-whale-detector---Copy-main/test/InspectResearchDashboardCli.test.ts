import { describe, expect, it, vi } from 'vitest';

import type { ResearchDashboardDocument } from '../src/dashboard/researchDashboardPersistence';
import { runInspectResearchDashboardCli } from '../src/tools/inspectResearchDashboard';

const createDocument = (status: 'READY' | 'WARNING' | 'BLOCKED'): ResearchDashboardDocument => ({
  schemaVersion: 1,
  generatorVersion: 'research-dashboard-document-v1',
  snapshot: {
    generatedAt: 1_700_000_000_000,
    status,
    runtimeStatus: status === 'BLOCKED' ? 'UNHEALTHY' : status === 'WARNING' ? 'DEGRADED' : 'HEALTHY',
    counts: {
      recordings: 2,
      validRecordings: status === 'BLOCKED' ? 1 : 2,
      researchSessions: 2,
      completedResearchSessions: status === 'READY' ? 2 : 1,
      strategyCandidates: 2,
      evaluatedStrategyCandidates: status === 'READY' ? 2 : 1,
    },
    invalidRecordingPaths: status === 'BLOCKED' ? ['broken.jsonl'] : [],
    incompleteResearchSessionIds: status === 'READY' ? [] : ['session-b'],
    unevaluatedStrategyCandidateIds: status === 'READY' ? [] : ['candidate-b'],
    reasons:
      status === 'READY'
        ? []
        : status === 'WARNING'
          ? ['Runtime health is degraded']
          : ['1 recording(s) failed integrity checks', 'Runtime health is unhealthy'],
  },
});

describe('research dashboard inspector CLI', () => {
  it.each([
    ['READY', 0],
    ['WARNING', 0],
    ['BLOCKED', 1],
  ] as const)('returns the expected exit code for %s', async (status, expectedExitCode) => {
    const messages: string[] = [];
    const exitCode = await runInspectResearchDashboardCli(['--file', 'dashboard.json'], {
      readDocument: vi.fn().mockResolvedValue(createDocument(status)),
      log: (message) => messages.push(message),
    });

    expect(exitCode).toBe(expectedExitCode);
    expect(messages).toContain(`Status: ${status}`);
    expect(messages.at(-1)).toBe(
      'Research analytics only. This output is not a trading recommendation.',
    );
  });

  it('returns usage error when --file is missing', async () => {
    const errors: string[] = [];
    const exitCode = await runInspectResearchDashboardCli([], {
      error: (message) => errors.push(message),
    });

    expect(exitCode).toBe(2);
    expect(errors).toEqual(['Usage: dashboard:inspect -- --file <research-dashboard.json>']);
  });

  it('returns read failure without throwing', async () => {
    const errors: string[] = [];
    const exitCode = await runInspectResearchDashboardCli(['--file', 'bad.json'], {
      readDocument: vi.fn().mockRejectedValue(new Error('bad document')),
      error: (message) => errors.push(message),
    });

    expect(exitCode).toBe(2);
    expect(errors).toEqual(['Research dashboard inspection failed: bad document']);
  });
});
