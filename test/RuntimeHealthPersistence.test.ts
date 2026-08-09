import { describe, expect, it } from 'vitest';

import { createRuntimeHealthSnapshot } from '../src/observability/runtimeHealth';
import {
  createRuntimeHealthDocument,
  readRuntimeHealthDocumentFromText,
  serializeRuntimeHealthDocument,
} from '../src/observability/runtimeHealthPersistence';

const createSnapshot = () =>
  createRuntimeHealthSnapshot({
    generatedAt: 1_700_000_010_000,
    startedAt: 1_700_000_000_000,
    components: [
      {
        name: 'websocket',
        status: 'HEALTHY',
        observedAt: 1_700_000_009_000,
        metrics: { reconnects: 0, messages: 120 },
      },
      {
        name: 'order-book',
        status: 'DEGRADED',
        observedAt: 1_700_000_009_500,
        message: 'One market is resynchronizing',
        metrics: { syncedMarkets: 6, resyncingMarkets: 1 },
      },
    ],
  });

describe('runtime health persistence', () => {
  it('serializes and reloads a deterministic versioned document', () => {
    const document = createRuntimeHealthDocument(createSnapshot());
    const first = serializeRuntimeHealthDocument(document);
    const second = serializeRuntimeHealthDocument(document);

    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);

    const reloaded = readRuntimeHealthDocumentFromText(first);
    expect(reloaded.schemaVersion).toBe(1);
    expect(reloaded.generatorVersion).toBe('runtime-health-document-v1');
    expect(reloaded.snapshot.status).toBe('DEGRADED');
    expect(reloaded.snapshot.components.map((component) => component.name)).toEqual([
      'order-book',
      'websocket',
    ]);
  });

  it('rejects malformed and unsupported documents', () => {
    expect(() => readRuntimeHealthDocumentFromText('{')).toThrow(
      'Malformed runtime health document JSON',
    );

    const document = createRuntimeHealthDocument(createSnapshot());
    expect(() =>
      readRuntimeHealthDocumentFromText(
        JSON.stringify({ ...document, schemaVersion: 999 }),
      ),
    ).toThrow('Unsupported runtime health document schema version');
  });

  it('rejects tampered derived fields', () => {
    const document = createRuntimeHealthDocument(createSnapshot());

    expect(() =>
      readRuntimeHealthDocumentFromText(
        JSON.stringify({
          ...document,
          snapshot: { ...document.snapshot, healthyCount: 99 },
        }),
      ),
    ).toThrow('snapshot.healthyCount is inconsistent');
  });
});
