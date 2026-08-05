import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createStrategyCandidate,
  createStrategyCandidateRegistry,
  readStrategyCandidateRegistry,
  readStrategyCandidateRegistryFromText,
  serializeStrategyCandidateRegistry,
  writeStrategyCandidateRegistry,
} from '../src/research/strategyCandidateRegistry';

describe('strategy candidate registry', () => {
  const candidate = createStrategyCandidate({
    candidateId: 'candidate:baseline',
    label: 'Baseline detector settings',
    status: 'ACTIVE',
    createdAt: 1_700_000_000_000,
    parameters: { whaleThresholdUsd: 100_000, proximityPercent: 0.5 },
  });

  it('creates deterministic fingerprints and canonical registry ordering', () => {
    const challenger = createStrategyCandidate({
      candidateId: 'candidate:challenger',
      label: 'Lower threshold challenger',
      createdAt: 1_700_000_000_001,
      parameters: { proximityPercent: 0.5, whaleThresholdUsd: 75_000 },
    });
    const registry = createStrategyCandidateRegistry({
      registryId: 'strategy-registry:1',
      generatedAt: 1_700_000_000_002,
      candidates: [challenger, candidate],
    });

    expect(registry.candidates.map(({ candidateId }) => candidateId)).toEqual([
      'candidate:baseline',
      'candidate:challenger',
    ]);
    expect(candidate.parameterFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(serializeStrategyCandidateRegistry(registry)).toBe(
      serializeStrategyCandidateRegistry(registry),
    );
  });

  it('rejects duplicate ids and duplicate parameter sets', () => {
    expect(() =>
      createStrategyCandidateRegistry({
        registryId: 'strategy-registry:duplicate-id',
        generatedAt: 1,
        candidates: [candidate, candidate],
      }),
    ).toThrow('Duplicate candidate id');

    const sameParameters = createStrategyCandidate({
      candidateId: 'candidate:same-parameters',
      label: 'Same parameters',
      createdAt: 2,
      parameters: { proximityPercent: 0.5, whaleThresholdUsd: 100_000 },
    });
    expect(() =>
      createStrategyCandidateRegistry({
        registryId: 'strategy-registry:duplicate-parameters',
        generatedAt: 2,
        candidates: [candidate, sameParameters],
      }),
    ).toThrow('Duplicate candidate parameters');
  });

  it('rejects fingerprint tampering and malformed JSON', () => {
    const registry = createStrategyCandidateRegistry({
      registryId: 'strategy-registry:validation',
      generatedAt: 3,
      candidates: [candidate],
    });
    const tampered = JSON.parse(serializeStrategyCandidateRegistry(registry)) as {
      candidates: Array<{ parameterFingerprint: string }>;
    };
    tampered.candidates[0]!.parameterFingerprint = '0'.repeat(64);

    expect(() => readStrategyCandidateRegistryFromText(JSON.stringify(tampered))).toThrow(
      'parameterFingerprint does not match parameters',
    );
    expect(() => readStrategyCandidateRegistryFromText('{')).toThrow(
      'Malformed strategy candidate registry JSON',
    );
  });

  it('writes and reloads byte-identical registry data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'strategy-candidate-registry-'));
    const path = join(directory, 'registry.json');
    const registry = createStrategyCandidateRegistry({
      registryId: 'strategy-registry:file',
      generatedAt: 4,
      candidates: [candidate],
    });

    try {
      await writeStrategyCandidateRegistry(path, registry);
      const reloaded = await readStrategyCandidateRegistry(path);
      expect(reloaded).toEqual(registry);
      expect(await readFile(path, 'utf8')).toBe(serializeStrategyCandidateRegistry(registry));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
