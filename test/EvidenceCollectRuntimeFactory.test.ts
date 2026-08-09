import { describe, expect, it, vi } from 'vitest';
import { createEvidenceCollectRuntimeBundle } from '../src/research/evidenceCollectRuntimeFactory';
import type { EvidenceCollectBootstrap } from '../src/research/evidenceCollectBootstrap';

const bootstrap: EvidenceCollectBootstrap = {
  evaluationDirectory: 'data/evaluations/eval-test',
  manifest: {
    schemaVersion: 1,
    evaluationId: 'eval-test',
    sourceCommit: 'abc123',
    configurationFingerprint: 'fingerprint',
    configuration: {},
    instruments: ['BTC-USDT'],
    horizonsMinutes: [1, 5, 15, 30, 60],
    minimumCollectionDays: 30,
    minimumQualifiedAlerts: 1_000,
    createdAt: 1_000,
    configurationChangesAllowed: false,
    liveOrderExecutionAllowed: false,
    orderExecutionAuthorized: false,
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
  },
  liveOrderExecutionAllowed: false,
};

describe('createEvidenceCollectRuntimeBundle', () => {
  it('assembles the research-only runtime dependencies', () => {
    const readPrice = vi.fn();
    const bundle = createEvidenceCollectRuntimeBundle({
      bootstrap,
      readPrice,
    });

    expect(bundle.liveOrderExecutionAllowed).toBe(false);
    expect(bundle.runtime).toBeDefined();
    expect(bundle.recorder).toBeDefined();
    expect(bundle.scheduler).toBeDefined();
    expect(bundle.collector).toBeDefined();
    expect(bundle.bridge).toBeDefined();
  });

  it('rejects an execution-enabled manifest at the composition boundary', () => {
    const unsafe = {
      ...bootstrap,
      manifest: {
        ...bootstrap.manifest,
        orderExecutionAuthorized: true,
      },
    } as unknown as EvidenceCollectBootstrap;

    expect(() =>
      createEvidenceCollectRuntimeBundle({
        bootstrap: unsafe,
        readPrice: vi.fn(),
      }),
    ).toThrow('Evidence collection safety locks are invalid');
  });
});
