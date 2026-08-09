import { describe, expect, it } from 'vitest';

import { createRuntimeHealthSnapshot } from '../src/observability/runtimeHealth';

describe('createRuntimeHealthSnapshot', () => {
  it('creates a deterministic snapshot and selects the worst component status', () => {
    const snapshot = createRuntimeHealthSnapshot({
      generatedAt: 5_000,
      startedAt: 1_000,
      components: [
        {
          name: 'websocket',
          status: 'HEALTHY',
          observedAt: 4_900,
          metrics: { messages: 25, reconnects: 0 },
        },
        {
          name: 'order-book',
          status: 'DEGRADED',
          observedAt: 4_800,
          message: 'One instrument is resynchronizing',
          metrics: { synced: 2, resyncing: 1 },
        },
      ],
    });

    expect(snapshot.status).toBe('DEGRADED');
    expect(snapshot.uptimeMs).toBe(4_000);
    expect(snapshot.healthyCount).toBe(1);
    expect(snapshot.degradedCount).toBe(1);
    expect(snapshot.unhealthyCount).toBe(0);
    expect(snapshot.components.map((component) => component.name)).toEqual([
      'order-book',
      'websocket',
    ]);
    expect(Object.keys(snapshot.components[0]!.metrics)).toEqual(['resyncing', 'synced']);
  });

  it('reports unhealthy when any component is unhealthy', () => {
    const snapshot = createRuntimeHealthSnapshot({
      generatedAt: 10,
      startedAt: 0,
      components: [
        { name: 'recorder', status: 'HEALTHY', observedAt: 9 },
        { name: 'market-engine', status: 'UNHEALTHY', observedAt: 8 },
      ],
    });

    expect(snapshot.status).toBe('UNHEALTHY');
    expect(snapshot.unhealthyCount).toBe(1);
  });

  it('rejects duplicate components and invalid measurements', () => {
    expect(() =>
      createRuntimeHealthSnapshot({
        generatedAt: 10,
        startedAt: 0,
        components: [
          { name: 'websocket', status: 'HEALTHY', observedAt: 9 },
          { name: 'websocket', status: 'DEGRADED', observedAt: 9 },
        ],
      }),
    ).toThrow('Duplicate runtime component name');

    expect(() =>
      createRuntimeHealthSnapshot({
        generatedAt: 10,
        startedAt: 0,
        components: [
          {
            name: 'websocket',
            status: 'HEALTHY',
            observedAt: 11,
            metrics: { latencyMs: Number.NaN },
          },
        ],
      }),
    ).toThrow('cannot be observed in the future');
  });
});
