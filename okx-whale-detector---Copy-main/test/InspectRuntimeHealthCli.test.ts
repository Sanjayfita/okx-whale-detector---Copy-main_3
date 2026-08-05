import { describe, expect, it, vi } from 'vitest';

import type { RuntimeHealthDocument } from '../src/observability/runtimeHealthPersistence';
import { runInspectRuntimeHealthCli } from '../src/tools/inspectRuntimeHealth';

const document = (status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'): RuntimeHealthDocument => ({
  schemaVersion: 1,
  generatorVersion: 'runtime-health-document-v1',
  snapshot: {
    generatedAt: 2_000,
    startedAt: 1_000,
    uptimeMs: 1_000,
    status,
    healthyCount: status === 'HEALTHY' ? 1 : 0,
    degradedCount: status === 'DEGRADED' ? 1 : 0,
    unhealthyCount: status === 'UNHEALTHY' ? 1 : 0,
    components: [
      {
        name: 'websocket',
        status,
        observedAt: 1_900,
        message: status === 'HEALTHY' ? null : 'connection issue',
        metrics: { reconnects: status === 'HEALTHY' ? 0 : 2 },
      },
    ],
  },
});

describe('runtime health inspector CLI', () => {
  it('prints a healthy persisted snapshot and returns zero', async () => {
    const log = vi.fn();
    const exitCode = await runInspectRuntimeHealthCli(['--file', 'health.json'], {
      readDocument: vi.fn().mockResolvedValue(document('HEALTHY')),
      log,
    });

    expect(exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith('RUNTIME HEALTH SNAPSHOT');
    expect(log).toHaveBeenCalledWith('Status: HEALTHY');
    expect(log).toHaveBeenCalledWith('HEALTHY | websocket | observedAt=1900 | reconnects=0');
  });

  it('returns one when the persisted snapshot is unhealthy', async () => {
    const exitCode = await runInspectRuntimeHealthCli(['--file', 'health.json'], {
      readDocument: vi.fn().mockResolvedValue(document('UNHEALTHY')),
      log: vi.fn(),
    });

    expect(exitCode).toBe(1);
  });

  it('returns two for missing arguments', async () => {
    const error = vi.fn();
    const exitCode = await runInspectRuntimeHealthCli([], { error });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(
      'Usage: runtime:health:inspect -- --file <runtime-health.json>',
    );
  });

  it('returns two when the document cannot be read', async () => {
    const error = vi.fn();
    const exitCode = await runInspectRuntimeHealthCli(['--file', 'missing.json'], {
      readDocument: vi.fn().mockRejectedValue(new Error('not found')),
      error,
    });

    expect(exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith('Runtime health inspection failed: not found');
  });
});
