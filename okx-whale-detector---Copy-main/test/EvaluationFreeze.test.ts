import { describe, expect, it } from 'vitest';

import {
  assertEvaluationRunMatchesFreeze,
  createEvaluationFreezeManifest,
} from '../src/research/evaluationFreeze';

describe('evaluation freeze manifest', () => {
  const createManifest = () =>
    createEvaluationFreezeManifest({
      evaluationId: 'q0-2026-08',
      frozenAt: 1_754_000_000_000,
      sourceCommit: '48256410437b27ab606a0e835c5c63c2b92fc258',
      configurationFingerprint: 'sha256:detector-config-v1',
      symbols: ['BTC-USDT', 'ETH-USDT', 'BTC-USDT'],
    });

  it('creates an immutable default 30-day, 1000-alert evaluation freeze', () => {
    const manifest = createManifest();

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.symbols).toEqual(['BTC-USDT', 'ETH-USDT']);
    expect(manifest.horizonsMinutes).toEqual([1, 5, 15, 30, 60]);
    expect(manifest.minimumCollectionDays).toBe(30);
    expect(manifest.minimumQualifiedAlerts).toBe(1_000);
    expect(manifest.configurationChangesAllowed).toBe(false);
    expect(manifest.liveOrderExecutionAllowed).toBe(false);
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('accepts an evaluation run only when commit and configuration match', () => {
    const manifest = createManifest();

    expect(() =>
      assertEvaluationRunMatchesFreeze({
        manifest,
        sourceCommit: manifest.sourceCommit,
        configurationFingerprint: manifest.configurationFingerprint,
      }),
    ).not.toThrow();
  });

  it('rejects source-code drift during evidence collection', () => {
    const manifest = createManifest();

    expect(() =>
      assertEvaluationRunMatchesFreeze({
        manifest,
        sourceCommit: 'different-commit',
        configurationFingerprint: manifest.configurationFingerprint,
      }),
    ).toThrow('source commit');
  });

  it('rejects configuration drift during evidence collection', () => {
    const manifest = createManifest();

    expect(() =>
      assertEvaluationRunMatchesFreeze({
        manifest,
        sourceCommit: manifest.sourceCommit,
        configurationFingerprint: 'sha256:changed-config',
      }),
    ).toThrow('configuration');
  });

  it('rejects incomplete manifests', () => {
    expect(() =>
      createEvaluationFreezeManifest({
        evaluationId: '',
        frozenAt: 1,
        sourceCommit: 'commit',
        configurationFingerprint: 'fingerprint',
        symbols: ['BTC-USDT'],
      }),
    ).toThrow('evaluationId');

    expect(() =>
      createEvaluationFreezeManifest({
        evaluationId: 'q0',
        frozenAt: 1,
        sourceCommit: 'commit',
        configurationFingerprint: 'fingerprint',
        symbols: [],
      }),
    ).toThrow('symbols');
  });
});
